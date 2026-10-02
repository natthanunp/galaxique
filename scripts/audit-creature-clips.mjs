#!/usr/bin/env node
// Inventories animation clips in every creature GLB and maps them to the behavior states.
// node scripts/audit-creature-clips.mjs  → docs/creature-animation-audit.json
import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "public", "assets", "creatures");
const STATES = ["idle", "notice", "greet", "talk", "listen", "happy", "shy", "curious", "sleepy", "rest"];
const HINTS = {
  idle: /idle|breath|stand|hover|float|swim|scene|take 001|action/i,
  greet: /wave|greet|hello|bow|hop|jump/i,
  happy: /happy|jump|dance|celebrat/i,
  rest: /sleep|rest|lie|sit/i,
  talk: /talk|speak/i,
};

function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const length = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + length).toString("utf8"));
}

const report = {};
for (const file of (await readdir(DIR)).filter((f) => f.endsWith(".glb")).sort()) {
  const json = readGlbJson(await readFile(path.join(DIR, file)));
  const clips = (json.animations ?? []).map((a) => {
    // Clip length = max of the input accessors' max time.
    const duration = Math.max(0, ...a.samplers.map((s) => json.accessors[s.input]?.max?.[0] ?? 0));
    return { name: a.name ?? "(unnamed)", channels: a.channels.length, duration: +duration.toFixed(2) };
  });
  const coverage = Object.fromEntries(STATES.map((state) => {
    const clip = clips.find((c) => HINTS[state]?.test(c.name));
    return [state, clip ? `clip:${clip.name}` : "procedural"];
  }));
  report[file.replace(".glb", "")] = { clips, skins: (json.skins ?? []).length, coverage };
}
await writeFile(path.join(ROOT, "docs", "creature-animation-audit.json"), JSON.stringify(report, null, 2) + "\n");
for (const [kind, r] of Object.entries(report)) {
  console.log(kind.padEnd(7), r.clips.map((c) => `${c.name} (${c.duration}s)`).join(", ") || "no clips");
}
