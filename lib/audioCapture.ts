"use client";

/** A live, controllable audio stream built from a (usually cross-origin)
 *  audio URL via the Web Audio API. */
export interface CapturedAudio {
  /** MediaStream containing the decoded audio, ready to be merged with a
   *  video track and passed to MediaRecorder. */
  stream: MediaStream;
  /** Starts playback from the beginning. Call this at the exact moment
   *  recording begins so the video and audio stay in sync. */
  start: () => void;
  /** Stops playback and releases the AudioContext. */
  stop: () => void;
}

/**
 * Fetches an audio URL (e.g. a Spotify/iTunes 30s preview) and decodes it via
 * the Web Audio API, piping the result into a `MediaStreamAudioDestinationNode`.
 *
 * This deliberately does NOT use `HTMLMediaElement.captureStream()` on the
 * existing shared `<audio>` element (see BackgroundAudio) — Safari has never
 * implemented `captureStream()` on media elements, which would silently drop
 * audio from exported videos on iOS. Decoding via `AudioContext` instead works
 * the same way across Chrome/Firefox/Safari.
 *
 * Returns null if the fetch or decode fails (e.g. no CORS headers on the
 * preview CDN) — callers should treat that as "record without audio" rather
 * than failing the whole export.
 */
export async function createAudioStreamFromUrl(
  url: string,
): Promise<CapturedAudio | null> {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Preview fetch failed (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);

    let started = false;
    return {
      stream: dest.stream,
      start: () => {
        if (started) return;
        started = true;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        source.start(0);
      },
      stop: () => {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        ctx.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}
