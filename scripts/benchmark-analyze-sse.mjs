#!/usr/bin/env node
/* eslint-disable */
/**
 * Realistic benchmark for /api/analyze that exercises BOTH response modes:
 *   - JSON (legacy): single-shot response, measured end-to-end.
 *   - SSE (new): streaming progress events, measured per-event arrival
 *     so we can see how soon the *first* meaningful signal reaches the
 *     client (perceived latency).
 *
 * Usage:
 *   node scripts/benchmark-analyze-sse.mjs [count]
 *   default count = 4
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENDPOINT = "http://localhost:3000/api/analyze";

const COUNT = Number.parseInt(process.argv[2] ?? "4", 10);
if (!Number.isFinite(COUNT) || COUNT < 1) {
  console.error("count must be a positive integer");
  process.exit(1);
}

const knowledge = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "data", "songKnowledge.json"), "utf-8"),
);
console.log(
  `[bench] catalog size from songKnowledge.json: ${Object.keys(knowledge).length} tracks`,
);

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

function buildAnswers(runIndex) {
  const offset = runIndex % 4;
  return REALISTIC_QUIZ.map((question, index) => {
    const optionIndex = (index + offset) % question.options.length;
    return {
      questionId: question.id,
      questionText: question.text,
      answer: question.options[optionIndex].text,
    };
  });
}

async function timeJsonRun(runIndex) {
  const body = {
    language: "en",
    answers: buildAnswers(runIndex),
  };
  const start = process.hrtime.bigint();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const totalNs = process.hrtime.bigint() - start;
  const responseText = await response.text();
  let reveal = null;
  try {
    reveal = JSON.parse(responseText);
  } catch {
    // not JSON
  }
  return {
    runIndex,
    mode: "json",
    status: response.status,
    totalMs: Number(totalNs) / 1e6,
    bytes: responseText.length,
    hasTrack: Boolean(reveal?.spotify_track_id),
    celestial: reveal?.celestial_type ?? null,
  };
}

async function timeSseRun(runIndex) {
  const body = {
    language: "en",
    answers: buildAnswers(runIndex),
  };
  const start = process.hrtime.bigint();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    return {
      runIndex,
      mode: "sse",
      status: response.status,
      totalMs: Number(process.hrtime.bigint() - start) / 1e6,
      progressStages: [],
      progressTimes: [],
      resultTime: null,
      resultBytes: 0,
      celestial: null,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalNs = BigInt(0);
  const progressStages = [];
  const progressTimes = [];
  let resultTime = null;
  let resultBytes = 0;
  let celestial = null;
  let currentEvent = "";
  let currentData = "";
  function dispatchEvent() {
    if (!currentEvent || !currentData) {
      currentEvent = "";
      currentData = "";
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(currentData);
    } catch {
      currentEvent = "";
      currentData = "";
      return;
    }
    if (currentEvent === "progress") {
      progressStages.push(parsed.stage);
      progressTimes.push(Number(process.hrtime.bigint() - start) / 1e6);
    } else if (currentEvent === "result") {
      resultTime = Number(process.hrtime.bigint() - start) / 1e6;
      resultBytes = currentData.length;
      celestial = parsed?.celestial_type ?? null;
    }
    currentEvent = "";
    currentData = "";
  }
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const d = line.slice(5).trimStart();
          currentData = currentData ? `${currentData}\n${d}` : d;
        }
      }
      dispatchEvent();
    }
  }
  totalNs = process.hrtime.bigint() - start;
  return {
    runIndex,
    mode: "sse",
    status: response.status,
    totalMs: Number(totalNs) / 1e6,
    progressStages,
    progressTimes,
    resultTime,
    resultBytes,
    celestial,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(label, rows) {
  const ok = rows.filter((r) => r.status === 200);
  const failed = rows.filter((r) => r.status !== 200);
  const total = ok.map((r) => r.totalMs).sort((a, b) => a - b);
  const fmt = (ms) => `${ms.toFixed(0)} ms`;
  console.log(`\n=== ${label} ===`);
  console.log(`runs: ${rows.length}  ok: ${ok.length}  failed: ${failed.length}`);
  if (failed.length > 0) {
    for (const row of failed) {
      console.log(`  FAILED run #${row.runIndex}: status=${row.status}`);
    }
  }
  if (ok.length === 0) return;
  console.log("Total wall-clock:");
  console.log(`  min:    ${fmt(total[0])}`);
  console.log(`  p50:    ${fmt(percentile(total, 50))}`);
  console.log(`  avg:    ${fmt(total.reduce((s, v) => s + v, 0) / total.length)}`);
  console.log(`  p95:    ${fmt(percentile(total, 95))}`);
  console.log(`  max:    ${fmt(total[total.length - 1])}`);
  console.log("Per-run:");
  for (const row of ok) {
    if (row.mode === "sse") {
      // Print each progress event with its arrival timestamp so we can
      // verify the SSE actually streams them in real time (vs. buffering
      // everything until the worker resolves, which would defeat the
      // purpose of the loading gimmick).
      const stageTimings = row.progressTimes
        .map((ms, i) => `    ${row.progressStages[i]}@${ms.toFixed(0)}ms`)
        .join("\n");
      console.log(
        `  #${row.runIndex} ${row.mode}  total=${fmt(row.totalMs)}  result=${row.resultTime ? fmt(row.resultTime) : "n/a"}  celestial=${row.celestial}\n${stageTimings}`,
      );
    } else {
      console.log(
        `  #${row.runIndex} ${row.mode}  total=${fmt(row.totalMs)}  bytes=${row.bytes}  ${row.hasTrack ? "✓" : "✗"}  celestial=${row.celestial}`,
      );
    }
  }
}

async function warmup() {
  console.log("[bench] warm-up: priming Next.js dev compilation...");
  try {
    const r = await timeJsonRun(0);
    console.log(
      `[bench] warm-up done: status=${r.status}  total=${r.totalMs.toFixed(0)} ms`,
    );
  } catch (err) {
    console.error("[bench] warm-up failed:", err.message);
  }
}

async function main() {
  await warmup();
  const jsonRows = [];
  const sseRows = [];
  for (let i = 0; i < COUNT; i++) {
    try {
      const row = await timeJsonRun(i + 1);
      jsonRows.push(row);
      console.log(
        `[bench] json run #${row.runIndex}  total=${row.totalMs.toFixed(0)} ms  status=${row.status}`,
      );
    } catch (err) {
      console.error(`[bench] json run #${i + 1} threw:`, err.message);
    }
    try {
      const row = await timeSseRun(i + 1);
      sseRows.push(row);
      const stages = row.progressStages.join("→");
      console.log(
        `[bench] sse  run #${row.runIndex}  total=${row.totalMs.toFixed(0)} ms  stages=[${stages}]  result=${row.resultTime ? row.resultTime.toFixed(0) : "n/a"} ms`,
      );
    } catch (err) {
      console.error(`[bench] sse run #${i + 1} threw:`, err.message);
    }
  }
  summarize("JSON mode (legacy)", jsonRows);
  summarize("SSE mode (new)", sseRows);
}

main().catch((err) => {
  console.error("[bench] fatal:", err);
  process.exit(1);
});