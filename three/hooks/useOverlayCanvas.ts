"use client";

import { useCallback, useRef } from "react";

interface OverlayInfo {
  albumArtUrl: string | null;
  trackName: string;
  artist: string;
  reading: string;
  vibe: string;
  language: "en" | "th";
}

interface StartOverlayOptions {
  /** The live Three.js canvas to mirror frame-by-frame. */
  source: HTMLCanvasElement;
  /** Maximum compositor rate. Match this to captureStream() so the overlay
   *  does not redraw a full 1080x1920 frame more often than the recorder can
   *  retain it. */
  fps?: number;
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
  /** Pre-loads the Noto Sans Thai font family so the first exported frame
   *  already uses the correct typeface instead of a fallback. Call before
   *  `start()` for video exports; `drawOnce()` loads it automatically. */
  loadFonts: () => Promise<void>;
  stop: () => void;
}

/** Thai translations for the LLM's `vibe` enum values, shown in the
 *  exported story card label. */
const VIBE_TH: Record<string, string> = {
  cute: "น่ารัก",
  cozy: "อบอุ่น",
  mysterious: "ลึกลับ",
  intense: "เข้มข้น",
  whimsical: "เพ้อฝัน",
  cynical: "เย็นชา",
};

/** Reads the Noto Sans Thai font family from the CSS variable that
 *  `next/font/google` sets in layout.tsx. Falls back to a direct Google
 *  family name if the variable isn't available yet. */
function getThaiFontFamily(): string {
  if (typeof window === "undefined") return '"Noto Sans Thai", sans-serif';
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-noto-sans-thai")
    .trim();
  if (!family) return '"Noto Sans Thai", sans-serif';
  // Strip any existing quotes and re-wrap so multi-word family names like
  // "Noto Sans Thai" are parsed correctly by the canvas font renderer.
  const clean = family.replace(/^["']|["']$/g, "");
  return `"${clean}", sans-serif`;
}

/** Builds a canvas font string using Noto Sans Thai so Thai glyphs render
 *  consistently with the rest of the app. */
function fontString(weight: number | string, sizePx: number): string {
  return `${weight} ${sizePx}px ${getThaiFontFamily()}`;
}

/** Composites the live R3F canvas + a glass-card reading overlay onto an
 *  offscreen canvas via a requestAnimationFrame loop, so the exported share
 *  video matches the in-app reveal design. */
export function useOverlayCanvas(): UseOverlayCanvasResult {
  const rafRef = useRef<number | null>(null);

  const loadFonts = useCallback(async (): Promise<void> => {
    if (typeof document === "undefined" || !document.fonts) return;
    const family = getThaiFontFamily();
    const H = IG_STORY_H;
    const sizes = [
      `600 ${Math.max(18, Math.round(H * 0.024))}px ${family}`,
      `${Math.max(14, Math.round(H * 0.019))}px ${family}`,
      `500 ${Math.max(12, Math.round(H * 0.017))}px ${family}`,
      `${Math.max(13, Math.round(H * 0.020))}px ${family}`,
      `${Math.max(15, Math.round(H * 0.022))}px ${family}`,
    ];
    await Promise.all(sizes.map((spec) => document.fonts.load(spec)));
  }, []);

  const start = useCallback(({ source, background, info, fps = 30 }: StartOverlayOptions) => {
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

    const frameIntervalMs = 1_000 / fps;
    let lastDrawAt = -Infinity;
    const draw = (now: number) => {
      if (now - lastDrawAt >= frameIntervalMs) {
        drawFrame(ctx, source, background ?? null, art, info);
        lastDrawAt = now;
      }
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
   *  Composites in this order: (1) dark cosmic fill, (2) optional starfield,
   *  (3) the live R3F canvas cover-fit over the whole frame, (4) a rounded
   *  glass card at the bottom containing the vibe label, reading, and the
   *  now-playing track row. */
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

      return artPromise
        .then(async (art) => {
          await loadFonts();
          return art;
        })
        .then((art) => {
          drawFrame(ctx, source, background ?? null, art, info);
          return canvas;
        });
    },
    [loadFonts],
  );

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  return { start, drawOnce, loadFonts, stop };
}

// Instagram Story spec: 1080x1920, 9:16 portrait. The export on a 1x
// display uses native 1080p; on Retina/2x+ displays we render at 2x the
// linear resolution so the composited frame retains crispness from the
// higher-dpr R3F canvas. Capped at 2x (2160x3840) to keep the overlay
// rAF loop and MediaRecorder manageable on mobile.
const IG_RENDER_DPR = typeof window !== "undefined"
  ? Math.min(window.devicePixelRatio || 1, 2)
  : 1;
const IG_STORY_W = Math.round(1080 * IG_RENDER_DPR);
const IG_STORY_H = Math.round(1920 * IG_RENDER_DPR);

// Page background color used for the card gradient (matches
// `bg-background`: hsl(240 20% 4%)).
const BG_H = 240;
const BG_S = 20;
const BG_L = 4;
const PAGE_BG = "#05050a";

function backgroundAlpha(a: number): string {
  return `hsla(${BG_H}, ${BG_S}%, ${BG_L}%, ${a})`;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  background: HTMLCanvasElement | null,
  art: HTMLImageElement | null,
  info: OverlayInfo,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // 1. Dark cosmic fill so any transparent pixels in the source don't
  //    show as white in the exported PNG/video.
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, W, H);

  // 2. Optional starfield background scaled to cover the whole frame.
  if (background) {
    drawCover(ctx, background, 0, 0, W, H);
  }

  // 3. R3F canvas "cover"-fit over the full story frame. Source is
  //    landscape; portrait story is narrower — scale up so the height
  //    fills, then center-crop horizontally. The central scene is fully
  //    visible through the top portion of the card's translucent scrim.
  drawCover(ctx, source, 0, 0, W, H);

  // 4. Glass reading card — rounded, translucent, and docked at the
  //    bottom so the exported story matches the in-app
  //    PersonalityReading card style.
  const margin = Math.round(W * 0.04);
  const pad = Math.round(W * 0.035);
  const cardR = Math.round(W * 0.03);
  const cardLeft = margin;
  const cardRight = W - margin;
  const cardW = cardRight - cardLeft;

  const artSize = Math.round(H * 0.045);
  const trackNameSize = Math.max(16, Math.round(H * 0.0215));
  const artistSize = Math.max(13, Math.round(H * 0.0175));
  const vibeSize = Math.max(11, Math.round(H * 0.0155));
  const readingMaxSize = Math.max(15, Math.round(H * 0.022));
  const readingMinSize = Math.max(13, Math.round(H * 0.016));

  const artReady = Boolean(art?.complete && art.naturalWidth > 0);
  const textX = cardLeft + pad * 2 + (artReady ? artSize : 0);
  const readingMaxWidth = cardW - pad * 2;

  const cardBottom = H - Math.round(H * 0.04);
  const maxCardHeight = Math.round(H * 0.56);
  const topPad = Math.round(pad * 0.9);
  const readingGap = Math.round(pad * 0.9);
  const bottomPad = Math.round(pad * 0.8);
  const trackRowH = artReady ? artSize : trackNameSize + artistSize + Math.round(vibeSize * 0.4);
  const maxReadingHeight = Math.max(
    readingMinSize * 1.32,
    maxCardHeight - topPad - trackRowH - readingGap - bottomPad,
  );

  // Fit the whole reading into the available vertical space, shrinking the
  // font only as much as needed. Very long readings scale down instead of
  // being truncated at an arbitrary line count.
  const {
    size: readingSize,
    lineHeight: readingLineHeight,
    lines: readingLines,
  } = fitReadingText(
    ctx,
    info.reading,
    readingMaxWidth,
    maxReadingHeight,
    readingMaxSize,
    readingMinSize,
    info.language,
  );

  // Size the card to the reading rather than docking it to the bottom of
  // the entire story frame. This leaves the scene visible around it instead
  // of creating a large, empty panel below a short reading.
  const cardHeight = topPad + trackRowH + readingGap
    + readingLines.length * readingLineHeight + bottomPad;
  const cardTop = Math.max(Math.round(H * 0.18), cardBottom - cardHeight);
  const trackTop = cardTop + topPad;
  const readingTop = trackTop + trackRowH + readingGap;

  // Card fill: same `bg-linear-to-t from-background/70 via-background/15
  // to-transparent` style used by PersonalityReading.
  const cardGradient = ctx.createLinearGradient(0, cardTop, 0, cardBottom);
  cardGradient.addColorStop(0, backgroundAlpha(0));
  cardGradient.addColorStop(0.25, backgroundAlpha(0.08));
  cardGradient.addColorStop(0.55, backgroundAlpha(0.32));
  cardGradient.addColorStop(1, backgroundAlpha(0.72));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cardLeft + cardR, cardTop);
  ctx.lineTo(cardRight - cardR, cardTop);
  ctx.arcTo(cardRight, cardTop, cardRight, cardTop + cardR, cardR);
  ctx.lineTo(cardRight, cardBottom - cardR);
  ctx.arcTo(cardRight, cardBottom, cardRight - cardR, cardBottom, cardR);
  ctx.lineTo(cardLeft + cardR, cardBottom);
  ctx.arcTo(cardLeft, cardBottom, cardLeft, cardBottom - cardR, cardR);
  ctx.lineTo(cardLeft, cardTop + cardR);
  ctx.arcTo(cardLeft, cardTop, cardLeft + cardR, cardTop, cardR);
  ctx.closePath();
  ctx.fillStyle = cardGradient;
  ctx.fill();
  // Subtle border matching `border-border/70`.
  ctx.strokeStyle = "hsla(240, 20%, 16%, 0.7)";
  ctx.lineWidth = Math.max(1, Math.round(IG_RENDER_DPR));
  ctx.stroke();
  ctx.restore();

  // Track info row at the top of the card.
  if (art && artReady) {
    const r = Math.round(cardR * 0.6);
    const x = cardLeft + pad;
    const y = trackTop;
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

  const vibeLabel =
    info.language === "th"
      ? `${VIBE_TH[info.vibe] ?? info.vibe}`
      : info.vibe;
  const vibeLabelFull =
    info.language === "th" ? `โทนของคุณ · ${vibeLabel}` : `Your vibe · ${vibeLabel}`;

  // Song name + artist get the full width minus a small right margin.
  // The vibe label sits on a second line aligned right so it never
  // truncates the title.
  const maxTextWidth = cardRight - textX - pad;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = fontString(600, trackNameSize);
  ctx.fillText(
    truncateToWidth(ctx, info.trackName, maxTextWidth),
    textX,
    trackTop + artSize * 0.42,
  );
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = fontString("normal", artistSize);
  ctx.fillText(
    truncateToWidth(ctx, info.artist, maxTextWidth),
    textX,
    trackTop + artSize * 0.78,
  );

  // Vibe label — top-right of the card, on its own line beside the artist.
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = fontString(500, vibeSize);
  ctx.textAlign = "right";
  ctx.fillText(vibeLabelFull, cardRight - pad, trackTop + artSize * 0.78);
  ctx.textAlign = "left";

  // Reading text.
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = fontString("normal", readingSize);
  readingLines.forEach((line, index) => {
    ctx.fillText(line, cardLeft + pad, readingTop + index * readingLineHeight);
  });
}

/** Finds the largest font size (between maxSize and minSize) at which the
 *  full `text` fits inside the available reading height. Returns the chosen
 *  size, its line height, and the wrapped lines. */
function fitReadingText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxSize: number,
  minSize: number,
  language: "en" | "th",
): { size: number; lineHeight: number; lines: string[] } {
  for (let size = maxSize; size >= minSize; size -= 1) {
    const lineHeight = Math.round(size * 1.32);
    const lines = wrapText(ctx, text, maxWidth, size, language);
    if (lines.length * lineHeight <= maxHeight) {
      return { size, lineHeight, lines };
    }
  }
  const lineHeight = Math.round(minSize * 1.32);
  const lines = wrapText(ctx, text, maxWidth, minSize, language);
  return { size: minSize, lineHeight, lines };
}

/** Wrap text to maxWidth. Thai uses the browser's dictionary segmentation
 *  where available, rather than falling back to individual characters. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  language: "en" | "th",
): string[] {
  ctx.font = fontString("normal", fontSize);
  if (language !== "th") {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  const segments = typeof Intl.Segmenter === "function"
    ? Array.from(
      new Intl.Segmenter("th", { granularity: "word" }).segment(text),
      ({ segment }) => segment,
    )
    : text.split(/(\s+)/);
  const lines: string[] = [];
  let line = "";
  for (const segment of segments) {
    if (!segment) continue;
    if (/\s/.test(segment)) {
      line += segment;
      continue;
    }
    if (ctx.measureText(line + segment).width <= maxWidth) {
      line += segment;
      continue;
    }
    if (line.trim()) lines.push(line.trim());
    // Long unbroken runs fall back to character wrapping only when they
    // genuinely exceed the export width.
    let run = "";
    for (const character of segment) {
      if (ctx.measureText(run + character).width > maxWidth && run) {
        lines.push(run.trim());
        run = character;
      } else {
        run += character;
      }
    }
    line = run;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
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
