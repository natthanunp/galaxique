/** Turns an allowed remote media URL into a same-origin URL for /reveal. */
export function mediaProxyUrl(url: string | null | undefined): string | null {
  return url ? `/api/media?url=${encodeURIComponent(url)}` : null;
}