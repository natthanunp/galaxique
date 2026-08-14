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
  /** Community vibe stats — shifts the nebula cloud and star colors
   *  to reflect the dominant vibe of all users. */
  vibeStats?: Record<string, number> | null;
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
export function StarfieldBackground({ onCanvasReady, vibeStats }: StarfieldBackgroundProps = {}) {
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

    // ─── Vibe-driven color blending ────────────────────────────────
    // Each vibe has a primary and secondary cloud color (RGB). The final
    // nebula palette is a weighted blend of ALL vibes by their community
    // percentage, so every community's sky looks unique.
    const VIBE_CLOUD_COLORS: Record<string, { primary: [number, number, number]; secondary: [number, number, number] }> = {
      cute:       { primary: [244, 114, 182], secondary: [251, 146, 180] },  // pink/rose
      cozy:       { primary: [251, 191, 36],  secondary: [252, 211, 77] },   // amber/gold
      mysterious: { primary: [124, 58, 237],  secondary: [99, 102, 241] },   // purple/indigo
      intense:    { primary: [239, 68, 68],   secondary: [249, 115, 22] },   // red/orange
      whimsical:  { primary: [52, 211, 153],  secondary: [110, 231, 183] },  // emerald/teal
      cynical:    { primary: [100, 116, 139],  secondary: [148, 163, 184] },  // slate/gray
    };

    // Default fallback (the original blue/warm palette) when no stats.
    const DEFAULT_PRIMARY: [number, number, number] = [84, 152, 238];
    const DEFAULT_SECONDARY: [number, number, number] = [254, 119, 72];

    function blendVibeColors(stats: Record<string, number> | null | undefined): {
      primary: [number, number, number];
      secondary: [number, number, number];
      starCool: string[];
      starWarm: string[];
    } {
      if (!stats || Object.keys(stats).length === 0) {
        return {
          primary: DEFAULT_PRIMARY,
          secondary: DEFAULT_SECONDARY,
          starCool: ["200,210,255", "230,225,255", "255,235,225"],
          starWarm: ["255,210,200", "255,225,180", "240,200,255"],
        };
      }

      const total = Object.values(stats).reduce((s, v) => s + v, 0) || 1;
      let pr = 0, pg = 0, pb = 0;   // primary blend
      let sr = 0, sg = 0, sb = 0;   // secondary blend

      for (const [vibe, count] of Object.entries(stats)) {
        const w = count / total;
        const colors = VIBE_CLOUD_COLORS[vibe];
        if (!colors) continue;
        pr += colors.primary[0] * w;
        pg += colors.primary[1] * w;
        pb += colors.primary[2] * w;
        sr += colors.secondary[0] * w;
        sg += colors.secondary[1] * w;
        sb += colors.secondary[2] * w;
      }

      // Generate star palettes from the blended colors (lighter/desaturated).
      const blendRgb = `${Math.round(pr)},${Math.round(pg)},${Math.round(pb)}`;
      const blendSecondary = `${Math.round(sr)},${Math.round(sg)},${Math.round(sb)}`;
      // Cool stars: tint toward blue-ish; warm stars: tint toward the blend.
      const starCool = [blendRgb, "220,220,240", "255,250,255"];
      const starWarm = [blendSecondary, "255,235,225", "240,200,255"];

      return {
        primary: [Math.round(pr), Math.round(pg), Math.round(pb)],
        secondary: [Math.round(sr), Math.round(sg), Math.round(sb)],
        starCool,
        starWarm,
      };
    }

    const blended = blendVibeColors(vibeStats);

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

    // ─── Auto-motion offsets (no mouse dependency) ────────────────
    // Each layer drifts at its own speed, creating depth without input.

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

      const cool = blended.starCool;
      const warm = blended.starWarm;
      const neutral = ["220,220,240", "255,250,255"];

      far = buildStars(farCount, 0.8, 2.0, 0.25, 0.25, 0.3, 0.8, neutral);
      mid = buildStars(midCount, 1.2, 3.0, 0.35, 0.3, 0.5, 1.2, cool);
      near = buildStars(nearCount, 1.8, 4.0, 0.55, 0.3, 0.7, 1.6, warm);

      const sceneSize = Math.max(width, height);
      const filamentScale = Math.min(1, width / 768);
      const filamentAlpha = Math.min(1, 0.6 + width / 768 * 0.4);

      // Nebula clouds use the blended vibe colors.
      const [pr, pg, pb] = blended.primary;
      const [sr, sg, sb] = blended.secondary;
      const darken = (r: number, g: number, b: number, a: number) =>
        `rgba(${r}, ${g}, ${b}, ${a})`;

      clouds = [
        { x: width * 0.48, y: height * 0.36, r: sceneSize * 0.57, hue: darken(pr, pg, pb, 0.55), speed: 0.011, phase: 0.3, stretchX: 1.25, stretchY: 0.82 },
        { x: width * 0.56, y: height * 0.52, r: sceneSize * 0.43, hue: darken(sr, sg, sb, 0.48), speed: 0.015, phase: 1.9, stretchX: 1.1, stretchY: 0.66 },
        { x: width * 0.28, y: height * 0.62, r: sceneSize * 0.38, hue: darken(pr, pg, pb, 0.42), speed: 0.013, phase: 2.8, stretchX: 0.6, stretchY: 1.25 },
        { x: width * 0.87, y: height * 0.29, r: sceneSize * 0.35, hue: darken(sr, sg, sb, 0.38), speed: 0.01, phase: 4.1, stretchX: 0.62, stretchY: 1.35 },
        { x: width * 0.73, y: height * 0.74, r: sceneSize * 0.42, hue: darken(20, 44, 76, 0.6), speed: 0.009, phase: 5.2, stretchX: 1.35, stretchY: 0.56 },
      ];
      filaments = [
        { startX: -width * 0.08, startY: height * 0.82, controlX: width * 0.2, controlY: height * 0.38, endX: width * 0.55, endY: height * 0.7, width: sceneSize * 0.055 * filamentScale, color: darken(sr, sg, sb, 0.45 * filamentAlpha), speed: 0.018, phase: 0.2 },
        { startX: width * 0.68, startY: -height * 0.04, controlX: width * 0.84, controlY: height * 0.42, endX: width * 1.04, endY: height * 0.72, width: sceneSize * 0.048 * filamentScale, color: darken(pr, pg, pb, 0.4 * filamentAlpha), speed: 0.014, phase: 1.6 },
        { startX: width * 0.1, startY: height * 0.15, controlX: width * 0.34, controlY: height * 0.48, endX: width * 0.65, endY: height * 0.27, width: sceneSize * 0.034 * filamentScale, color: darken(sr, sg, sb, 0.35 * filamentAlpha), speed: 0.012, phase: 3.7 },
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
      // Breathing: clouds slowly pulse in scale.
      const breathe = 1 + Math.sin(t * 0.0004 + c.phase) * 0.08;
      const x = c.x + driftX;
      const y = c.y + driftY;
      context.save();
      context.translate(x, y);
      context.scale(c.stretchX * breathe, c.stretchY * breathe);
      const g = context.createRadialGradient(0, 0, 0, 0, 0, c.r);
      g.addColorStop(0, c.hue);
      g.addColorStop(0.4, c.hue.replace(/[\d.]+\)$/, "0.15)"));
      g.addColorStop(0.7, c.hue.replace(/[\d.]+\)$/, "0.06)"));
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

    // ─── Shooting stars ──────────────────────────────────────────────
    interface ShootingStar {
      x: number; y: number;
      vx: number; vy: number;
      life: number; maxLife: number;
      length: number;
      hue: string;
    }
    let shootingStars: ShootingStar[] = [];
    const MAX_SHOOTING_STARS = 3;

    function spawnShootingStar() {
      if (shootingStars.length >= MAX_SHOOTING_STARS) return;
      const startX = Math.random() * width;
      const startY = Math.random() * height * 0.5;
      const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.2; // mostly diagonal down-right
      const speed = 2 + Math.random() * 3;
      const [pr, pg, pb] = blended.primary;
      shootingStars.push({
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 40 + Math.random() * 30,
        length: 50 + Math.random() * 80,
        hue: `${pr},${pg},${pb}`,
      });
    }

    // Auto-spawn shooting stars at random intervals.
    let lastShootingStarSpawn = 0;
    const SHOOTING_STAR_INTERVAL = 2000 + Math.random() * 3000; // 2-5 seconds

    function drawShootingStar(s: ShootingStar) {
      const c = ctx!; // Guaranteed non-null: only called from draw() which checks ctx.
      const progress = s.life / s.maxLife;
      const alpha = progress < 0.1 ? progress * 10 : 1 - (progress - 0.1) / 0.9;
      const tailX = s.x - s.vx * s.length * 0.03;
      const tailY = s.y - s.vy * s.length * 0.03;

      const grad = c.createLinearGradient(tailX, tailY, s.x, s.y);
      grad.addColorStop(0, `rgba(${s.hue}, 0)`);
      grad.addColorStop(0.7, `rgba(${s.hue}, ${alpha * 0.5})`);
      grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);

      c.beginPath();
      c.moveTo(tailX, tailY);
      c.lineTo(s.x, s.y);
      c.strokeStyle = grad;
      c.lineWidth = 3.5;
      c.stroke();

      // Bright head.
      c.beginPath();
      c.arc(s.x, s.y, 4, 0, Math.PI * 2);
      c.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      c.fill();
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      // Refresh nebula clouds at a gentle cadence — fast enough for breathing
      // to look smooth (250ms), slow enough to not waste fill-rate.
      if (t - lastCloudRender >= 250) renderClouds(t);
      ctx.drawImage(cloudCanvas, 0, 0, width, height);

      // Auto-pan drift — each layer moves at different speed for depth.
      const tSec = t * 0.001;

      // 1. Far stars — slowest drift, wide arcs.
      const fx = Math.sin(tSec * 0.02) * 20 + Math.cos(tSec * 0.013) * 10;
      const fy = Math.cos(tSec * 0.017) * 14 + Math.sin(tSec * 0.01) * 6;
      for (const s of far) drawStar(s, t, fx, fy);

      // 2. Mid stars — medium drift.
      const mx = Math.sin(tSec * 0.04 + 1) * 16 + Math.cos(tSec * 0.025) * 8;
      const my = Math.cos(tSec * 0.035 + 2) * 12 + Math.sin(tSec * 0.02) * 5;
      for (const s of mid) drawStar(s, t, mx, my);

      // 3. Near stars — fastest drift, closest feel.
      const nax = Math.sin(tSec * 0.06 + 3) * 12 + Math.cos(tSec * 0.04) * 6;
      const nay = Math.cos(tSec * 0.05 + 4) * 9 + Math.sin(tSec * 0.03) * 4;
      for (const s of near) drawStar(s, t, nax, nay);

      // 4. Shooting stars — auto-spawn and animate.
      if (t - lastShootingStarSpawn > SHOOTING_STAR_INTERVAL) {
        spawnShootingStar();
        lastShootingStarSpawn = t;
      }
      shootingStars = shootingStars.filter((s) => {
        s.life++;
        s.x += s.vx;
        s.y += s.vy;
        if (s.life > s.maxLife) return false;
        drawShootingStar(s);
        return true;
      });

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };

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
