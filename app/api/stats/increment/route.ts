import { NextRequest, NextResponse } from "next/server";
import { incrementVibeStat, incrementCelestialStat } from "@/lib/vibeStatsStore";
import type { VibeStats } from "@/lib/vibeStatsStore";

export const runtime = "edge";

/**
 * POST /api/stats/increment
 * Increments the vibe and celestial-type counters after a user gets their reveal.
 * Body: {
 *   "vibe": "cute" | "cozy" | "mysterious" | "intense" | "whimsical" | "cynical",
 *   "celestial_type"?: "galaxy" | "black_hole" | "neutron_star"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const vibe = body.vibe as keyof Omit<VibeStats, "total">;
    const celestialType = body.celestial_type as
      | "galaxy"
      | "black_hole"
      | "neutron_star"
      | undefined;

    const validVibes = ["cute", "cozy", "mysterious", "intense", "whimsical", "cynical"];
    if (!vibe || !validVibes.includes(vibe)) {
      return NextResponse.json(
        { success: false, error: "Invalid vibe" },
        { status: 400 },
      );
    }

    const vibeResult = await incrementVibeStat(vibe);

    if (celestialType) {
      try {
        await incrementCelestialStat(celestialType);
      } catch (err) {
        // Celestial stats are an observability add-on — never fail the
        // request because the celestial increment had a problem. The vibe
        // counter is the user-facing one.
        console.warn("[stats/increment] celestial increment failed", err);
      }
    }

    return NextResponse.json({
      success: true,
      stats: vibeResult.stats,
      source: vibeResult.source,
    });
  } catch (error) {
    console.error("[stats/increment] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to increment stats" },
      { status: 500 },
    );
  }
}
