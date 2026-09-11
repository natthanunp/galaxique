"use client";

import { useEffect, useRef } from 'react';
import { COSMIC, communityGrade } from '@/lib/cosmicVisuals';
import { initialQualityTier, tierDprCap, targetDpr } from '@/lib/perf';

interface StarfieldBackgroundProps {
  /** Raw, origin-clean canvas for the image/video composition pipeline. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  vibeStats?: Record<string, number> | null;
}

/** One cached photographic composition plus sparse Canvas2D stars. No WebGL. */
export function StarfieldBackground({ onCanvasReady, vibeStats }: StarfieldBackgroundProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grade = communityGrade(vibeStats);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cache = document.createElement('canvas');
    const baked = cache.getContext('2d');
    if (!baked) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const tier = initialQualityTier();
    const dpr = tierDprCap(tier, targetDpr());
    let width = 0, height = 0, raf = 0, active = true, last = 0;
    let photograph: HTMLImageElement | null = null;
    let source = '';
    let pending: HTMLImageElement | null = null;
    let stars: { x: number; y: number; r: number; phase: number }[] = [];
    const compose = () => {
      baked.setTransform(dpr, 0, 0, dpr, 0, 0);
      baked.fillStyle = COSMIC.background;
      baked.fillRect(0, 0, width, height);
      if (photograph) {
        const scale = Math.max(width / photograph.width, height / photograph.height);
        const w = photograph.width * scale, h = photograph.height * scale;
        baked.drawImage(photograph, (width-w)/2, (height-h)/2, w, h);
      }
      baked.globalCompositeOperation = 'screen';
      baked.globalAlpha = .035;
      baked.fillStyle = grade;
      baked.fillRect(0, 0, width, height);
      baked.globalAlpha = 1;
      baked.globalCompositeOperation = 'source-over';
      // Negative space follows the headline, while the lower disk retains detail.
      const shade = baked.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, 'rgba(3,5,12,.68)');
      shade.addColorStop(.45, 'rgba(3,5,12,.36)');
      shade.addColorStop(.8, 'rgba(3,5,12,.08)');
      shade.addColorStop(1, 'rgba(3,5,12,.5)');
      baked.fillStyle = shade; baked.fillRect(0, 0, width, height);
    };
    const paint = (time: number) => {
      ctx.drawImage(cache, 0, 0, width, height);
      stars.forEach((s, i) => {
        const t = motion.matches ? 0 : time * .001;
        const drift = i % 3 + 1;
        ctx.globalAlpha = .35 + .2 * Math.sin(t * .5 + s.phase);
        ctx.fillStyle = i % 5 ? '#d7e3f6' : '#ffe0b8';
        ctx.beginPath();
        ctx.arc(s.x + Math.sin(t*.025+s.phase)*drift*2, s.y + Math.cos(t*.02+s.phase)*drift, s.r, 0, Math.PI*2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };
    const draw = (time: number) => {
      if (!active || document.hidden || motion.matches) return;
      // The baked sky does not need repainting at high refresh rates.
      if (time-last >= 1000/30-1) { paint(time); last=time; }
      raf = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(raf);
      paint(0);
      if (!document.hidden && !motion.matches) raf=requestAnimationFrame(draw);
    };
    const resize = () => {
      width = window.innerWidth; height = window.innerHeight;
      canvas.width=cache.width=Math.round(width*dpr);
      canvas.height=cache.height=Math.round(height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      let seed=84; const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
      stars=Array.from({length:COSMIC.starBudget[tier]},()=>({x:random()*width,y:random()*height,r:.35+random()*.65,phase:random()*6.28}));
      const next = COSMIC.backgroundUrl(width < 640);
      if (next !== source) {
        source = next;
        const img = new Image(); pending=img;
        img.onload=()=>{ if(active && pending===img) { photograph=img;compose();paint(0); } };
        img.onerror=()=>{ /* The dark sky and sparse stars remain usable. */ };
        img.src=next;
      }
      compose(); resume();
    };
    resize();
    window.addEventListener('resize',resize,{passive:true});
    document.addEventListener('visibilitychange',resume);
    motion.addEventListener('change',resume);
    return () => {
      active=false;cancelAnimationFrame(raf);
      if(pending) {pending.onload=null;pending.onerror=null;}
      window.removeEventListener('resize',resize);
      document.removeEventListener('visibilitychange',resume);
      motion.removeEventListener('change',resume);
    };
  }, [grade]);
  return <canvas ref={el=>{canvasRef.current=el;if(el)onCanvasReady?.(el);}} aria-hidden className="pointer-events-none fixed inset-0 h-dvh w-screen -z-10" />;
}
