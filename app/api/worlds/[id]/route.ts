import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteWorld, getWorld, ownerTokenFrom as bearer, setPublished } from "@/lib/worldStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/worlds/{id} — public, consented world snapshot. */
export async function GET(_request: Request, ctx: RouteContext<"/api/worlds/[id]">) {
  const { id } = await ctx.params;
  const world = await getWorld(id);
  if (!world) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ success: true, world });
}

/** PATCH /api/worlds/{id} {published} — owner unpublishes or republishes. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/worlds/[id]">) {
  const { id } = await ctx.params;
  const token = bearer(request);
  const body = z.object({ published: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!token || !body.success) return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  const ok = await setPublished(id, token, body.data.published);
  return NextResponse.json({ success: ok }, { status: ok ? 200 : 403 });
}

/** DELETE /api/worlds/{id} — owner deletes the world permanently. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/worlds/[id]">) {
  const { id } = await ctx.params;
  const token = bearer(request);
  if (!token) return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  const ok = await deleteWorld(id, token);
  return NextResponse.json({ success: ok }, { status: ok ? 200 : 403 });
}
