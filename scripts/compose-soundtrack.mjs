#!/usr/bin/env node
/**
 * Composes the original space score (D Dorian, pipe-organ pad + slow arpeggio
 * pulse, in the spirit of cinematic space scores) as MIDI, then renders
 * four seamless loop layers with a small built-in synth.
 *
 *   LAMEJS=<path to @breezystack/lamejs> node scripts/compose-soundtrack.mjs
 *
 * Writes art/audio/galaxique-score.mid (the composition source) and
 * public/audio/score/{pad,drone,pulse,shimmer}.mp3 + manifest.json.
 * The built-in synth is a stand-in: re-render the MIDI with high-quality
 * instruments and do a listening review before production.
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SR = 44100;
const LOOP_SECONDS = 96;
const N = SR * LOOP_SECONDS;
const PAD_SECONDS = 0.25;
const TARGET_RMS_DB = -18;

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
// Every oscillator lands on a whole number of cycles per loop, so the loop is seamless.
const loopHz = (hz) => Math.max(1, Math.round(hz * LOOP_SECONDS)) / LOOP_SECONDS;

// ── Composition (shared by MIDI and render) ───────────────────────────────
// Eight 12 s chords; melody is [offset seconds, MIDI note] pairs played on piano.
const CHORDS = [
  { bass: 38, voices: [53, 57, 60, 64, 69], melody: [[0, 69], [6, 72]] }, // Dm9
  { bass: 34, voices: [53, 57, 62, 64, 69], melody: [[0, 74], [6, 72]] }, // Bbmaj13#11
  { bass: 43, voices: [58, 62, 65, 69, 74], melody: [[0, 70], [6, 69]] }, // Gm9
  { bass: 36, voices: [55, 62, 64, 67, 71], melody: [[0, 67], [6, 71]] }, // Cmaj9
  { bass: 38, voices: [53, 57, 60, 64, 69], melody: [[0, 74], [6, 76]] }, // Dm9
  { bass: 34, voices: [53, 58, 62, 65, 69], melody: [[0, 77], [6, 74]] }, // Bbmaj7
  { bass: 43, voices: [58, 62, 64, 69, 74], melody: [[0, 76], [6, 74]] }, // Gm6/9
  { bass: 45, voices: [52, 57, 62, 64, 69], melody: [[0, 74], [6, 76]] }, // Asus4, back to Dm9
];
const CHORD_SECONDS = LOOP_SECONDS / CHORDS.length;
const PEDAL = 38; // constant D under every chord
const STEP = 0.5;
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
const shimmerVoices = (c) => [c.voices[4] + 12, c.voices[3] + 12, c.voices[2] + 12];
// Arpeggios swell and recede once per loop.
const swell = (t) => 0.7 + 0.3 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / LOOP_SECONDS));
const pulse = [];
CHORDS.forEach((chord, ci) => {
  const t0 = ci * CHORD_SECONDS;
  const tones = chord.voices.slice(0, 4).map((n) => n + 12);
  pulse.push({ t: t0, note: chord.bass + 12, velocity: 0.9, pan: 0, hold: 1.6, harmonics: 6, dur: CHORD_SECONDS });
  for (let k = 0; k < CHORD_SECONDS / STEP; k++) {
    const t = t0 + k * STEP;
    pulse.push({ t, note: tones[ARP[k % ARP.length]], velocity: (k % 8 === 0 ? 0.8 : 0.4 + 0.08 * (k % 2)) * swell(t), pan: Math.sin(k * 0.9) * 0.4, hold: 0.55, harmonics: 4, dur: 1.2 });
  }
  for (const [offset, note] of chord.melody) {
    pulse.push({ t: t0 + offset, note, velocity: 1.1, pan: 0, hold: 1.7, harmonics: 6, dur: 6 });
  }
});

// ── Rendering ─────────────────────────────────────────────────────────────
const stereo = () => [new Float32Array(N), new Float32Array(N)];

/** Sustained voices that crossfade from chord to chord; every partial has whole cycles per loop. */
function renderChords(voicing, { harmonics, amp, fade, cents = 4, vibrato = false }) {
  const [l, r] = stereo();
  const span = Math.floor((CHORD_SECONDS + fade * 2) * SR);
  const env = new Float32Array(span);
  for (let k = 0; k < span; k++) {
    const rel = k / SR;
    env[k] = rel < fade * 2 ? 0.5 - 0.5 * Math.cos((Math.PI * rel) / (fade * 2))
      : rel > CHORD_SECONDS ? 0.5 + 0.5 * Math.cos((Math.PI * (rel - CHORD_SECONDS)) / (fade * 2)) : 1;
  }
  CHORDS.forEach((chord, i) => {
    const first = Math.floor((i * CHORD_SECONDS - fade) * SR);
    voicing(chord).forEach((note, vi) => {
      for (const [ch, c] of [[l, -cents], [r, cents]]) {
        for (const [h, draw] of harmonics) {
          const hz = loopHz(midiToHz(note) * h * 2 ** (c / 1200));
          const w = (2 * Math.PI * hz) / SR;
          const a = amp * draw;
          const vibCycles = 509 + vi * 7 + (c > 0 ? 3 : 0);
          const vibDepth = (hz * 0.004) / (vibCycles / LOOP_SECONDS);
          for (let k = 0; k < span; k++) {
            const n = (((first + k) % N) + N) % N;
            const phase = w * n + (vibrato ? vibDepth * Math.sin((2 * Math.PI * vibCycles * n) / N) : 0);
            ch[n] += Math.sin(phase) * a * env[k];
          }
        }
      }
    });
  });
  return [l, r];
}

// Circular filters: a few passes let tails wrap around the loop point.
function comb(x, d, g) {
  const y = new Float32Array(N);
  for (let pass = 0; pass < 3; pass++) for (let n = 0; n < N; n++) y[n] = x[n] + g * y[n >= d ? n - d : n - d + N];
  return y;
}
function allpass(x, d, g) {
  const y = new Float32Array(N);
  for (let pass = 0; pass < 3; pass++) {
    for (let n = 0; n < N; n++) {
      const back = n >= d ? n - d : n - d + N;
      y[n] = -g * x[n] + x[back] + g * y[back];
    }
  }
  return y;
}
function reverb([l, r], wetAmount, seconds = 5.5) {
  const mono = new Float32Array(N);
  for (let n = 0; n < N; n++) mono[n] = (l[n] + r[n]) / 2;
  const delays = [0.0437, 0.0571, 0.0679, 0.0797, 0.0893, 0.1031];
  const wet = [0, 1].map((c) => {
    const sum = new Float32Array(N);
    for (const base of delays) {
      const d = Math.floor(base * (c ? 1.07 : 1) * SR);
      const y = comb(mono, d, 10 ** ((-3 * (d / SR)) / seconds));
      for (let n = 0; n < N; n++) sum[n] += y[n];
    }
    const diffused = allpass(allpass(sum, Math.floor((c ? 0.0053 : 0.005) * SR), 0.7), Math.floor((c ? 0.0019 : 0.0017) * SR), 0.7);
    // One-pole lowpass keeps the hall dark.
    const a = 1 - Math.exp((-2 * Math.PI * 2500) / SR);
    let z = 0;
    for (let pass = 0; pass < 2; pass++) for (let n = 0; n < N; n++) { z += a * (diffused[n] - z); diffused[n] = z; }
    return diffused;
  });
  const scale = wetAmount / (Math.sqrt(delays.length) * 2.4);
  for (let n = 0; n < N; n++) { l[n] += wet[0][n] * scale; r[n] += wet[1][n] * scale; }
  return [l, r];
}

function renderPad() {
  const organ = [[1, 1], [2, 0.55], [3, 0.4], [4, 0.28], [5, 0.14], [6, 0.12], [8, 0.06]];
  return reverb(renderChords((c) => c.voices, { harmonics: organ, amp: 0.035, fade: 3 }), 0.6);
}

function renderDrone() {
  const [l, r] = renderChords((c) => [c.bass], { harmonics: [[1, 1], [2, 0.7], [3, 0.5], [4, 0.3]], amp: 0.1, fade: 2, cents: 3 });
  // A constant D pedal under every chord, breathing 4 times per loop.
  for (const [note, gain] of [[PEDAL, 1], [PEDAL + 12, 0.5]]) {
    const hz = loopHz(midiToHz(note));
    for (let n = 0; n < N; n++) {
      const t = n / SR;
      const breathe = 0.8 + 0.2 * Math.sin((2 * Math.PI * 4 * t) / LOOP_SECONDS);
      const v = (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t)) * 0.08 * gain * breathe;
      l[n] += v;
      r[n] += v;
    }
  }
  return reverb([l, r], 0.25);
}

/** Felt-piano voice: slightly inharmonic partials, longer decay in the low register. */
function addPiano(l, r, { t, note, velocity, pan, hold, harmonics }) {
  const f = midiToHz(note);
  const tau = (note < 60 ? 3.2 : note < 72 ? 2.4 : 1.7) * hold;
  const length = Math.min(Math.floor(SR * tau * 4.5), N);
  const start = Math.floor(t * SR);
  const gl = 1 - Math.max(0, pan);
  const gr = 1 + Math.min(0, pan);
  for (let h = 1; h <= harmonics; h++) {
    const fh = f * h * Math.sqrt(1 + 0.0004 * h * h);
    const w = (2 * Math.PI * fh) / SR;
    const a = (velocity * 0.12) / h ** 1.4;
    const decay = tau / h ** 0.7;
    for (let k = 0; k < length; k++) {
      const s = k / SR;
      const v = Math.sin(w * k) * a * (1 - Math.exp(-s / 0.004)) * Math.exp(-s / decay);
      const n = (start + k) % N; // tail wraps into the loop start
      l[n] += v * gl;
      r[n] += v * gr;
    }
  }
}

function renderPulse() {
  const [l, r] = stereo();
  for (const p of pulse) addPiano(l, r, p);
  return reverb([l, r], 0.8);
}

/** Airy high choir-like swells with a slow vibrato. */
function renderShimmer() {
  const choir = [[1, 1], [2, 0.5], [3, 0.35], [4, 0.15]];
  return reverb(renderChords(shimmerVoices, { harmonics: choir, amp: 0.03, fade: 3, cents: 5, vibrato: true }), 0.9, 7);
}

function master([l, r]) {
  let sum = 0;
  for (let n = 0; n < N; n++) sum += (l[n] ** 2 + r[n] ** 2) / 2;
  const gain = 10 ** (TARGET_RMS_DB / 20) / Math.sqrt(sum / N);
  // Soft-limit peaks below -1 dBFS.
  const ceiling = 10 ** (-1 / 20);
  const limit = (x) => ceiling * Math.tanh((x * gain) / ceiling);
  const padN = Math.floor(PAD_SECONDS * SR);
  const total = N + padN * 2;
  const out = [new Int16Array(total), new Int16Array(total)];
  [l, r].forEach((ch, c) => {
    for (let i = 0; i < total; i++) {
      const src = ((i - padN) % N + N) % N; // wrap padding keeps decoder offsets seamless
      out[c][i] = Math.round(limit(ch[src]) * 32767);
    }
  });
  return out;
}

async function encodeMp3([l, r], lamejsPath) {
  const lame = await import(pathToFileURL(path.join(lamejsPath, "dist", "lamejs.js")).href).catch(() => import("@breezystack/lamejs"));
  const encoder = new lame.Mp3Encoder(2, SR, 112);
  const chunks = [];
  for (let i = 0; i < l.length; i += 1152) {
    const buf = encoder.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152));
    if (buf.length) chunks.push(Buffer.from(buf));
  }
  chunks.push(Buffer.from(encoder.flush()));
  return Buffer.concat(chunks);
}

// ── MIDI (composition source) ─────────────────────────────────────────────
function vlq(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}
function track(name, events) {
  // events: [timeSeconds, [bytes]] ; 1 beat = 1 s at 60 bpm, 480 ppq. Free time.
  const sorted = events.sort((a, b) => a[0] - b[0]);
  const data = [0, 0xff, 0x03, name.length, ...Buffer.from(name)];
  let last = 0;
  for (const [t, bytes] of sorted) {
    const tick = Math.round(t * 480);
    data.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return Buffer.concat([Buffer.from("MTrk"), Buffer.from(new Uint8Array(new Uint32Array([data.length]).buffer).reverse()), Buffer.from(data)]);
}
function midiFile() {
  const notes = (ch, list) => list.flatMap(([t, d, note, vel]) => [[t, [0x90 | ch, note, vel]], [t + d, [0x80 | ch, note, 0]]]);
  const tempo = track("tempo", [[0, [0xff, 0x51, 0x03, 0x0f, 0x42, 0x40]], [0, [0xff, 0x58, 0x04, 4, 2, 24, 8]]]);
  const pad = track("pad", notes(0, CHORDS.flatMap((c, i) => c.voices.map((n) => [i * CHORD_SECONDS, CHORD_SECONDS, n, 60]))));
  const drone = track("drone", notes(1, [...CHORDS.map((c, i) => [i * CHORD_SECONDS, CHORD_SECONDS, c.bass, 80]), [0, LOOP_SECONDS, PEDAL, 50]]));
  const pulseTrack = track("pulse", notes(2, pulse.map((p) => [p.t, p.dur, p.note, Math.min(127, Math.round(p.velocity * 90))])));
  const shimmer = track("shimmer", notes(3, CHORDS.flatMap((c, i) => shimmerVoices(c).map((n) => [i * CHORD_SECONDS, CHORD_SECONDS, n, 35]))));
  const header = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 5, 0x01, 0xe0]);
  return Buffer.concat([header, tempo, pad, drone, pulseTrack, shimmer]);
}

const outDir = path.join(ROOT, "public", "audio", "score");
await mkdir(outDir, { recursive: true });
await mkdir(path.join(ROOT, "art", "audio"), { recursive: true });
await writeFile(path.join(ROOT, "art", "audio", "galaxique-score.mid"), midiFile());
const layers = { pad: renderPad, drone: renderDrone, pulse: renderPulse, shimmer: renderShimmer };
for (const [name, render] of Object.entries(layers)) {
  const mp3 = await encodeMp3(master(render()), process.env.LAMEJS ?? "");
  await writeFile(path.join(outDir, `${name}.mp3`), mp3);
  console.log(`${name}.mp3 ${(mp3.length / 1024).toFixed(0)} KB`);
}
await writeFile(path.join(outDir, "manifest.json"), JSON.stringify({
  loopStart: PAD_SECONDS, loopEnd: PAD_SECONDS + LOOP_SECONDS, layers: Object.keys(layers), key: "D Dorian", targetRmsDb: TARGET_RMS_DB,
}, null, 2) + "\n");
await writeFile(path.join(ROOT, "art", "audio", "CREDITS.txt"), [
  "Galaxique original score — D Dorian, 96 s loop: organ pad, pedal bass, felt-piano arpeggio and melody, choir swells, long hall reverb.",
  "Composition source: galaxique-score.mid (pad, drone, pulse, shimmer). Composed for Galaxique; no samples or third-party material.",
  "Current loops in public/audio/score are rendered by scripts/compose-soundtrack.mjs with a simple built-in synth as placeholders.",
  "Before production: render the MIDI with high-quality instruments in a DAW, keep the DAW project here, export seamless 96 s loops",
  "at about -18 LUFS as Opus/AAC with MP3 fallback, and do a listening review.",
  "",
].join("\n"));
