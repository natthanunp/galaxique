"use client";

import { useEffect, useState } from "react";
import { MusicIcon, AlertCircleIcon, ExternalLinkIcon, Volume2Icon } from "lucide-react";

import { useMediaStore } from "@/store/mediaStore";
import { cn } from "@/lib/utils";
import { mediaProxyUrl } from "@/lib/mediaProxy";
import type { Language } from "@/types/universe";

interface SpotifyPlayerProps {
  /** Backwards-compatible search query from older reveals. */
  query: string;
  /** Exact track selected from the configured playlist for new reveals. */
  trackId?: string | null;
  language: Language;
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

/** Resolves the reveal's spotify_search_query to a track and autoplays the
 *  30s Spotify preview MP3 immediately through the shared, already-unlocked
 *  <audio> element (see BackgroundAudio). Falls back to a Spotify link if
 *  the preview is unavailable for that track. */
export function SpotifyPlayer({ query, trackId, language, className }: SpotifyPlayerProps) {
  const [track, setTrack] = useState<Track | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const setMediaMode = useMediaStore((s) => s.setMode);
  const setSpotifyUrl = useMediaStore((s) => s.setSpotifyUrl);
  const setStoreTrack = useMediaStore((s) => s.setTrack);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setTrack(null);
    setMediaMode("ambient");
    setSpotifyUrl(null);
    setStoreTrack(null);

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
          // Autoplay immediately — no button, no extra click required.
          setSpotifyUrl(previewUrl);
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
    };
  }, [query, trackId, setMediaMode, setSpotifyUrl, setStoreTrack]);

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border border-border/70 bg-card/70 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <MusicIcon className="size-4 shrink-0 text-accent" />
        <span className="shrink-0 font-medium text-foreground">
          {language === "th" ? "เพลงจักรวาลของคุณ" : "Your universe song"}
        </span>
        {track && (
          <span className="min-w-0 flex-1 truncate">
            — {track.name} · {track.artist}
          </span>
        )}
      </div>

      {status === "loading" && (
        <div className="h-38 animate-pulse bg-secondary/40" />
      )}

      {status === "ok" && track && (
        <>
          {track.preview_url ? (
            <div className="flex h-38 flex-col items-center justify-center gap-2 bg-linear-to-br from-[#1DB954]/15 to-secondary/40 px-4 text-center">
              {track.album_art_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- this is a small same-origin proxy URL, so next/image adds no value here
                <img
                  src={mediaProxyUrl(track.album_art_url) ?? undefined}
                  alt=""
                  className="size-14 rounded-lg object-cover shadow-lg ring-1 ring-white/10"
                />
              ) : (
                <span className="flex size-12 items-center justify-center rounded-full bg-[#1DB954] text-black shadow-lg">
                  <Volume2Icon className="size-5 animate-pulse" />
                </span>
              )}
              <span className="text-sm font-medium text-foreground">
                {language === "th" ? "กำลังเล่น" : "Now playing"}
              </span>
              <span className="text-xs text-muted-foreground">
                {language === "th" ? "ตัวอย่าง 30 วินาที" : "30-second preview"}
              </span>
            </div>
          ) : (
            <div className="flex h-38 flex-col items-center justify-center gap-2 bg-secondary/30 px-4 text-center text-sm text-muted-foreground">
              <AlertCircleIcon className="size-5" />
              <p>
                {language === "th"
                  ? "เพลงนี้ไม่มีตัวอย่างให้ฟัง"
                  : "Preview unavailable for this track."}
              </p>
              <p className="text-xs">
                {language === "th"
                  ? "เปิดใน Spotify เพื่อฟัง"
                  : "Open in Spotify to listen."}
              </p>
            </div>
          )}
          <a
            href={`https://open.spotify.com/track/${track.track_id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 border-t border-border/70 bg-secondary/30 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3" />
            {language === "th" ? "เปิดใน Spotify" : "Open in Spotify"}
          </a>
        </>
      )}

      {status === "error" && (
        <div className="flex h-38 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
          <AlertCircleIcon className="size-5 text-destructive" />
          <p>
            {language === "th"
              ? "โหลดเพลงสำหรับโทนของคุณไม่สำเร็จ"
              : "Couldn't load the song for your vibe."}
          </p>
          <p className="text-xs opacity-70">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}

