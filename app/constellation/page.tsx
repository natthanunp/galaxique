"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeftIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StarfieldBackground } from "@/components/shared/StarfieldBackground";
import type { ConstellationStar } from "@/lib/constellationStore";

const VIBE_LABEL: Record<string, { en: string; th: string }> = {
  cute: { en: "Cute", th: "น่ารัก" },
  cozy: { en: "Cozy", th: "อบอุ่น" },
  mysterious: { en: "Mysterious", th: "ลึกลับ" },
  intense: { en: "Intense", th: "เข้มข้น" },
  whimsical: { en: "Whimsical", th: "เพ้อฝัน" },
  cynical: { en: "Cynical", th: "เย็นชา" },
};

const CREATURE_EMOJI: Record<string, string> = {
  fish: "🐟", bird: "🐦", fox: "🦊", cat: "🐱",
  dragon: "🐉", jelly: "🪼", spirit: "👻",
};

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

function seededPos(seed: number, i: number): { x: number; y: number } {
  let h = (seed + i * 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  const x = ((h >>> 0) / 4294967296);
  h = (h + 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  const y = ((h >>> 0) / 4294967296);
  return { x, y };
}

export default function ConstellationPage() {
  const [stars, setStars] = useState<ConstellationStar[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConstellationStar | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch("/api/constellation")
      .then((r) => r.json())
      .then((d) => { if (d.success) setStars(d.stars); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stars.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const draw = (t: number) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);
      const rot = t * 0.00003;
      const cx = W / 2;
      const cy = H / 2;
      const spread = Math.min(W, H) * 0.38;
      stars.forEach((star, i) => {
        const pos = seededPos(hashStr(star.id), i);
        const angle = pos.x * Math.PI * 2 + rot;
        const dist = 0.15 + pos.y * 0.85;
        const x = cx + Math.cos(angle) * spread * dist;
        const y = cy + Math.sin(angle) * spread * dist * 0.7;
        const tw = Math.sin(t * 0.002 + i * 1.7) * 0.3 + 0.7;
        const sz = 2 + (1 - dist) * 4;
        ctx.globalAlpha = 0.6 + tw * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, sz * tw, 0, Math.PI * 2);
        ctx.fillStyle = star.primaryColor;
        ctx.fill();
        ctx.globalAlpha = tw * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 3 * tw);
        g.addColorStop(0, star.primaryColor + "40");
        g.addColorStop(1, star.primaryColor + "00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 3 * tw, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [stars]);

  const handleClick = (e: React.MouseEvent) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cx = W / 2;
    const cy = H / 2;
    const spread = Math.min(W, H) * 0.38;
    for (const star of stars) {
      const pos = seededPos(hashStr(star.id), stars.indexOf(star));
      const angle = pos.x * Math.PI * 2 + (performance.now() * 0.00003);
      const dist = 0.15 + pos.y * 0.85;
      const x = cx + Math.cos(angle) * spread * dist;
      const y = cy + Math.sin(angle) * spread * dist * 0.7;
      if (Math.hypot(e.clientX - x, e.clientY - y) < 20) { setSelected(star); return; }
    }
  };

  return (
    <>
      <StarfieldBackground />
      <main className="relative flex min-h-dvh flex-col items-center">
        <header className="mx-auto flex w-full max-w-4xl items-center justify-between py-4 px-4">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/"><ArrowLeftIcon className="size-4" /> Home</Link>
          </Button>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <SparklesIcon className="size-5 text-primary" /> Constellation of Souls
          </h1>
          <div />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center w-full px-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading the cosmos...</p>
          ) : stars.length === 0 ? (
            <div className="text-center space-y-3">
              <p className="text-lg font-medium">The sky is empty</p>
              <p className="text-sm text-muted-foreground">Be the first to discover your universe.</p>
              <Button asChild size="sm"><Link href="/quiz">Begin your journey</Link></Button>
            </div>
          ) : (
            <p className="mb-2 text-sm text-muted-foreground">
              {stars.length.toLocaleString()} universes — click a star to explore
            </p>
          )}
        </div>
        <canvas ref={canvasRef} onClick={handleClick} className="fixed inset-0 z-0 cursor-pointer" />
        <AnimatePresence>
          {selected && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={() => setSelected(null)}>
              <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="mx-4 max-w-sm w-full rounded-2xl border border-border/50 bg-card/95 p-6 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-8 rounded-full" style={{ backgroundColor: selected.primaryColor }} />
                  <div>
                    <p className="text-sm font-semibold">{VIBE_LABEL[selected.vibe]?.en ?? selected.vibe}</p>
                    <p className="text-xs text-muted-foreground">{selected.celestialType.replace("_", " ")}</p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-foreground/80 mb-3">{selected.readingSnippet}</p>
                {selected.creatureName && <p className="text-xs text-muted-foreground">{CREATURE_EMOJI[selected.creatureKind] ?? "✨"} {selected.creatureName}</p>}
                {selected.songName && <p className="mt-2 text-xs text-muted-foreground">🎵 {selected.songName} — {selected.songArtist}</p>}
                <button onClick={() => setSelected(null)} className="mt-4 w-full rounded-lg bg-muted/50 py-2 text-sm text-foreground/70 hover:bg-muted transition">Close</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </>
  );
}
