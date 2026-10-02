import { OpenRouter } from "@openrouter/sdk";

import { SHARED_MODEL, type ReasoningEffort } from "@/config/models";
import { sanitizeLlmError } from "@/lib/llmError";
import { trackLlm } from "@/lib/metrics";
import { withRequestDeadline } from "@/lib/requestDeadline";

type LlmResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      jsonSchema: {
        name: string;
        description?: string;
        schema: Record<string, unknown>;
        strict?: boolean | null;
      };
    };

/**
 * OpenRouter LLM client via the official `@openrouter/sdk` package.
 *
 * The SDK handles request timeouts and retries (connection errors, 429s,
 * 5xxs) internally instead of a hand-rolled fetch/AbortController loop.
 * Returns a parsed JSON object; callers validate with Zod.
 */

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  // Server-only: this file is never bundled for the client.
  console.warn(
    "[llm] OPENROUTER_API_KEY is not set — API routes will return 500.",
  );
}

const client = new OpenRouter({
  apiKey: apiKey ?? "",
  httpReferer: "http://localhost:3000",
  appTitle: "Galaxseea",
});

export interface LlmCallOptions {
  /** The system instruction (mapping rules / quiz-master persona). */
  systemPrompt: string;
  /** The user message (transcript of answers, or a generation trigger). */
  userPrompt: string;
  /** Optional model override for a language- or task-specific route. */
  model?: string;
  /** Optional provider order for a model override. Provider slugs must use
   *  the lowercase REST API form, e.g. "alibaba". */
  providerOrder?: string[];
  /** Exclude an upstream provider that failed this logical request. */
  providerIgnore?: string[];
  /** Response structure required from the model. Defaults to a JSON object. */
  responseFormat?: LlmResponseFormat;
  /** Max output tokens. */
  maxTokens?: number;
  /** Model-specific reasoning effort. Omit to use the endpoint's default. */
  reasoningEffort?: ReasoningEffort;
  /** Temperature (0–2). Lower = more deterministic. */
  temperature?: number;
  /** Per-request uniqueness key. Two concurrent calls with DIFFERENT nonces
   *  run in parallel; two concurrent calls with the SAME nonce share the
   *  same in-flight promise (useful for retries where the caller already
   *  holds the previous result). If omitted, defaults to a constant per
   *  call-site "purpose" so unrelated routes never alias by accident. */
  nonce?: string;
  /** Coarse-grained grouping for the no-nonce default. Use a stable string
   *  per route ("generate-quiz", "analyze"). Combined with `nonce` when
   *  present, ignored when `nonce` is set. */
  purpose?: string;
  /** Hard cutoff for this call, in ms. Defaults to 20s. Bump this for
   *  call sites whose expected output is large (e.g. generate-quiz's 5
   *  questions × 4 bilingual options is much bigger than analyze's payload
   *  and routinely needs more than the old fixed 15s, causing spurious
   *  "aborted due to timeout" failures even though the model was still
   *  actively generating). */
  timeoutMs?: number;
  /** OpenRouter provider ordering for this specific call. Useful when a
   *  route retries a timeout using the alternate strategy. */
  providerSort?: "latency" | "throughput";
  /** Disable SDK retries when the caller owns a shared request deadline. */
  singleAttempt?: boolean;
  /** Whether OpenRouter may route to another provider when the selected
   *  endpoint fails. Defaults to true for existing callers. Quiz generation
   *  sets this to false and performs only targeted same-endpoint repairs. */
  allowProviderFallbacks?: boolean;
  /** Optional outer-operation cancellation signal. */
  signal?: AbortSignal;
  /** Bounded, content-free request telemetry for evaluation and operations. */
  onMetrics?: (metrics: LlmCallMetrics) => void;
}

export interface LlmCallMetrics {
  status: "completed" | "failed";
  elapsedMs: number;
  model: string;
  provider: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}

/** Pinned order (not `sort` alone): this account enables only some providers
 *  per model, and an unpinned sort can hit a disallowed endpoint. */
export function resolveProviderOrder(): string[] {
  return [...SHARED_MODEL.providers];
}

/** Single in-flight LLM call keyed by nonce. Two concurrent calls with the
 *  SAME key share a promise — preventing the parallel-call rate-limit storm
 *  you get from a tab refresh + HMR retrying the same logical request.
 *  Calls with different keys run independently. */
const inFlight = new Map<string, Promise<unknown>>();

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1]?.trim() ?? trimmed);
}

/** Zod emits `oneOf` for discriminated unions; OpenAI/Azure strict mode only accepts `anyOf` and returns 400 otherwise. */
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key === "oneOf" ? "anyOf" : key, toStrictSchema(value)]));
  }
  return node;
}

function normalizeResponseFormat(format: LlmResponseFormat): LlmResponseFormat {
  if (format.type !== "json_schema") return format;
  return { type: "json_schema", jsonSchema: { ...format.jsonSchema, schema: toStrictSchema(format.jsonSchema.schema) as Record<string, unknown> } };
}

/** Returns the parsed JSON object from OpenRouter. */
export function callLlm(opts: LlmCallOptions): Promise<unknown> {
  const key = opts.nonce ?? `__default__:${opts.purpose ?? "unknown"}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = callLlmRaw(opts).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

async function callLlmRaw(opts: LlmCallOptions): Promise<unknown> {
  const start = Date.now();
  const purpose = opts.purpose ?? "unknown";
  const model = opts.model ?? SHARED_MODEL.model;
  const providerSort = opts.providerSort ?? SHARED_MODEL.providerSort;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let metricsReported = false;
  const reportMetrics = (metrics: LlmCallMetrics) => {
    if (metricsReported) return;
    metricsReported = true;
    trackLlm(purpose, metrics);
    try {
      opts.onMetrics?.(metrics);
    } catch {
      // Telemetry must never make a completed model request fail.
    }
  };
  try {
    const result = await withRequestDeadline(timeoutMs, signal => client.chat.send(
      {
        chatRequest: {
          model,
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userPrompt },
          ],
          responseFormat: normalizeResponseFormat(opts.responseFormat ?? { type: "json_object" }),
          temperature: opts.temperature ?? 0.9,
          maxTokens: opts.maxTokens ?? 2048,
          // Some endpoints require reasoning and reject effort "none".
          // Use their default unless the caller explicitly configures it.
          ...(opts.reasoningEffort !== undefined
            ? { reasoning: { effort: opts.reasoningEffort } }
            : {}),
          // `order` takes precedence over `sort`; zdr is explicit so routing
          // never silently depends on the account dashboard toggle.
          provider: {
            order: opts.providerOrder ?? resolveProviderOrder(),
            ...(opts.providerIgnore?.length ? { ignore: opts.providerIgnore } : {}),
            allowFallbacks: opts.allowProviderFallbacks ?? SHARED_MODEL.allowFallbacks,
            sort: providerSort,
            zdr: SHARED_MODEL.zdr,
          },
        },
      },
      // Per-call `timeoutMs` lets large-output call sites (e.g.
      // generate-quiz) opt into a longer budget instead of sharing one fixed
      // value that's too tight for bigger payloads.
      { timeoutMs, signal, retryCodes: ["429", "5XX"], ...(opts.singleAttempt ? { retries: { strategy: "none" as const } } : {}) },
    ), opts.signal);

    if (!("choices" in result)) {
      throw new Error("OpenRouter returned a streaming response unexpectedly.");
    }
    const choice = result.choices[0];
    const content = choice?.message?.content;
    const successfulAttempt = [...(result.openrouterMetadata?.attempts ?? [])]
      .reverse()
      .find((attempt) => attempt.status >= 200 && attempt.status < 300);
    reportMetrics({
      status: "completed",
      elapsedMs: Date.now() - start,
      model: result.model || model,
      provider: successfulAttempt?.provider
        ?? (opts.allowProviderFallbacks === false && opts.providerOrder?.length === 1
          ? opts.providerOrder[0]
          : null),
      finishReason: choice?.finishReason ?? null,
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      reasoningTokens: result.usage?.completionTokensDetails?.reasoningTokens ?? null,
      costUsd: result.usage?.cost ?? null,
    });
    if (!content || typeof content !== "string") {
      // Keep diagnostics bounded and safe. Never log the response object: SDK
      // messages and errors can contain prompts, headers, or other user data.
      console.warn(`[llm] ${purpose} empty completion`, {
        finishReason: choice?.finishReason ?? null,
        completionTokens: result.usage?.completionTokens ?? null,
        reasoningTokens:
          result.usage?.completionTokensDetails?.reasoningTokens ?? null,
        hasReasoning: Boolean(
          choice?.message?.reasoning || choice?.message?.reasoningDetails?.length,
        ),
        hasRefusal: Boolean(choice?.message?.refusal),
      });
      throw new Error("OpenRouter returned an empty response.");
    }
    console.log(`[llm] ${purpose} completed in ${Date.now() - start}ms (model=${model})`);
    try {
      return parseJsonContent(content);
    } catch {
      throw new Error("OpenRouter returned non-JSON output.");
    }
  } catch (err) {
    const safeError = sanitizeLlmError(err);
    reportMetrics({
      status: "failed",
      elapsedMs: Date.now() - start,
      model,
      provider: safeError.provider ?? null,
      finishReason: null,
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      costUsd: null,
    });
    console.error(
      `[llm] ${purpose} failed after ${Date.now() - start}ms (timeout=${timeoutMs}ms, model=${model}, providerSort=${providerSort})`,
      { name: safeError.name, kind: safeError.kind, status: safeError.statusCode, provider: safeError.provider },
    );
    // Never propagate the raw SDK error to callers that may log it again.
    throw safeError;
  }
}
