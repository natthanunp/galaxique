import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const LAYERS = new Set(["pad", "drone", "pulse", "shimmer"]);

/** Serves a score layer as an opaque binary: download managers (IDM) hijack fetches that look like audio files. */
export async function GET(_request: Request, ctx: RouteContext<"/api/score/[layer]">) {
  const { layer } = await ctx.params;
  if (!LAYERS.has(layer)) return new Response("Not found", { status: 404 });
  const data = await readFile(path.join(process.cwd(), "public", "audio", "score", `${layer}.mp3`));
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
