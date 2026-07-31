import { NextRequest, NextResponse } from "next/server";
import { incrementVibeStat } from "@/lib/vibeStatsStore";
import type { VibeStats } from "@/lib/vibeStatsStore";

export const runtime = "edge";

/**
 * POST /api/stats/increment
 * Increments the vibe counter after a user gets their reveal.
 * Body: { "vibe": "cute" | "cozy" | "mysterious" | "intense" | "whimsical" | "cynical" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const vibe = body.vibe as keyof Omit<VibeStats, "total">;

    const validVibes = ["cute", "cozy", "mysterious", "intense", "whimsical", "cynical"];
    if (!vibe || !validVibes.includes(vibe)) {
      return NextResponse.json(
        { success: false, error: "Invalid vibe" },
        { status: 400 },
      );
    }

    const { stats, source } = await incrementVibeStat(vibe);

    return NextResponse.json({
      success: true,
      stats,
      source,
    });
  } catch (error) {
    console.error("[stats/increment] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to increment stats" },
      { status: 500 },
    );
  }
}
