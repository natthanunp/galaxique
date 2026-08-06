"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { HeartIcon, FlameIcon, MoonIcon, ZapIcon, SparklesIcon, ShieldIcon } from "lucide-react";
import type { VibeStats } from "@/lib/vibeStatsStore";

/**
 * Real-time vibe statistics counter for the landing page.
 * Polls /api/stats every 15 seconds and displays a cool message
 * with the total count and per-vibe breakdown.
 */

const VIBE_ICON: Record<keyof Omit<VibeStats, "total">, typeof HeartIcon> = {
  cute: HeartIcon,
  cozy: FlameIcon,
  mysterious: MoonIcon,
  intense: ZapIcon,
  whimsical: SparklesIcon,
  cynical: ShieldIcon,
};

const VIBE_DOT: Record<keyof Omit<VibeStats, "total">, string> = {
  cute: "bg-rose-400",
  cozy: "bg-amber-400",
  mysterious: "bg-indigo-400",
  intense: "bg-red-400",
  whimsical: "bg-emerald-400",
  cynical: "bg-slate-400",
};

const VIBE_LABEL: Record<keyof Omit<VibeStats, "total">, { en: string; th: string }> = {
  cute: { en: "Cute", th: "น่ารัก" },
  cozy: { en: "Cozy", th: "อบอุ่น" },
  mysterious: { en: "Mysterious", th: "ลึกลับ" },
  intense: { en: "Intense", th: "เข้มข้น" },
  whimsical: { en: "Whimsical", th: "เพ้อฝัน" },
  cynical: { en: "Cynical", th: "เย็นชา" },
};

export function VibeCounter({ language = "en" }: { language?: "en" | "th" }) {
  const [stats, setStats] = useState<VibeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch stats");
        const data = await res.json();
        if (mounted && data.success) {
          setStats(data.stats);
          setLoading(false);
        }
      } catch (err) {
        console.error("[VibeCounter] Failed to fetch stats:", err);
        if (mounted) setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 15000); // Poll every 15s

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const total = stats.total;
  const message =
    language === "th"
      ? `${total.toLocaleString()} จักรวาลถูกค้นพบ`
      : `${total.toLocaleString()} universes discovered`;

  // Sort vibes by count (descending) for the breakdown
  const vibeEntries = (Object.entries(stats) as [keyof VibeStats, number][])
    .filter(
      (entry): entry is [keyof Omit<VibeStats, "total">, number] => entry[0] !== "total",
    )
    .sort(([, a], [, b]) => b - a);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="rounded-2xl border border-border/50 bg-card/60 p-6"
    >
      <div className="mb-4 text-center">
        <p className="text-lg font-medium text-foreground">{message}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {vibeEntries.map(([vibe, count]) => {
          const Icon = VIBE_ICON[vibe];
          return (
            <div
              key={vibe}
              className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2"
            >
              <span
                className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${VIBE_DOT[vibe]}`}
                aria-hidden
              >
                <Icon className="size-3 text-background" strokeWidth={2.5} />
              </span>
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">
                  {VIBE_LABEL[vibe][language]}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {count.toLocaleString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
