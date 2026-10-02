"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { SparklesIcon } from "lucide-react";

interface ConstellationPreviewProps {
  language?: "en" | "th";
}

/**
 * A small preview card on the landing page showing the constellation star
 * count and a mini rotating star field. Links to /constellation.
 */
export function ConstellationPreview({ language = "en" }: ConstellationPreviewProps) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch("/api/constellation")
      .then((r) => r.json())
      .then((d) => { if (d.success) setCount(d.count ?? d.stars?.length ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Mini animated stars on the small canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || count === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Generate a few fixed mini-stars for the preview.
    const miniStars = Array.from({ length: Math.min(count, 40) }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
    }));

    const draw = (t: number) => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);
      for (const s of miniStars) {
        const tw = Math.sin(t * 0.003 + s.phase) * 0.3 + 0.7;
        ctx.globalAlpha = 0.5 + tw * 0.5;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r * tw, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${200 + s.x * 60}, 70%, 75%)`;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [count]);

  if (loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
    >
      <Link href="/constellation" className="group block">
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/60 p-4 backdrop-blur-md transition-all hover:border-primary/30 hover:bg-card/80">
          {/* Mini star canvas behind the text */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full opacity-40"
            aria-hidden
          />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <SparklesIcon className="size-4 text-primary" />
                {language === "th" ? "กลุ่มดาวแห่งวิญญาณ" : "Constellation of Souls"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {count === 0
                  ? (language === "th" ? "เป็นคนแรกที่ค้นพบจักรวาลของตัวเอง" : "Be the first to discover your universe")
                  : (language === "th"
                      ? `${count.toLocaleString()} จักรวาลถูกค้นพบ`
                      : `${count.toLocaleString()} universes discovered`)}
              </p>
            </div>
            <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
              {language === "th" ? "สำรวจ →" : "Explore →"}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
