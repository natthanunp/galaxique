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

    // Layered, uneven clouds give the nebula a more photographic structure.
    type Cloud = {
      x: number;
      y: number;
      r: number;
      hue: string;
      speed: number;
      phase: number;
      stretchX: number;
      stretchY: number;
    };
    let clouds: Cloud[] = [];

    type Filament = {
      startX: number;
      startY: number;
      controlX: number;
      controlY: number;
      endX: number;
      endY: number;
      width: number;
      color: string;
      speed: number;
      phase: number;
    };
    let filaments: Filament[] = [];

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
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width || window.innerWidth;
      height = bounds.height || window.innerHeight;
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

      const sceneSize = Math.max(width, height);
      clouds = [
        { x: width * 0.48, y: height * 0.36, r: sceneSize * 0.57, hue: "rgba(84, 152, 238, 0.32)", speed: 0.011, phase: 0.3, stretchX: 1.25, stretchY: 0.82 },
        { x: width * 0.56, y: height * 0.52, r: sceneSize * 0.43, hue: "rgba(161, 208, 255, 0.27)", speed: 0.015, phase: 1.9, stretchX: 1.1, stretchY: 0.66 },
        { x: width * 0.28, y: height * 0.62, r: sceneSize * 0.38, hue: "rgba(254, 119, 72, 0.22)", speed: 0.013, phase: 2.8, stretchX: 0.6, stretchY: 1.25 },
        { x: width * 0.87, y: height * 0.29, r: sceneSize * 0.35, hue: "rgba(231, 81, 61, 0.19)", speed: 0.01, phase: 4.1, stretchX: 0.62, stretchY: 1.35 },
        { x: width * 0.73, y: height * 0.74, r: sceneSize * 0.42, hue: "rgba(20, 44, 76, 0.5)", speed: 0.009, phase: 5.2, stretchX: 1.35, stretchY: 0.56 },
      ];
      filaments = [
        { startX: -width * 0.08, startY: height * 0.82, controlX: width * 0.2, controlY: height * 0.38, endX: width * 0.55, endY: height * 0.7, width: sceneSize * 0.055, color: "rgba(255, 132, 83, 0.24)", speed: 0.018, phase: 0.2 },
        { startX: width * 0.68, startY: -height * 0.04, controlX: width * 0.84, controlY: height * 0.42, endX: width * 1.04, endY: height * 0.72, width: sceneSize * 0.048, color: "rgba(255, 104, 71, 0.2)", speed: 0.014, phase: 1.6 },
        { startX: width * 0.1, startY: height * 0.15, controlX: width * 0.34, controlY: height * 0.48, endX: width * 0.65, endY: height * 0.27, width: sceneSize * 0.034, color: "rgba(161, 214, 255, 0.16)", speed: 0.012, phase: 3.7 },
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
      context.save();
      context.translate(x, y);
      context.scale(c.stretchX, c.stretchY);
      const g = context.createRadialGradient(0, 0, 0, 0, 0, c.r);
      g.addColorStop(0, c.hue);
      g.addColorStop(0.48, c.hue.replace(/[\d.]+\)$/, "0.09)"));
      g.addColorStop(0.74, c.hue.replace(/[\d.]+\)$/, "0.025)"));
      g.addColorStop(1, c.hue.replace(/[\d.]+\)$/, "0)"));
      context.fillStyle = g;
      context.fillRect(-c.r, -c.r, c.r * 2, c.r * 2);
      context.restore();
    };

    const drawFilament = (context: CanvasRenderingContext2D, f: Filament, t: number) => {
      const drift = Math.sin(t * 0.001 * f.speed + f.phase) * 14;
      const gradient = context.createLinearGradient(f.startX, f.startY, f.endX, f.endY);
      gradient.addColorStop(0, "rgba(255, 104, 71, 0)");
      gradient.addColorStop(0.35, f.color);
      gradient.addColorStop(0.7, f.color);
      gradient.addColorStop(1, "rgba(255, 189, 126, 0)");

      context.save();
      context.globalCompositeOperation = "screen";
      context.filter = `blur(${Math.max(8, f.width * 0.18)}px)`;
      context.strokeStyle = gradient;
      context.lineWidth = f.width;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(f.startX, f.startY + drift);
      context.quadraticCurveTo(f.controlX, f.controlY - drift, f.endX, f.endY + drift * 0.5);
      context.stroke();
      context.restore();
    };

    const renderClouds = (t: number) => {
      cloudCtx.clearRect(0, 0, width, height);
      for (const c of clouds) drawCloud(cloudCtx, c, t);
      for (const f of filaments) drawFilament(cloudCtx, f, t);
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
      className="pointer-events-none fixed inset-0 h-dvh w-screen -z-10"
    />
  );
}
