"use client";

/** A single, app-wide Web Audio engine.
 *
 *  - Decodes ambient + Spotify preview once into AudioBuffers.
 *  - Schedules playback on the audio thread, so main-thread work
 *    (scrolling, React renders, API responses) cannot crackle the output.
 *  - Crossfades between ambient and Spotify modes.
 *  - Persists across route changes because it lives in a module singleton. */

const FADE_SECONDS = 0.6;
const AMBIENT_VOLUME = 0.35;

interface PlayingSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let ambientBuffer: AudioBuffer | null = null;
let ambientSrc: PlayingSource | null = null;
let spotifySrc: PlayingSource | null = null;
let mutedByUser = false;
let userVolume = AMBIENT_VOLUME;
let currentMode: "ambient" | "spotify" = "ambient";
let unlockPromise: Promise<void> | null = null;

function getContext(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) throw new Error("Web Audio API not supported");
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.value = userVolume;
  }
  return ctx;
}

async function decode(url: string): Promise<AudioBuffer> {
  const context = getContext();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return context.decodeAudioData(arrayBuffer);
}

function now(): number {
  return getContext().currentTime;
}

function rampGain(gain: AudioParam, target: number, when = now()) {
  gain.cancelScheduledValues(0);
  gain.setTargetAtTime(target, when, FADE_SECONDS / 3);
}

function setMasterGain(target: number) {
  if (masterGain) rampGain(masterGain.gain, target);
}

function stopSource(ps: PlayingSource | null, when?: number) {
  if (!ps) return;
  try {
    rampGain(ps.gain.gain, 0, when ?? now());
    const stopAt = (when ?? now()) + FADE_SECONDS + 0.05;
    ps.source.stop(stopAt);
  } catch {
    /* already stopped */
  }
}

function playBuffer(buffer: AudioBuffer, loop: boolean): PlayingSource {
  const context = getContext();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(masterGain!);
  source.start();
  return { source, gain };
}

export async function initAmbient(src: string, volume = AMBIENT_VOLUME) {
  userVolume = volume;
  setMasterGain(mutedByUser ? 0 : userVolume);
  if (!ambientBuffer) ambientBuffer = await decode(src);
  if (ambientSrc) return;
  const context = getContext();
  if (context.state === "suspended") await context.resume();
  ambientSrc = playBuffer(ambientBuffer, true);
  if (!mutedByUser && currentMode === "ambient") {
    rampGain(ambientSrc.gain.gain, 1, now());
  }
}

export async function playSpotifyPreview(url: string) {
  if (!ambientBuffer) return;
  const context = getContext();
  if (context.state === "suspended") await context.resume();

  // Crossfade: fade ambient down, start preview silent, fade preview up.
  currentMode = "spotify";
  stopSource(ambientSrc);

  const buffer = await decode(url);
  // Spotify previews are 30-second clips; loop them continuously while
  // this mode is active, matching the old <audio> behavior.
  spotifySrc = playBuffer(buffer, true);
  if (!mutedByUser) {
    rampGain(spotifySrc.gain.gain, 1, now());
  }

  // When the source is explicitly stopped (e.g. mode switched back to
  // ambient), clean up the reference.
  spotifySrc.source.onended = () => {
    spotifySrc = null;
  };
}

export function resumeAmbient() {
  currentMode = "ambient";
  stopSource(spotifySrc);
  if (!ambientSrc && ambientBuffer) {
    ambientSrc = playBuffer(ambientBuffer, true);
  }
  if (ambientSrc && !mutedByUser) {
    rampGain(ambientSrc.gain.gain, 1, now());
  }
}

export function setAudioMuted(muted: boolean) {
  mutedByUser = muted;
  setMasterGain(muted ? 0 : userVolume);
}

export function isAudioMuted() {
  return mutedByUser;
}

export async function unlockAudio() {
  if (unlockPromise) return unlockPromise;
  unlockPromise = (async () => {
    const context = getContext();
    if (context.state === "suspended") await context.resume();
  })();
  return unlockPromise;
}

export function stopAll() {
  stopSource(ambientSrc);
  stopSource(spotifySrc);
  ambientSrc = null;
  spotifySrc = null;
}
