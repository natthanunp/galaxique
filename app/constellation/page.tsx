"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedUniverseBackground } from "@/components/shared/AnimatedUniverseBackground";
import type { LegacyStar } from "@/lib/constellationStore";

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
  const [stars, setStars] = useState<LegacyStar[]>([]);
  const [loading, setLoading] = useState(true);
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
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const draw = (time: number) => {
      const t = motion.matches ? 0 : time;
      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);
      const rot = t * 0.00003;
      const cx = W / 2;
      const cy = H / 2;
      const spread = Math.min(W, H) * 0.38;
      stars.forEach((star, i) => {
        const pos = seededPos(star.seed, i);
        const angle = pos.x * Math.PI * 2 + rot;
        const dist = 0.15 + pos.y * 0.85;
        const x = cx + Math.cos(angle) * spread * dist;
        const y = cy + Math.sin(angle) * spread * dist * 0.7;
        const tw = Math.sin(t * 0.002 + i * 1.7) * 0.3 + 0.7;
        const sz = 2 + (1 - dist) * 4;
        ctx.globalAlpha = 0.6 + tw * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, sz * tw, 0, Math.PI * 2);
        ctx.fillStyle = star.color;
        ctx.fill();
        ctx.globalAlpha = tw * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 3 * tw);
        g.addColorStop(0, star.color + "40");
        g.addColorStop(1, star.color + "00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, sz * 3 * tw, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      if (!document.hidden && !motion.matches) raf = requestAnimationFrame(draw);
    };
    const resume = () => { cancelAnimationFrame(raf); draw(performance.now()); };
    const onResize = () => { resize(); resume(); };
    resume();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", resume);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", resume); motion.removeEventListener("change", resume);
    };
  }, [stars]);

  return (
    <>
      <AnimatedUniverseBackground />
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
              {stars.length.toLocaleString()} universes
            </p>
          )}
        </div>
        <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden />
      </main>
    </>
  );
}
