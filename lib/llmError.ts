/** Only safe, bounded metadata may cross the SDK boundary. SDK errors can
 * contain Authorization headers, response cookies and complete prompts. */
export class LlmRequestError extends Error {
  readonly statusCode?: number;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly kind: "timeout" | "connection" | "aborted" | "empty_response" | "non_json" | "response_validation" | "http" | "unknown";
  constructor(
    statusCode?: number,
    provider?: string,
    timeout = false,
    kind?: LlmRequestError["kind"],
  ) {
    super(timeout ? "The model request timed out." : statusCode === 429 ? "The model provider is temporarily busy." : "The model request failed.");
    this.name = timeout ? "TimeoutError" : "LlmRequestError";
    this.statusCode = statusCode;
    this.provider = provider;
    this.kind = kind ?? (timeout ? "timeout" : statusCode ? "http" : "unknown");
    this.retryable = timeout || statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
  }
}
export function sanitizeLlmError(error: unknown): LlmRequestError {
  if (error instanceof LlmRequestError) return error;
  const e = error as { name?: unknown; message?: unknown; statusCode?: unknown; error?: { metadata?: { provider_name?: unknown } } } | null;
  const status = typeof e?.statusCode === "number" && e.statusCode >= 400 && e.statusCode <= 599 ? e.statusCode : undefined;
  // Map known provider display names to route slugs; never copy arbitrary upstream strings.
  const providers: Record<string, string> = { DeepInfra: "deepinfra", Baidu: "baidu", BaseTen: "baseten", Groq: "groq", SiliconFlow: "siliconflow", Inception: "inception", DeepSeek: "deepseek", Parasail: "parasail", Novita: "novita", OpenAI: "openai", Azure: "azure" };
  const name = e?.error?.metadata?.provider_name;
  const provider = typeof name === "string" && Object.hasOwn(providers, name) ? providers[name] : undefined;
  const timeout = e?.name === "TimeoutError" || e?.name === "RequestTimeoutError";
  const kind: LlmRequestError["kind"] = timeout ? "timeout"
    : e?.name === "ConnectionError" ? "connection"
    : e?.name === "RequestAbortedError" || e?.name === "AbortError" ? "aborted"
    : e?.message === "OpenRouter returned an empty response." ? "empty_response"
    : e?.message === "OpenRouter returned non-JSON output." ? "non_json"
    : e?.name === "ResponseValidationError" ? "response_validation"
    : status ? "http"
    : "unknown";
  return new LlmRequestError(status, provider, timeout, kind);
}
