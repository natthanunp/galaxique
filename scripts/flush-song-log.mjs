#!/usr/bin/env node
/* eslint-disable */
/**
 * Flushes the rolling song-selection log from Upstash Redis. Used in
 * development after running a few test quizzes — each call appends the
 * resolved track id to `galaxseea:song-selections` (see
 * lib/songSelectionStore.ts), and after enough tests the log fills with
 * repeats that bias the variety sampler. Clearing the log gives every
 * track equal weight again.
 *
 * Reads KV_REST_API_URL / KV_REST_API_TOKEN from .env.local (same env
 * vars the app uses) and issues a single DEL against the list key.
 * Uses Upstash's REST API directly (no SDK install needed) so this
 * script works even when the dev server isn't running.
 *
 * Usage:
 *   node scripts/flush-song-log.mjs
 *   node scripts/flush-song-log.mjs --confirm   # skip the prompt
 *
 * Exits non-zero if credentials are missing or the DEL call fails.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env.local");
const LIST_KEY = "galaxseea:song-selections";

/** Minimal .env.local parser — no comments, no escapes. Good enough for
 *  the Upstash credentials which are always simple `KEY=VALUE` lines. */
function loadEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(ENV_PATH);
const url =
  process.env.KV_REST_API_URL || env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL || env.UPSTASH_REDIS_REST_URL;
const token =
  process.env.KV_REST_API_TOKEN || env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error(
    "Missing Upstash credentials. Set KV_REST_API_URL and KV_REST_API_TOKEN in .env.local.",
  );
  process.exit(1);
}

const skipPrompt = process.argv.includes("--confirm");

async function confirm(prompt) {
  if (skipPrompt) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function listLength() {
  const res = await fetch(`${url}/llen/${LIST_KEY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`LLEN failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const body = await res.json();
  return body?.result ?? 0;
}

async function deleteKey() {
  const res = await fetch(`${url}/del/${LIST_KEY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`DEL failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body?.result ?? 0;
}

async function main() {
  console.log(`Target key: ${LIST_KEY}`);
  console.log(`Upstash URL: ${url}`);
  const before = await listLength();
  console.log(`Current log length: ${before ?? "unknown"}`);

  if (before === 0) {
    console.log("Log is already empty — nothing to flush.");
    return;
  }

  const ok = await confirm(
    `Delete ${before} entries from ${LIST_KEY}? (y/N) `,
  );
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  const removed = await deleteKey();
  const after = await listLength();
  console.log(`Removed: ${removed}  Remaining: ${after ?? "unknown"}`);
  if (after !== 0) {
    console.warn(
      `Warning: log is not empty after DEL (${after} entries remain). Check Upstash dashboard.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});