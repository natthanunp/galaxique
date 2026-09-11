import { NextResponse } from "next/server";

import { THEMES, THEME_VIBE, type ProfileDisplayStats } from "@/lib/profile";
import { getProfileStats } from "@/lib/profileStatsStore";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function displayStats(stats: Record<string, number>): ProfileDisplayStats {
  return {
    total: stats.total ?? 0,
    cute: stats[THEMES.find((theme) => THEME_VIBE[theme] === "cute")!] ?? 0,
    cozy: stats[THEMES.find((theme) => THEME_VIBE[theme] === "cozy")!] ?? 0,
    mysterious: stats[THEMES.find((theme) => THEME_VIBE[theme] === "mysterious")!] ?? 0,
    intense: stats[THEMES.find((theme) => THEME_VIBE[theme] === "intense")!] ?? 0,
    whimsical: stats[THEMES.find((theme) => THEME_VIBE[theme] === "whimsical")!] ?? 0,
    cynical: stats[THEMES.find((theme) => THEME_VIBE[theme] === "cynical")!] ?? 0,
  };
}

/** Returns statistics for the current profile system. */
export async function GET() {
  try {
    const { stats, source } = await getProfileStats();
    return NextResponse.json({
      success: true,
      stats: displayStats(stats),
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
