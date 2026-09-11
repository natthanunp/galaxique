import { NextRequest, NextResponse } from "next/server";

import { incrementProfileStat, profileStatSchema } from "@/lib/profileStatsStore";

export const runtime = "edge";

/** Increments the current profile counters once per reveal UUID. */
export async function POST(request: NextRequest) {
  try {
    const parsed = profileStatSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid profile statistics" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      ...await incrementProfileStat(parsed.data),
    });
  } catch (error) {
    console.error("[stats/increment] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to increment stats" },
      { status: 500 },
    );
  }
}
