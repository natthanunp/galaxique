"use client";

import { useEffect, useRef } from "react";

interface StarfieldBackgroundProps {
  /** Called once the starfield <canvas> is mounted, exposing the raw
   *  Canvas2D element. The /reveal page uses this so the export
   *  pipeline can composite the starfield into the downloaded image. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

/**
 * Lightweight cosmic background: soft nebula gradients, drifting dust,
 * and twinkling stars. Optimized for mobile Safari and low-end devices.
 *
 *  - Clouds/filaments are rendered to an offscreen canvas once and reused.
 *  - Stars use additive drawing and per-star twinkle timers.
 *  - No heavy filters/blurs in the hot path.
 */
export function StarfieldBackground({ onCanvasReady }: StarfieldBackgroundProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const isLowPower =
      typeof navigator !== "undefined" &&
      /iPhone|iPad|iPod|Android/.test(navigator.userAgent);

    // Nebula layer: painted once to an offscreen canvas and panned slowly.
    const nebulaCanvas = document.createElement("canvas");
    const nebulaCtx = nebulaCanvas.getContext("2d");
    if (!nebulaCtx) return;
    let nebulaOffset = 0;

    type Star = {
      x: number;
      y: number;
      r: number;
      baseA: number;
      tw: number;
      phase: number;
      color: string;
    };
    let stars: Star[] = [];

    type Dust = {
      x: number;
      y: number;
      r: number;
      a: number;
      dx: number;
      dy: number;
    };
    let dust: Dust[] = [];

    const buildNebula = () => {
      const w = width;
      const h = height;
      nebulaCanvas.width = w * dpr;
      nebulaCanvas.height = h * dpr;
      nebulaCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nebulaCtx.clearRect(0, 0, w, h);

      // Deep base wash.
      const base = nebulaCtx.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, "#0b0d1a");
      base.addColorStop(0.5, "#0d0b18");
      base.addColorStop(1, "#120b1c");
      nebulaCtx.fillStyle = base;
      nebulaCtx.fillRect(0, 0, w, h);

      const max = Math.max(w, h);

      // Large soft nebula clouds.
      const clouds = [
        { x: w * 0.25, y: h * 0.35, r: max * 0.55, color: "rgba(88, 66, 166, 0.22)" },
        { x: w * 0.75, y: h * 0.28, r: max * 0.45, color: "rgba(66, 92, 166, 0.20)" },
        { x: w * 0.55, y: h * 0.72, r: max * 0.50, color: "rgba(166, 72, 96, 0.16)" },
        { x: w * 0.15, y: h * 0.78, r: max * 0.40, color: "rgba(56, 120, 160, 0.14)" },
      ];

      for (const c of clouds) {
        const g = nebulaCtx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        g.addColorStop(0, c.color);
        g.addColorStop(0.5, c.color.replace(/[\d.]+\)$/, "0.05)"));
        g.addColorStop(1, "rgba(0,0,0,0)");
        nebulaCtx.fillStyle = g;
        nebulaCtx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
      }

      // Subtle filament strands.
      nebulaCtx.globalCompositeOperation = "screen";
      const filaments = [
        { x1: -w * 0.1, y1: h * 0.85, cpX: w * 0.35, cpY: h * 0.45, x2: w * 0.6, y2: h * 0.75, color: "rgba(200, 120, 255, 0.10)" },
        { x1: w * 0.55, y1: -h * 0.1, cpX: w * 0.75, cpY: h * 0.55, x2: w * 1.1, y2: h * 0.65, color: "rgba(255, 140, 120, 0.08)" },
        { x1: w * 0.1, y1: h * 0.2, cpX: w * 0.45, cpY: h * 0.5, x2: w * 0.7, y2: h * 0.25, color: "rgba(120, 180, 255, 0.07)" },
      ];
      for (const f of filaments) {
        const g = nebulaCtx.createLinearGradient(f.x1, f.y1, f.x2, f.y2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.4, f.color);
        g.addColorStop(0.7, f.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        nebulaCtx.strokeStyle = g;
        nebulaCtx.lineWidth = max * 0.045;
        nebulaCtx.lineCap = "round";
        nebulaCtx.beginPath();
        nebulaCtx.moveTo(f.x1, f.y1);
        nebulaCtx.quadraticCurveTo(f.cpX, f.cpY, f.x2, f.y2);
        nebulaCtx.stroke();
      }
      nebulaCtx.globalCompositeOperation = "source-over";
    };

    const buildStars = () => {
      const area = width * height;
      const budget = isLowPower ? 0.5 : 0.8;
      const farCount = Math.floor(Math.min(220, area / 8000) * budget);
      const midCount = Math.floor(Math.min(90, area / 20000) * budget);
      const nearCount = Math.floor(Math.min(28, area / 70000) * budget);
      const count = farCount + midCount + nearCount;

      const palettes = {
        far: ["200,210,255", "220,220,240", "255,235,225"],
        mid: ["210,200,255", "200,220,255", "255,210,200"],
        near: ["255,235,210", "200,230,255", "255,200,220"],
      };

      stars = Array.from({ length: count }, (_, i) => {
        const layer =
          i < farCount ? "far" : i < farCount + midCount ? "mid" : "near";
        const r =
          layer === "far" ? 0.4 + Math.random() * 0.6
          : layer === "mid" ? 0.8 + Math.random() * 0.9
          : 1.2 + Math.random() * 1.2;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r,
          baseA: layer === "far" ? 0.35 : layer === "mid" ? 0.55 : 0.8,
          tw: 0.4 + Math.random() * 1.4,
          phase: Math.random() * Math.PI * 2,
          color: palettes[layer][Math.floor(Math.random() * palettes[layer].length)],
        };
      });
    };

    const buildDust = () => {
      const count = isLowPower ? 18 : 32;
      dust = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.5 + Math.random() * 1.2,
        a: 0.05 + Math.random() * 0.12,
        dx: (Math.random() - 0.5) * 0.15,
        dy: (Math.random() - 0.5) * 0.15 - 0.05,
      }));
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width || window.innerWidth;
      height = bounds.height || window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNebula();
      buildStars();
      buildDust();
    };

    const drawStar = (s: Star, t: number) => {
      const tw = Math.sin(t * 0.002 * s.tw + s.phase);
      const alpha = s.baseA + tw * 0.22;
      if (alpha <= 0) return;
      const a = Math.max(0, Math.min(1, alpha));
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${s.color})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.r > 1.1) {
        ctx.globalAlpha = a * 0.2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const draw = (t: number) => {
      ctx.fillStyle = "#0a0b14";
      ctx.fillRect(0, 0, width, height);

      // Slowly pan nebula layer.
      nebulaOffset = (nebulaOffset + 0.05) % width;
      ctx.drawImage(nebulaCanvas, -nebulaOffset, 0, width * dpr, height * dpr);
      ctx.drawImage(nebulaCanvas, width - nebulaOffset, 0, width * dpr, height * dpr);

      // Stars flicker independently.
      for (const s of stars) drawStar(s, t);

      // Drifting dust.
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (const p of dust) {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0) p.x += width;
        if (p.x > width) p.x -= width;
        if (p.y < 0) p.y += height;
        if (p.y > height) p.y -= height;
        ctx.globalAlpha = p.a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={(el) => {
        canvasRef.current = el;
        if (el) onCanvasReady?.(el);
      }}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-dvh w-screen -z-10"
    />
  );
}
