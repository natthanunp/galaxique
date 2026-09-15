/** Bound the entire operation, even if an SDK delays handling cancellation. */
export async function withRequestDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  outerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: ((reason: unknown) => void) | undefined;
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectDeadline?.(reason);
  };
  const onOuterAbort = () => abort(
    outerSignal?.reason ?? Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
  );
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(() => {
      const error = new Error("The model request timed out.");
      error.name = "TimeoutError";
      abort(error);
    }, timeoutMs);
  });
  if (outerSignal?.aborted) onOuterAbort();
  else outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}
