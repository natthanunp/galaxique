"use client";

import { useEffect, useState } from "react";
import { PlayIcon, PauseIcon, ExternalLinkIcon, Volume2Icon, AlertCircleIcon, MusicIcon } from "lucide-react";

import { useMediaStore } from "@/store/mediaStore";
import { cn } from "@/lib/utils";
import { mediaProxyUrl } from "@/lib/mediaProxy";
import type { Language } from "@/types/universe";

interface VinylDiscProps {
  /** Backwards-compatible search query from older reveals. */
  query: string;
  /** Exact track selected from the configured playlist for new reveals. */
  trackId?: string | null;
  language: Language;
  /** Primary vibe color used for the disc's center-label glow ring. */
  primaryColor: string;
  /** Disc size preset. "sm" mirrors the original compact corner layout.
   *  "hero" makes the disc the visual focal point of the page (sits in
   *  the center of the viewport, in front of the 3D galaxy). */
  size?: "sm" | "hero";
  /** Adds a soft cosmic aura + ring behind the disc that visually
   *  separates it from a busy galaxy background without forming a hard
   *  border. Defaults to true so the disc "blends in" with the cosmos
   *  while still popping as the hero element. */
  blend?: boolean;
  className?: string;
}

interface Track {
  track_id: string;
  name: string;
  artist: string;
  embed_url: string;
  preview_url: string | null;
  album_art_url: string | null;
}

/** A CSS-animated spinning vinyl disc that displays the song's album art
 *  as the center label. The disc is the song-first focal point of the new
 *  immersive reveal layout: when Spotify metadata resolves, the disc fades
 *  in with a slow ~10s/revolution rotation, pauses when the song is
 *  paused, and shows the track name + artist as floating text beside it.
 *
 *  Track resolution + autoplay is identical to the old SpotifyPlayer —
 *  the same `/api/spotify/search` request, the same `mediaStore` plumbing
 *  (so BackgroundAudio still ducks for the preview). Only the visual
 *  presentation changed: spinning DOM disc instead of a bordered card. */
export function VinylDisc({
  query,
  trackId,
  language,
  primaryColor,
  size = "sm",
  blend = true,
  className,
}: VinylDiscProps) {
  const [track, setTrack] = useState<Track | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const setMediaMode = useMediaStore((s) => s.setMode);
  const setSpotifyUrl = useMediaStore((s) => s.setSpotifyUrl);
  const setStoreTrack = useMediaStore((s) => s.setTrack);
  const isPlaying = useMediaStore((s) => s.isPlaying);
  const setPlaying = useMediaStore((s) => s.setPlaying);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatus("loading");
      setTrack(null);
    });
    setMediaMode("ambient");
    setSpotifyUrl(null);
    setStoreTrack(null);
    setPlaying(false);

    const params = trackId
      ? `id=${encodeURIComponent(trackId)}`
      : `q=${encodeURIComponent(query)}`;
    fetch(`/api/spotify/search?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Search failed (${res.status})`);
        }
        return res.json() as Promise<Track>;
      })
      .then((t) => {
        if (cancelled) return;
        setTrack(t);
        setStatus("ok");
        const albumArtUrl = mediaProxyUrl(t.album_art_url);
        const previewUrl = mediaProxyUrl(t.preview_url);
        setStoreTrack({
          name: t.name,
          artist: t.artist,
          albumArtUrl,
        });
        if (previewUrl) {
          setSpotifyUrl(previewUrl);
          setPlaying(true);
          setMediaMode("spotify");
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMsg(err.message);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      setMediaMode("ambient");
      setSpotifyUrl(null);
      setStoreTrack(null);
      setPlaying(false);
    };
  }, [query, trackId, setMediaMode, setSpotifyUrl, setStoreTrack, setPlaying]);

  // Size preset → tailwind class. "hero" sits centered *inside* the
  // 3D galaxy sphere — the disc is intentionally smaller than the
  // galaxy so the swirling arms are clearly visible *around* it. A
  // soft cosmic aura behind the disc bridges the gap so it feels
  // like the disc is glowing from within the galaxy rather than
  // pasted on top. We also taper the disc on short-tall phones so
  // the reading dock has room below it.
  const discSizeClass =
    size === "hero"
      ? "w-[clamp(118px,22vmin,170px)] sm:w-[clamp(130px,24vmin,210px)]"
      : "w-40 sm:w-44 md:w-48 lg:w-40 xl:w-44";
  const isHero = size === "hero";

  return (
    <div
      className={cn(
        isHero
          ? "relative flex w-fit flex-col items-center text-center"
          : "flex w-full flex-col items-center gap-4 text-center",
        className,
      )}
    >
      <div className="relative flex items-center justify-center">
        {blend && (
          // Cosmic aura — two layered halos behind the disc that
          // visually "absorb" it into the galaxy. The wide outer halo
          // (scaled 1.6× past the disc) is a soft cosmic ring of
          // primary-tinted light that bleeds into the surrounding
          // galaxy, so the disc feels like a portal glowing from
          // inside the cosmos rather than a sticker pasted on top.
          // The inner halo tightens up right at the disc edge so the
          // dark vinyl body never punches a flat hole through the
          // bloom. Both are pointer-events:none so they never block
          // canvas drag.
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div
              className={cn("aspect-square rounded-full", discSizeClass)}
              style={{
                transform: "scale(1.6)",
                background: `radial-gradient(circle at center, ${primaryColor}22 0%, ${primaryColor}10 28%, ${primaryColor}05 50%, transparent 72%)`,
                filter: "blur(22px)",
                opacity: 0.85,
              }}
            />
            <div
              className={cn("absolute aspect-square rounded-full", discSizeClass)}
              style={{
                transform: "scale(1.12)",
                background: `radial-gradient(circle at center, ${primaryColor}30 0%, ${primaryColor}14 45%, transparent 75%)`,
                filter: "blur(10px)",
              }}
            />
          </div>
        )}
        <div
          className={cn(
            "vinyl-disc relative aspect-square rounded-full",
            discSizeClass,
          )}
          style={{
            background: `radial-gradient(circle at center, transparent 0%, transparent 18%, rgba(255,255,255,0.04) 18.5%, rgba(255,255,255,0.04) 19%, transparent 19.5%, transparent 24%, rgba(255,255,255,0.03) 24.5%, rgba(255,255,255,0.03) 25%, transparent 25.5%, transparent 30%, rgba(255,255,255,0.025) 30.5%, rgba(255,255,255,0.025) 31%, transparent 31.5%, transparent 36%, rgba(255,255,255,0.02) 36.5%, rgba(255,255,255,0.02) 37%, transparent 37.5%, transparent 100%), radial-gradient(circle at center, rgba(10,10,15,0.84) 0%, rgba(26,26,34,0.78) 70%, rgba(5,5,10,0.86) 100%)`,
            opacity: 0.82,
            // Softer shadow in blend mode so the disc sits *inside* the
            // galaxy instead of punching a hard hole through it. A thin
            // rim of primary-colored glow gives the disc just enough
            // separation to read on top of the swirling arms.
            boxShadow: blend
              ? `0 0 0 1px ${primaryColor}40, 0 0 24px -10px ${primaryColor}66, inset 0 0 24px rgba(0,0,0,0.7)`
              : `0 0 60px -10px ${primaryColor}55, inset 0 0 30px rgba(0,0,0,0.6)`,
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.02) 1deg, transparent 2deg, transparent 4deg, rgba(255,255,255,0.015) 5deg, transparent 6deg)`,
              animation: isPlaying ? "vinyl-spin 10s linear infinite" : "none",
            }}
          />
          {status === "ok" && track?.album_art_url ? (
            <div
              className="absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: "40%",
                background: `url(${mediaProxyUrl(track.album_art_url) ?? ""}) center/cover, #1a1a22`,
                boxShadow: `0 0 0 2px ${primaryColor}, 0 0 18px -2px ${primaryColor}88`,
                animation: isPlaying ? "vinyl-spin 10s linear infinite" : "none",
              }}
            />
          ) : (
            <div
              className="absolute left-1/2 top-1/2 flex aspect-square -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
              style={{
                width: "40%",
                background: "#1a1a22",
                boxShadow: `0 0 0 2px ${primaryColor}`,
              }}
            >
              {status === "loading" ? (
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              ) : status === "error" ? (
                <AlertCircleIcon className="size-6 text-muted-foreground" />
              ) : (
                <MusicIcon className="size-6 text-muted-foreground" />
              )}
            </div>
          )}
          <div
            className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "#05050a" }}
          />
        </div>
      </div>

      {track && (
        <div className={cn(
          "flex flex-col items-center gap-1 rounded-lg bg-background/55 px-3 py-2 shadow-[0_2px_18px_rgba(0,0,0,0.55)]",
          isHero
            ? "absolute left-1/2 top-full mt-4 w-max max-w-[min(20rem,90vw)] -translate-x-1/2"
            : "max-w-xs",
        )}>
          <p
            className={cn(
              "truncate font-semibold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]",
              size === "hero"
                ? "text-lg sm:text-xl"
                : "text-base sm:text-lg",
            )}
          >
            {track.name}
          </p>
          <p
            className={cn(
              "truncate text-white/80 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]",
              size === "hero" ? "text-sm sm:text-base" : "text-sm",
            )}
          >
            {track.artist}
          </p>
        </div>
      )}

      {track && (
        <div className={cn(
          "flex items-center gap-3",
          isHero && "absolute left-1/2 top-full mt-[5.75rem] w-max -translate-x-1/2",
        )}>
          {track.preview_url ? (
            <button
              type="button"
              onClick={() => setPlaying(!isPlaying)}
              aria-label={isPlaying ? "Pause song" : "Play song"}
              title={isPlaying ? "Pause song" : "Play song"}
              className={cn(
                "flex items-center justify-center rounded-full text-black transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                size === "hero" ? "size-12" : "size-11",
              )}
              style={{
                backgroundColor: primaryColor,
                boxShadow: size === "hero"
                  ? `0 0 24px -4px ${primaryColor}aa, 0 0 0 1px ${primaryColor}33`
                  : undefined,
              }}
            >
              {isPlaying ? (
                <PauseIcon className={cn("fill-current", size === "hero" ? "size-5" : "size-4")} />
              ) : (
                <PlayIcon className={cn("ml-0.5 fill-current", size === "hero" ? "size-5" : "size-4")} />
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Volume2Icon className="size-4" />
              <span>
                {language === "th"
                  ? "เพลงนี้ไม่มีตัวอย่างให้ฟัง"
                  : "Preview unavailable for this track."}
              </span>
            </div>
          )}
          <a
            href={`https://open.spotify.com/track/${track.track_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3" />
            {language === "th" ? "เปิดใน Spotify" : "Open in Spotify"}
          </a>
        </div>
      )}

      {status === "error" && (
        <p className="text-xs text-muted-foreground">{errorMsg}</p>
      )}
    </div>
  );
}
