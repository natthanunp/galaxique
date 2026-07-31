import { NextResponse } from "next/server";
import { getVibeStats } from "@/lib/vibeStatsStore";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/stats
 * Returns current vibe statistics for the landing page counter.
 */
export async function GET() {
  try {
    const { stats, source } = await getVibeStats();
    return NextResponse.json({
      success: true,
      stats,
      source,
    });
  } catch (error) {
    console.error("[stats] Error fetching stats:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch stats",
        stats: {
          total: 0,
          cute: 0,
          cozy: 0,
          mysterious: 0,
          intense: 0,
          whimsical: 0,
          cynical: 0,
        },
      },
      { status: 500 },
    );
  }
}
