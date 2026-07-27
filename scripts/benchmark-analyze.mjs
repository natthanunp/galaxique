#!/usr/bin/env node
/* eslint-disable */
/**
 * Realistic end-to-end latency benchmark for /api/analyze.
 *
 * Posts a real 10-question v2 quiz payload (single-language, the same shape
 * /api/generate-quiz now returns after the v1 -> v2 migration), times the
 * full round-trip including Next.js routing, Zod validation, biased catalog
 * sampler, weighted picker, and the merged LLM call.
 *
 * Usage:
 *   node scripts/benchmark-analyze.mjs [count]
 *   default count = 5
 *
 * Server must be running on http://localhost:3000.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENDPOINT = "http://localhost:3000/api/analyze";

const COUNT = Number.parseInt(process.argv[2] ?? "5", 10);
if (!Number.isFinite(COUNT) || COUNT < 1) {
  console.error("count must be a positive integer");
  process.exit(1);
}

/** Load the real catalog size from data/songKnowledge.json so the benchmark
 *  payload is anchored to the production track count. */
const knowledge = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "data", "songKnowledge.json"), "utf-8"),
);
const CATALOG_SIZE = Object.keys(knowledge).length;
console.log(
  `[bench] catalog size from songKnowledge.json: ${CATALOG_SIZE} tracks`,
);

/** A realistic 10-question, single-language quiz payload. Matches the v2
 *  contract the /api/generate-quiz route currently emits:
 *  { id, text, options: [{text}, ...] } (no `angle`, no bilingual fields). */
const REALISTIC_QUIZ = [
  {
    id: 1,
    text: "What instantly lifts your mood?",
    options: [
      { text: "A long, quiet walk alone" },
      { text: "Cooking something warm for friends" },
      { text: "A night drive with loud music" },
      { text: "Calling someone you love" },
    ],
  },
  {
    id: 2,
    text: "How do you recharge after a hard day?",
    options: [
      { text: "Stretching out in bed with a book" },
      { text: "Cooking a slow meal by myself" },
      { text: "Meeting up with people I trust" },
      { text: "Running until my legs give out" },
    ],
  },
  {
    id: 3,
    text: "What kind of weather feels most like you?",
    options: [
      { text: "Soft fog at dawn" },
      { text: "Warm golden afternoon" },
      { text: "Bright clear night with stars" },
      { text: "A storm rolling in fast" },
    ],
  },
  {
    id: 4,
    text: "Which comfort feels easiest to reach for?",
    options: [
      { text: "Pulling a blanket over my head" },
      { text: "Hearing a familiar voice" },
      { text: "Stepping outside for cold air" },
      { text: "Letting music play loud" },
    ],
  },
  {
    id: 5,
    text: "What does your best friendship look like?",
    options: [
      { text: "Long silences that feel full" },
      { text: "Inside jokes over dinner" },
      { text: "Late-night walks without a plan" },
      { text: "Cheering each other on from afar" },
    ],
  },
  {
    id: 6,
    text: "Where do you feel most free?",
    options: [
      { text: "A quiet room with the door closed" },
      { text: "A crowded kitchen with people I love" },
      { text: "An open road with no destination" },
      { text: "A stage with all eyes on me" },
    ],
  },
  {
    id: 7,
    text: "How do you handle a tough decision?",
    options: [
      { text: "Sit with it quietly for days" },
      { text: "Talk it through with one trusted person" },
      { text: "Walk until the answer appears" },
      { text: "Make the call quickly and commit" },
    ],
  },
  {
    id: 8,
    text: "What feels braver to you?",
    options: [
      { text: "Admitting you were wrong out loud" },
      { text: "Telling someone you love them first" },
      { text: "Choosing to walk away from something" },
      { text: "Starting over in a brand-new place" },
    ],
  },
  {
    id: 9,
    text: "Which smell feels most like home?",
    options: [
      { text: "Rain on a window at night" },
      { text: "Bread baking in someone else's kitchen" },
      { text: "Salt air and sunscreen" },
      { text: "Old books and warm wood" },
    ],
  },
  {
    id: 10,
    text: "What are you quietly proud of lately?",
    options: [
      { text: "Keeping a small promise to myself" },
      { text: "Showing up for someone who needed me" },
      { text: "Finishing something I almost gave up on" },
      { text: "Letting myself rest without guilt" },
    ],
  },
];

/** Pick answers deterministically per run index so each run gets a
 *  different but realistic transcript (alternating between the inner/private
 *  and the social/expressive options). */
function buildAnswers(runIndex) {
  // Map question id -> which option index to pick. Rotates per run so we
  // exercise different answer profiles against the LLM.
  const offset = runIndex % 4;
  return REALISTIC_QUIZ.map((question, index) => {
    const optionIndex = (index + offset) % question.options.length;
    const option = question.options[optionIndex];
    return {
      questionId: question.id,
      questionText: question.text,
      answer: option.text,
    };
  });
}

/** Single round-trip timing: TTFB (time to first byte from request start)
 *  and total (response body fully received + parsed). */
async function timeOneRun(runIndex) {
  const body = {
    language: "en",
    answers: buildAnswers(runIndex),
  };
  const start = process.hrtime.bigint();
  const ttfbRes = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ttfbNs = process.hrtime.bigint() - start;
  // Drain body before measuring total so we capture full response cost.
  const responseText = await ttfbRes.text();
  const totalNs = process.hrtime.bigint() - start;
  if (!ttfbRes.ok) {
    return {
      runIndex,
      status: ttfbRes.status,
      ttfbMs: Number(ttfbNs) / 1e6,
      totalMs: Number(totalNs) / 1e6,
      error: responseText.slice(0, 240),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }
  return {
    runIndex,
    status: ttfbRes.status,
    ttfbMs: Number(ttfbNs) / 1e6,
    totalMs: Number(totalNs) / 1e6,
    bodyBytes: responseText.length,
    hasTrack: Boolean(parsed?.spotify_track_id),
    celestial: parsed?.celestial_type ?? null,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

function summarize(label, rows) {
  const ok = rows.filter((r) => r.status === 200);
  const failed = rows.filter((r) => r.status !== 200);
  const ttfb = ok.map((r) => r.ttfbMs).sort((a, b) => a - b);
  const total = ok.map((r) => r.totalMs).sort((a, b) => a - b);
  const fmt = (ms) => `${ms.toFixed(0)} ms`;
  const line = (n, v) => `  ${n.padEnd(8)} ${fmt(v)}`;
  console.log(`\n=== ${label} ===`);
  console.log(`runs: ${rows.length}  ok: ${ok.length}  failed: ${failed.length}`);
  if (failed.length > 0) {
    for (const row of failed) {
      console.log(
        `  FAILED run #${row.runIndex}: status=${row.status}  ${row.error ?? ""}`,
      );
    }
  }
  if (ok.length === 0) return;
  console.log("TTFB (first byte):");
  console.log(line("min:", ttfb[0]));
  console.log(line("p50:", percentile(ttfb, 50)));
  console.log(line("avg:", ttfb.reduce((s, v) => s + v, 0) / ttfb.length));
  console.log(line("p95:", percentile(ttfb, 95)));
  console.log(line("max:", ttfb[ttfb.length - 1]));
  console.log("Total (response body fully received):");
  console.log(line("min:", total[0]));
  console.log(line("p50:", percentile(total, 50)));
  console.log(line("avg:", total.reduce((s, v) => s + v, 0) / total.length));
  console.log(line("p95:", percentile(total, 95)));
  console.log(line("max:", total[total.length - 1]));
  console.log("Per-run:");
  for (const row of ok) {
    console.log(
      `  #${row.runIndex}  ttfb=${fmt(row.ttfbMs)}  total=${fmt(row.totalMs)}  bytes=${row.bodyBytes}  ${row.hasTrack ? "✓" : "✗"}  celestial=${row.celestial}`,
    );
  }
}

/** Warm-up pass: dev-mode Next.js compiles routes on first hit. We throw
 *  away the warm-up number so the headline timing isn't dominated by a one-
 *  shot compile pass. */
async function warmup() {
  console.log("[bench] warm-up: priming Next.js dev compilation...");
  try {
    const r = await timeOneRun(0);
    console.log(
      `[bench] warm-up done: status=${r.status}  total=${r.totalMs.toFixed(0)} ms`,
    );
  } catch (err) {
    console.error("[bench] warm-up failed:", err.message);
  }
}

async function main() {
  await warmup();
  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    try {
      const row = await timeOneRun(i + 1);
      rows.push(row);
      console.log(
        `[bench] run #${row.runIndex}  ttfb=${row.ttfbMs.toFixed(0)} ms  total=${row.totalMs.toFixed(0)} ms  status=${row.status}`,
      );
    } catch (err) {
      console.error(`[bench] run #${i + 1} threw:`, err.message);
    }
  }
  summarize("/api/analyze end-to-end", rows);
}

main().catch((err) => {
  console.error("[bench] fatal:", err);
  process.exit(1);
});