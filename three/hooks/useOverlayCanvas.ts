"use client";

import { useCallback, useRef } from "react";

interface OverlayInfo {
  albumArtUrl: string | null;
  trackName: string;
  artist: string;
}

interface StartOverlayOptions {
  /** The live Three.js canvas to mirror frame-by-frame. */
  source: HTMLCanvasElement;
  info: OverlayInfo;
  /** Optional starfield DOM canvas to use as the background of the export.
   *  The source R3F canvas has a transparent background, so without a
   *  starfield the export would be a flat-colored silhouette over a
   *  white PNG. The page passes its `StarfieldBackground` canvas in here. */
  background?: HTMLCanvasElement | null;
}

interface UseOverlayCanvasResult {
  /** Starts mirroring `source` onto an internal offscreen canvas with a
   *  "Now playing" bar (album art + song/artist) composited on top, and
   *  returns that canvas — pass it to useCanvasRecorder's `record()` instead
   *  of the raw Three.js canvas so the export video shows the overlay too.
   *  Call `stop()` once recording finishes (or is cancelled). */
  start: (opts: StartOverlayOptions) => HTMLCanvasElement;
  /** One-shot composite: draw `source` + the "now playing" bar once onto a
   *  fresh canvas and return it. Used for the static screenshot export path
   *  (no recording, no ffmpeg). The returned canvas is `await art` ready
   *  (album art is preloaded before the draw). */
  drawOnce: (
    opts: StartOverlayOptions,
  ) => Promise<HTMLCanvasElement>;
  stop: () => void;
}

/** Composites the live R3F canvas + a bottom "now playing" bar (album art,
 *  track name, artist) onto an offscreen canvas via a requestAnimationFrame
 *  loop, so the exported share video visually includes the Spotify track. */
export function useOverlayCanvas(): UseOverlayCanvasResult {
  const rafRef = useRef<number | null>(null);

  const start = useCallback(({ source, background, info }: StartOverlayOptions) => {
    // Always record in portrait 9:16 (1080x1920 = Instagram Story spec).
    // The R3F source is landscape to fit the page layout; the camera
    // framing and overlay bar are designed for this portrait frame.
    const canvas = document.createElement("canvas");
    canvas.width = IG_STORY_W;
    canvas.height = IG_STORY_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return source; // Defensive fallback — should never happen.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    let art: HTMLImageElement | null = null;
    if (info.albumArtUrl) {
      art = new Image();
      // Keep the canvas "origin-clean" so captureStream() isn't blocked by a
      // tainted-canvas SecurityError. If the CDN doesn't send CORS headers,
      // this image simply fails to load (onerror) and we skip drawing it —
      // recording still proceeds without the art rather than breaking.
      art.crossOrigin = "anonymous";
      art.src = info.albumArtUrl;
    }

    const draw = () => {
      drawFrame(ctx, source, background ?? null, art, info);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return canvas;
  }, []);

  /** Loads album art (if any) and draws a single composite frame onto a
   *  fresh 1080x1920 portrait canvas (Instagram Story size). Resolves
   *  once the album art image is fully loaded (or has failed), so the
   *  returned canvas is ready to be turned into a Blob immediately.
   *
   *  Composites in this order: (1) dark cosmic fill, (2) starfield
   *  scaled to cover the whole frame, (3) the live R3F canvas cover-fit
   *  into the upper area, (4) the gradient now-playing bar at the
   *  bottom with the album art + track/artist text. */
  const drawOnce = useCallback(
    ({ source, background, info }: StartOverlayOptions): Promise<HTMLCanvasElement> => {
      const canvas = document.createElement("canvas");
      canvas.width = IG_STORY_W;
      canvas.height = IG_STORY_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return Promise.resolve(source);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const artPromise = new Promise<HTMLImageElement | null>((resolve) => {
        if (!info.albumArtUrl) return resolve(null);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = info.albumArtUrl!;
      });

      return artPromise.then((art) => {
        drawFrame(ctx, source, background ?? null, art, info);
        return canvas;
      });
    },
    [],
  );

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  return { start, drawOnce, stop };
}

// Instagram Story spec: 1080x1920, 9:16 portrait. The export is a square
// region of pixels no matter the user's viewport or device.
const IG_STORY_W = 1080;
const IG_STORY_H = 1920;
// Height fraction of the bottom "now playing" bar (album art + track/artist).
const BAR_FRAC = 0.11;

function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  background: HTMLCanvasElement | null,
  art: HTMLImageElement | null,
  info: OverlayInfo,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const barH = Math.round(H * BAR_FRAC);
  const viewportH = H - barH; // area for the universe (above the now-playing bar)

  // 1. Dark cosmic fill so any transparent pixels in the source don't
  //    show as white in the exported PNG.
  ctx.fillStyle = "#05050a";
  ctx.fillRect(0, 0, W, H);

  // 2. Starfield background scaled to cover the whole frame. Falls back
  //    to the dark fill if no starfield is supplied.
  if (background) {
    drawCover(ctx, background, 0, 0, W, viewportH);
  }

  // 3. R3F canvas "cover"-fit into the viewport area (above the bar).
  //    Source is landscape; portrait viewport is narrower — scale up so
  //    the height fills, then center-crop horizontally. This way the
  //    universe fills the entire story without letterboxing.
  drawCover(ctx, source, 0, 0, W, viewportH);

  // 4. Bottom gradient "now playing" bar.
  const barY = viewportH;
  const gradient = ctx.createLinearGradient(0, barY - barH * 0.6, 0, H);
  gradient.addColorStop(0, "rgba(5, 5, 10, 0)");
  gradient.addColorStop(0.4, "rgba(5, 5, 10, 0.78)");
  gradient.addColorStop(1, "rgba(5, 5, 10, 0.92)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, barY - barH * 0.6, W, barH * 1.6);

  const pad = Math.round(barH * 0.18);
  const artSize = barH - pad * 2;
  const artReady = Boolean(art?.complete && art.naturalWidth > 0);
  const textX = pad * 2 + (artReady ? artSize : 0);

  if (art && artReady) {
    const r = 18;
    const x = pad;
    const y = barY + pad;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + artSize, y, x + artSize, y + artSize, r);
    ctx.arcTo(x + artSize, y + artSize, x, y + artSize, r);
    ctx.arcTo(x, y + artSize, x, y, r);
    ctx.arcTo(x, y, x + artSize, y, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(art, x, y, artSize, artSize);
    ctx.restore();
  }

  const maxTextWidth = W - textX - pad;
  const nameSize = Math.max(20, Math.round(barH * 0.34));
  const artistSize = Math.max(16, Math.round(barH * 0.26));

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${nameSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(
    truncateToWidth(ctx, info.trackName, maxTextWidth),
    textX,
    barY + barH * 0.48,
  );
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `${artistSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(
    truncateToWidth(ctx, info.artist, maxTextWidth),
    textX,
    barY + barH * 0.78,
  );
}

/** Draws `img` into the (x, y, w, h) rectangle using "cover" fit: scales
 *  uniformly to fill the rectangle, cropping whichever dimension overflows
 *  and centering. Used for the starfield and the R3F canvas so the export
 *  always fills the full frame, regardless of source aspect ratio. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const iw = img.width;
  const ih = img.height;
  if (iw === 0 || ih === 0) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** Binary-searches for the longest prefix of `text` (plus an ellipsis) that
 *  fits within `maxWidth` at the ctx's current font. */
function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "\u2026";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + ellipsis;
}
