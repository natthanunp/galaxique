"use client";

import { useEffect } from "react";

import { FLAGS } from "@/config/flags";
import { useMediaStore } from "@/store/mediaStore";

export type SoundScene = "galaxy" | "approach" | "surface" | "quiz";
type Layer = "pad" | "drone" | "pulse" | "shimmer";

/** Layer mix per scene; changes crossfade over a few seconds. */
const MIX: Record<SoundScene, Record<Layer, number>> = {
  galaxy: { pad: 0.8, drone: 0.5, pulse: 0.4, shimmer: 0.4 },
  approach: { pad: 0.6, drone: 0.85, pulse: 0.75, shimmer: 0.6 },
  surface: { pad: 0.7, drone: 0.4, pulse: 0.55, shimmer: 0.2 },
  quiz: { pad: 0.75, drone: 0.45, pulse: 0.25, shimmer: 0.25 },
};
const MASTER = 0.35;
const BASE = "/audio/score";

class AdaptiveSoundtrack {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private gains = new Map<Layer, GainNode>();
  private loading = new Map<Layer, Promise<void>>();
  private manifest: Promise<{ loopStart: number; loopEnd: number }> | null = null;
  private scene: SoundScene = "galaxy";
  private enabled = true;
  private ducked = false;
  private unlocked = false;
  private users = 0;

  private ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.duck = this.ctx.createGain();
    this.master.gain.value = 0;
    this.duck.connect(this.master).connect(this.ctx.destination);
    return this.ctx;
  }

  private loadLayer(layer: Layer) {
    const existing = this.loading.get(layer);
    if (existing) return existing;
    const ctx = this.ensureContext();
    this.manifest ??= fetch(`${BASE}/manifest.json`).then((r) => r.json());
    // Not a .mp3 URL: download managers (IDM) grab those and pop up windows.
    const job = Promise.all([this.manifest, fetch(`/api/score/${layer}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })])
      .then(async ([manifest, data]) => {
        const buffer = await ctx.decodeAudioData(data);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.duck!);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = manifest.loopStart;
        source.loopEnd = manifest.loopEnd;
        source.connect(gain);
        source.start(0, manifest.loopStart);
        this.gains.set(layer, gain);
        this.applyMix(3);
      })
      .catch((error) => { console.warn(`[soundtrack] ${layer} failed`, error); });
    this.loading.set(layer, job);
    return job;
  }

  private applyMix(seconds: number) {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume().catch(() => {});
    const now = this.ctx.currentTime;
    for (const [layer, gain] of this.gains) {
      gain.gain.setTargetAtTime(MIX[this.scene][layer], now, seconds / 3);
    }
    this.master!.gain.setTargetAtTime(this.enabled && this.users > 0 ? MASTER : 0, now, 0.4);
    this.duck!.gain.setTargetAtTime(this.ducked ? 0 : 1, now, 0.2);
  }

  /** Called from a user gesture: iOS only starts audio after one. */
  unlock() {
    const ctx = this.ensureContext();
    void ctx.resume();
    if (this.unlocked) return;
    this.unlocked = true;
    // Load lazily, most audible layers for the current scene first.
    const order = (Object.keys(MIX[this.scene]) as Layer[]).sort((a, b) => MIX[this.scene][b] - MIX[this.scene][a]);
    order.reduce((chain, layer) => chain.then(() => this.loadLayer(layer)), Promise.resolve());
  }

  setScene(scene: SoundScene) { this.scene = scene; this.applyMix(3); }
  setEnabled(enabled: boolean) { this.enabled = enabled; this.applyMix(0.6); }
  setDucked(ducked: boolean) { this.ducked = ducked; this.applyMix(0.6); }
  setHidden(hidden: boolean) { if (this.ctx) void (hidden ? this.ctx.suspend() : this.ctx.resume()); }
  acquire() { this.users++; this.applyMix(1); }
  release() { this.users = Math.max(0, this.users - 1); this.applyMix(1); }
}

let engine: AdaptiveSoundtrack | null = null;
export function soundtrack() {
  engine ??= new AdaptiveSoundtrack();
  return engine;
}

/** Plays the adaptive score for a page, replacing the single ambient loop there. */
export function useSoundtrack(scene: SoundScene, ducked = false) {
  const ambientEnabled = useMediaStore((s) => s.ambientEnabled);

  useEffect(() => {
    if (!FLAGS.adaptiveSoundtrack) return;
    const s = soundtrack();
    s.acquire();
    const unlock = () => s.unlock();
    const visibility = () => s.setHidden(document.hidden);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("pointerup", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      s.release();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("pointerup", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => { if (FLAGS.adaptiveSoundtrack) soundtrack().setScene(scene); }, [scene]);
  useEffect(() => { if (FLAGS.adaptiveSoundtrack) soundtrack().setEnabled(ambientEnabled); }, [ambientEnabled]);
  useEffect(() => { if (FLAGS.adaptiveSoundtrack) soundtrack().setDucked(ducked); }, [ducked]);
}
