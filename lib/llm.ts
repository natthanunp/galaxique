import { OpenRouter } from "@openrouter/sdk";

import { quizConfig } from "@/config/quizConfig";

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
  /** Max output tokens. */
  maxTokens?: number;
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
  const model = quizConfig.openrouterModel;
  // Provider routing can be tuned per environment. "throughput" was once
  // fastest, but OpenRouter's provider mix changes; let operators override.
  // Default to "latency" because real tests now show it is consistently
  // faster for time-to-first-token (the user-visible delay).
  const providerSort = process.env.OPENROUTER_PROVIDER_SORT || "latency";
  const timeoutMs = opts.timeoutMs ?? 20_000;
  try {
    const result = await client.chat.send(
      {
        chatRequest: {
          model,
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userPrompt },
          ],
          responseFormat: { type: "json_object" },
          temperature: opts.temperature ?? 0.9,
          maxTokens: opts.maxTokens ?? 2048,
          // Some models (e.g. deepseek/deepseek-v4-flash) default to an
          // extended "thinking" mode that adds several seconds of billed
          // reasoning tokens. This app only needs fast structured JSON, not
          // deep reasoning, so disable it explicitly.
          reasoning: { effort: "none" },
          provider: { sort: providerSort as "latency" | "throughput" },
        },
      },
      // Per-call `timeoutMs` lets large-output call sites (e.g.
      // generate-quiz) opt into a longer budget instead of sharing one fixed
      // value that's too tight for bigger payloads.
      { timeoutMs, retryCodes: ["429", "5XX"] },
    );

    if (!("choices" in result)) {
      throw new Error("OpenRouter returned a streaming response unexpectedly.");
    }
    const content = result.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("OpenRouter returned an empty response.");
    }
    console.log(`[llm] ${purpose} completed in ${Date.now() - start}ms`);
    try {
      return parseJsonContent(content);
    } catch {
      throw new Error(
        `OpenRouter returned non-JSON output: ${content.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error(
      `[llm] ${purpose} failed after ${Date.now() - start}ms (timeout=${timeoutMs}ms, model=${model}, providerSort=${providerSort})`,
      err,
    );
    throw err;
  }
}
