import type { LlmCallOptions } from "@/lib/llm";
import { LlmRequestError, sanitizeLlmError } from "@/lib/llmError";
import { withRequestDeadline } from "@/lib/requestDeadline";

export const TYPHOON_QUIZ_MODEL = "typhoon-v2.5-30b-a3b-instruct";

/** Single-endpoint, single-attempt transport. The quiz pipeline owns repairs. */
export async function callTyphoonQuiz(options: LlmCallOptions): Promise<unknown> {
  const key = process.env.TYPHOON_API_KEY;
  if (!key) throw new LlmRequestError(undefined, undefined, false, "unknown");
  try {
    return await withRequestDeadline(options.timeoutMs ?? 12_000, async signal => {
      if (signal.aborted) throw signal.reason;
      const response = await fetch("https://api.opentyphoon.ai/v1/chat/completions", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: TYPHOON_QUIZ_MODEL,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
          max_tokens: options.maxTokens,
          temperature: options.temperature ?? 0.6,
          repetition_penalty: 1.05,
          response_format: { type: "json_object" },
          stream: false,
        }),
      });
      // Do not include raw upstream bodies, credentials, or prompts in errors.
      if (!response.ok) {
        await response.body?.cancel();
        throw new LlmRequestError(response.status);
      }
      const result = await response.json();
      const content = result?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new LlmRequestError(undefined, undefined, false, "empty_response");
      }
      try {
        return JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1"));
      } catch {
        throw new LlmRequestError(undefined, undefined, false, "non_json");
      }
    }, options.signal);
  } catch (error) {
    throw sanitizeLlmError(error);
  }
}
