import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_HOSTS = new Set([
  "audio-ssl.itunes.apple.com",
  "i.scdn.co",
  "p.scdn.co",
]);

function isAllowedMediaUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (ALLOWED_HOSTS.has(url.hostname) || url.hostname.endsWith(".scdn.co") || url.hostname.endsWith(".dzcdn.net"))
  );
}

/**
 * Same-origin proxy for the externally hosted album art and preview audio
 * shown on /reveal. The multi-threaded ffmpeg exporter requires COEP/COOP
 * isolation; third-party CDNs do not provide the CORP headers that COEP
 * requires, so their resources must be served from our own origin instead.
 *
 * This intentionally is not an open proxy: it permits only the Spotify CDN
 * and iTunes preview host, only over HTTPS, and only image/audio responses.
 */
export async function GET(request: Request): Promise<Response> {
  const urlParam = new URL(request.url).searchParams.get("url");
  if (!urlParam) {
    return NextResponse.json({ error: "Missing media URL." }, { status: 400 });
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "Invalid media URL." }, { status: 400 });
  }

  if (!isAllowedMediaUrl(mediaUrl)) {
    return NextResponse.json({ error: "Media host is not allowed." }, { status: 403 });
  }

  try {
    const range = request.headers.get("range");
    const upstream = await fetch(mediaUrl, {
      redirect: "follow",
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const finalUrl = new URL(upstream.url);
    const contentType = upstream.headers.get("content-type") ?? "";

    if (!isAllowedMediaUrl(finalUrl) || !contentType.startsWith("image/") && !contentType.startsWith("audio/")) {
      return NextResponse.json({ error: "Unexpected media response." }, { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Media upstream unavailable." }, { status: 502 });
    }

    const contentLength = upstream.headers.get("content-length");
    // iTunes labels plain AAC previews audio/x-m4p (the DRM type); Chrome's demuxer rejects that with "no supported streams".
    const servedType = /^audio\/x-m4[ap]$/.test(contentType) ? "audio/mp4" : contentType;
    const headers = new Headers({
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
      "Content-Type": servedType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Accept-Ranges": "bytes",
    });
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Media fetch failed." }, { status: 502 });
  }
}