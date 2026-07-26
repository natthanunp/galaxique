"use client";

import { useEffect, useRef } from "react";

import { isFirefoxOrEdgeUA } from "@/lib/perf";

interface StarfieldBackgroundProps {
  /** Called once the starfield <canvas> is mounted, exposing the raw
   *  Canvas2D element. The /reveal page uses this so the export
   *  pipeline can composite the starfield into the downloaded image
   *  (the live R3F canvas is transparent over the starfield; without
   *  compositing both, exports look like a flat silhouette). */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

/**
 * A 2D canvas starfield that *feels* 3D:
 *  - Three layers of stars at different "depths" (parallax), each with
 *    independent size, alpha, and twinkle speed.
 *  - A couple of large, soft, slowly-drifting nebula clouds painted as
 *    radial gradients, tinted with the cosmic accent.
 *  - Subtle mouse-driven parallax: when the user moves the mouse, the
 *    foreground layer shifts a few pixels and the background layer shifts
 *    slightly opposite — giving a sense of depth.
 *  - A slow auto-pan so the background is never static, even when the
 *    user isn't moving the mouse.
 *
 * Kept as plain Canvas2D (no Three.js) so it renders instantly on the
 * landing and quiz pages before the heavy 3D canvas loads on /reveal.
 */
export function StarfieldBackground({ onCanvasReady }: StarfieldBackgroundProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const reducedCanvasBudget = isFirefoxOrEdgeUA();
    const dpr = Math.min(window.devicePixelRatio || 1, reducedCanvasBudget ? 1 : 2);
    const cloudCanvas = document.createElement("canvas");
    const cloudCtx = cloudCanvas.getContext("2d");
    if (!cloudCtx) return;
    let lastCloudRender = -Infinity;

    let width = 0;
    let height = 0;

    // Three star layers — far (small, slow), mid, near (big, fast).
    type Star = { x: number; y: number; r: number; baseA: number; tw: number; phase: number; color: string };
    let far: Star[] = [];
    let mid: Star[] = [];
    let near: Star[] = [];

    // A couple of soft nebula clouds.
    type Cloud = { x: number; y: number; r: number; hue: string; speed: number; phase: number };
    let clouds: Cloud[] = [];

    // Mouse-driven parallax offsets.
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1; // -1..1
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      parallax.tx = nx;
      parallax.ty = ny;
    };

    const buildStars = (n: number, rMin: number, rMax: number, aBase: number, aJitter: number, twMin: number, twMax: number, palette: string[]): Star[] => {
      return Array.from({ length: n }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * (rMax - rMin) + rMin,
        baseA: aBase + Math.random() * aJitter,
        tw: Math.random() * (twMax - twMin) + twMin,
        phase: Math.random() * Math.PI * 2,
        color: palette[Math.floor(Math.random() * palette.length)],
      }));
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scales with screen area, capped.
      const area = width * height;
      const starBudget = reducedCanvasBudget ? 0.6 : 1;
      const farCount = Math.floor(Math.min(280, Math.floor(area / 6000)) * starBudget);
      const midCount = Math.floor(Math.min(120, Math.floor(area / 14000)) * starBudget);
      const nearCount = Math.floor(Math.min(40, Math.floor(area / 50000)) * starBudget);

      const cool = ["200,210,255", "230,225,255", "255,235,225"];
      const warm = ["255,210,200", "255,225,180", "240,200,255"];
      const neutral = ["220,220,240", "255,250,255"];

      far = buildStars(farCount, 0.3, 0.9, 0.25, 0.25, 0.3, 0.8, neutral);
      mid = buildStars(midCount, 0.6, 1.4, 0.35, 0.3, 0.5, 1.2, cool);
      near = buildStars(nearCount, 1.0, 2.2, 0.55, 0.3, 0.7, 1.6, warm);

      clouds = [
        { x: width * 0.2, y: height * 0.3, r: Math.max(width, height) * 0.5, hue: "rgba(140,120,255,0.18)", speed: 0.012, phase: 0 },
        { x: width * 0.8, y: height * 0.7, r: Math.max(width, height) * 0.45, hue: "rgba(255,140,200,0.14)", speed: 0.015, phase: 1.2 },
        { x: width * 0.5, y: height * 0.15, r: Math.max(width, height) * 0.35, hue: "rgba(120,200,255,0.10)", speed: 0.01, phase: 2.5 },
      ];

      cloudCanvas.width = canvas.width;
      cloudCanvas.height = canvas.height;
      cloudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderClouds(0);
    };

    const drawStar = (s: Star, t: number, ox: number, oy: number) => {
      const a = Math.max(0, s.baseA + Math.sin(t * 0.001 * s.tw + s.phase) * 0.3);
      ctx.beginPath();
      ctx.arc(s.x + ox, s.y + oy, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${s.color}, ${a})`;
      ctx.fill();
      // Subtle glow for the larger stars.
      if (s.r > 1.2) {
        ctx.beginPath();
        ctx.arc(s.x + ox, s.y + oy, s.r * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.color}, ${a * 0.18})`;
        ctx.fill();
      }
    };

    const drawCloud = (context: CanvasRenderingContext2D, c: Cloud, t: number) => {
      const driftX = Math.sin(t * 0.001 * c.speed + c.phase) * 18;
      const driftY = Math.cos(t * 0.001 * c.speed * 0.7 + c.phase) * 12;
      const x = c.x + driftX;
      const y = c.y + driftY;
      const g = context.createRadialGradient(x, y, 0, x, y, c.r);
      g.addColorStop(0, c.hue);
      g.addColorStop(0.6, c.hue.replace(/[\d.]+\)$/, "0.06)"));
      g.addColorStop(1, c.hue.replace(/[\d.]+\)$/, "0)"));
      context.fillStyle = g;
      context.fillRect(0, 0, width, height);
    };

    const renderClouds = (t: number) => {
      cloudCtx.clearRect(0, 0, width, height);
      for (const c of clouds) drawCloud(cloudCtx, c, t);
      lastCloudRender = t;
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      // Radial gradients are expensive to paint in Firefox. Refresh them at a
      // gentle cadence and reuse the cached layer for the intervening frames.
      if (t - lastCloudRender >= 750) renderClouds(t);
      ctx.drawImage(cloudCanvas, 0, 0, width, height);

      // Smooth parallax toward target.
      parallax.x += (parallax.tx - parallax.x) * 0.05;
      parallax.y += (parallax.ty - parallax.y) * 0.05;

      // Auto-pan drift (very slow).
      const tSec = t * 0.001;
      const autoX = Math.sin(tSec * 0.05) * 8;
      const autoY = Math.cos(tSec * 0.04) * 6;

      // 1. Far stars — small, slow, with mild parallax opposite to mouse.
      const fx = -parallax.x * 6 + autoX * 0.3;
      const fy = -parallax.y * 6 + autoY * 0.3;
      for (const s of far) drawStar(s, t, fx, fy);

      // 2. Mid stars — moderate parallax.
      const mx = -parallax.x * 12 + autoX * 0.7;
      const my = -parallax.y * 12 + autoY * 0.7;
      for (const s of mid) drawStar(s, t, mx, my);

      // 3. Near stars — strongest parallax, biggest twinkle.
      const nx = -parallax.x * 22 + autoX;
      const ny = -parallax.y * 22 + autoY;
      for (const s of near) drawStar(s, t, nx, ny);

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={(el) => {
        canvasRef.current = el;
        if (el) onCanvasReady?.(el);
      }}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
