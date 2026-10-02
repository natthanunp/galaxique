#!/usr/bin/env node
/**
 * Song-knowledge audit. Writes data/catalog/knowledge.json (schema: lib/catalogSchema.ts)
 * and data/catalog/review-queue.csv for human review.
 *
 *   node scripts/audit-song-knowledge.mjs                  import legacy entries only (no API calls)
 *   node scripts/audit-song-knowledge.mjs --research-new   draft entries for approved tracks without knowledge
 *   node scripts/audit-song-knowledge.mjs --languages      draft lyric_language/lyrics for entries missing them
 *   node scripts/audit-song-knowledge.mjs --ground-legacy  re-derive recall-only descriptors from Brave Search results
 *
 * Drafts are never selectable until a reviewer sets review_status to "reviewed"
 * (or "native-reviewed" for Thai, which needs a native speaker). Summaries are
 * original wording; lyrics are never copied. Uncertain facts stay unset.
 */
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { SHARED_MODEL } from "../config/models.ts";
import { knowledgeEntrySchema, knowledgeFileSchema } from "../lib/catalogSchema.ts";
import { loadEnvLocal } from "./sync-playlist.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CATALOG_DIR = path.join(ROOT, "data", "catalog");
const KNOWLEDGE_PATH = path.join(CATALOG_DIR, "knowledge.json");
const LEGACY_PATH = path.join(ROOT, "data", "songKnowledge.json");
const THAI_SCRIPT = /\p{Script=Thai}/u;

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
};

function fromLegacy(entry, isrc) {
  return {
    knowledge_version: 2,
    name: entry.name,
    artist: entry.artist,
    isrc: isrc ?? null,
    known: Boolean(entry.known),
    review_status: "legacy",
    confidence: entry.known ? "medium" : "low",
    sources: [{ type: "legacy-import" }, ...(entry.grounded ? [{ type: "web-search" }] : [{ type: "model-recall" }])],
    lyrics: "unknown",
    ...(typeof entry.is_thai === "boolean" ? { is_thai: entry.is_thai } : {}),
    themes: entry.themes ?? [],
    relationship_stance: entry.relationship_stance ?? "",
    mood: entry.mood ?? "",
    energy: entry.energy ?? "",
    ...(Number.isInteger(entry.intensity) ? { intensity: entry.intensity } : {}),
    setting: entry.setting ?? "",
    summary: entry.summary ?? "",
  };
}

async function callModel(system, user, maxTokens = 900) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: SHARED_MODEL.model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: maxTokens,
        reasoning: { effort: "low" },
        provider: { order: SHARED_MODEL.providers, allow_fallbacks: SHARED_MODEL.allowFallbacks },
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`OpenRouter request failed (${res.status})`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    try {
      return JSON.parse(content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1"));
    } catch {
      return null;
    }
  }
  throw new Error("OpenRouter kept failing.");
}

let braveQueue = Promise.resolve();
// Brave allows about one request per second, so calls run one at a time even when callers are concurrent.
function braveSearch(query) {
  const run = braveQueue.then(() => braveRequest(query));
  braveQueue = run.catch(() => {});
  return run;
}

async function braveRequest(query) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: "8" })}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(20_000),
  });
  await new Promise((r) => setTimeout(r, 1100));
  if (!res.ok) return [];
  const data = await res.json();
  return (data.web?.results ?? []).slice(0, 8).map((r) => ({ title: r.title ?? "", snippet: r.description ?? "", url: r.url ?? "" }));
}

const EDITOR = "You are a careful music editor. Never fabricate. Describe songs in your own words, never quote lyrics. If unsure about a fact, mark it unknown.";

const draftPrompt = (track, results) => `Song: "${track.name}" by ${track.artist}
${results ? `Use ONLY these web results as evidence:\n${results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join("\n\n") || "(none)"}\n` : "Use only what you genuinely know about this exact recording."}
Return JSON:
{"known": boolean (false if you cannot honestly describe it),
 "confidence": "high"|"medium"|"low",
 "lyrics": "present"|"none"|"unknown"  (none = instrumental),
 "lyric_language": ISO 639-1 code of the PRIMARY vocal language, "none" for instrumentals, or null if unsure,
 "language_flag": null | "thai-artist-other-language" (a Thai artist singing mainly in another language) | "mixed-language" (no single primary language) | "uncertain",
 "themes": 2-4 short lyrical theme tags ([] for instrumentals; never invent lyrical themes),
 "relationship_stance": short phrase, "mood": short phrase,
 "energy": short phrase describing musical energy, "intensity": 1-5,
 "setting": short phrase, "summary": one original sentence about premise and sound}`;

const languagePrompt = (tracks) => `For each song, give the PRIMARY vocal language of the recording.
Return JSON {"songs":[{"id":"...","lyric_language": ISO 639-1 code | "none" (instrumental) | null (unsure),"lyrics":"present"|"none"|"unknown","language_flag": null|"thai-artist-other-language"|"mixed-language"|"uncertain"}]}.
"thai-artist-other-language" = a Thai artist whose song is sung mainly in English or another non-Thai language. Use null rather than guessing.
Songs: ${JSON.stringify(tracks.map((t) => ({ id: t.track_id, title: t.name, artist: t.artist })))}`;

function sanitizeLanguage(raw, entry) {
  const code = typeof raw.lyric_language === "string" && /^([a-z]{2}|none)$/.test(raw.lyric_language) ? raw.lyric_language : undefined;
  const flag = ["thai-artist-other-language", "mixed-language", "uncertain"].includes(raw.language_flag) ? raw.language_flag : undefined;
  const lyrics = ["present", "none", "unknown"].includes(raw.lyrics) ? raw.lyrics : entry.lyrics;
  // Edge cases wait for the owner; without a confirmed language the legacy flag still applies.
  const autoFlag = !flag && entry.is_thai && code && code !== "th" && code !== "none" ? "thai-artist-other-language" : flag;
  return {
    ...entry,
    lyrics: code === "none" ? "none" : lyrics,
    ...(code && !autoFlag ? { lyric_language: code } : {}),
    ...(autoFlag ? { language_flag: autoFlag, notes: `Model suggested lyric_language=${code ?? "unknown"}; owner to decide.` } : {}),
    ...(code === "none" ? { themes: [] } : {}),
  };
}

async function researchNew(approved, knowledge) {
  const missing = approved.tracks.filter((t) => t.status === "active" && !knowledge[t.track_id]);
  console.log(`Researching ${missing.length} new tracks…`);
  for (const track of missing) {
    let raw = await callModel(EDITOR, draftPrompt(track));
    let grounded = false;
    if (!raw?.known || raw.confidence === "low") {
      const results = await braveSearch(`${track.name} ${track.artist} song meaning${THAI_SCRIPT.test(track.name + track.artist) ? " ความหมาย เพลง" : ""}`);
      if (results.length) {
        raw = await callModel(EDITOR, draftPrompt(track, results));
        grounded = true;
      }
    }
    const base = {
      knowledge_version: 2, name: track.name, artist: track.artist, isrc: track.isrc,
      known: Boolean(raw?.known), review_status: "draft",
      confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "low",
      sources: [{ type: grounded ? "web-search" : "model-recall" }],
      lyrics: "unknown",
      themes: Array.isArray(raw?.themes) ? raw.themes.slice(0, 4).map(String) : [],
      relationship_stance: String(raw?.relationship_stance ?? ""), mood: String(raw?.mood ?? ""),
      energy: String(raw?.energy ?? ""), setting: String(raw?.setting ?? ""), summary: String(raw?.summary ?? ""),
      ...(Number.isInteger(raw?.intensity) && raw.intensity >= 1 && raw.intensity <= 5 ? { intensity: raw.intensity } : {}),
      ...(THAI_SCRIPT.test(track.name + track.artist) ? { is_thai: true } : {}),
    };
    const entry = knowledgeEntrySchema.parse(sanitizeLanguage(raw ?? {}, base));
    knowledge[track.track_id] = entry;
    console.log(`  + ${track.name} — ${track.artist} [${entry.known ? entry.confidence : "unknown"}${entry.lyric_language ? `, ${entry.lyric_language}` : ""}${entry.language_flag ? `, ${entry.language_flag}` : ""}]`);
  }
}

async function auditLanguages(approved, knowledge) {
  const pending = approved.tracks.filter((t) => knowledge[t.track_id] && !knowledge[t.track_id].lyric_language && !knowledge[t.track_id].language_flag);
  console.log(`Checking lyric language for ${pending.length} entries…`);
  for (let i = 0; i < pending.length; i += 20) {
    const batch = pending.slice(i, i + 20);
    const raw = await callModel(EDITOR, languagePrompt(batch), 2500);
    for (const song of raw?.songs ?? []) {
      const entry = knowledge[song.id];
      if (!entry || !batch.some((t) => t.track_id === song.id)) continue;
      knowledge[song.id] = knowledgeEntrySchema.parse(sanitizeLanguage(song, entry));
    }
    console.log(`  ${Math.min(i + 20, pending.length)}/${pending.length}`);
  }
}

async function groundUnverified(approved, knowledge) {
  const pending = approved.tracks.filter((t) => {
    const k = knowledge[t.track_id];
    return k?.known && k.review_status !== "reviewed" && k.review_status !== "native-reviewed" && !k.sources.some((s) => s.type === "web-search");
  });
  console.log(`Grounding ${pending.length} recall-only entries with web search…`);
  let updated = 0, kept = 0, done = 0;
  const ground = async (track) => {
    try {
      const results = await braveSearch(`${track.name} ${track.artist} song meaning${THAI_SCRIPT.test(track.name + track.artist) ? " ความหมาย เพลง" : ""}`);
      if (!results.length) { kept++; return; }
      const raw = await callModel(EDITOR, draftPrompt(track, results));
      if (!raw?.known || raw.confidence === "low") { kept++; return; }
      const entry = knowledge[track.track_id];
      // Descriptors only: language fields and review state stay as they were.
      knowledge[track.track_id] = knowledgeEntrySchema.parse({
        ...entry,
        confidence: ["high", "medium"].includes(raw.confidence) ? raw.confidence : entry.confidence,
        sources: [...entry.sources.filter((s) => s.type !== "model-recall"), { type: "web-search" }],
        themes: Array.isArray(raw.themes) ? raw.themes.slice(0, 4).map(String) : entry.themes,
        relationship_stance: String(raw.relationship_stance || entry.relationship_stance),
        mood: String(raw.mood || entry.mood), energy: String(raw.energy || entry.energy),
        setting: String(raw.setting || entry.setting), summary: String(raw.summary || entry.summary),
        ...(Number.isInteger(raw.intensity) && raw.intensity >= 1 && raw.intensity <= 5 ? { intensity: raw.intensity } : {}),
      });
      updated++;
    } catch (error) {
      kept++;
      console.log(`  ! ${track.name}: ${error.message}`);
    } finally {
      done++;
      console.log(`  ${done}/${pending.length} ${track.name}`);
      if (done % 10 === 0) await writeFile(KNOWLEDGE_PATH, JSON.stringify(knowledgeFileSchema.parse(knowledge), null, 2) + "\n");
    }
  };
  const queue = [...pending];
  await Promise.all(Array.from({ length: 6 }, async () => { for (let t = queue.shift(); t; t = queue.shift()) await ground(t); }));
  console.log(`Grounded ${updated}; left unchanged ${kept} (no results or low confidence).`);
}

function reviewQueue(approved, knowledge, selectedCounts) {
  const csv = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = approved.tracks.filter((t) => knowledge[t.track_id]).map((t) => {
    const k = knowledge[t.track_id];
    const thai = k.lyric_language === "th" || (!k.lyric_language && k.is_thai);
    const priority = k.review_status === "draft" ? 1
      : !selectedCounts[t.track_id] ? 2
        : thai && k.review_status !== "native-reviewed" ? 3 : 4;
    return { priority, t, k, thai };
  }).sort((a, b) => a.priority - b.priority || a.t.name.localeCompare(b.t.name));
  const header = "priority,reason,track_id,name,artist,review_status,needs_native_review,lyric_language,language_flag,confidence,known,themes,relationship_stance,mood,energy,setting,summary";
  const reasons = { 1: "new track (draft)", 2: "never selected", 3: "Thai, needs native review", 4: "audit" };
  return [header, ...rows.map(({ priority, t, k, thai }) => [
    priority, reasons[priority], t.track_id, t.name, t.artist, k.review_status, thai && k.review_status !== "native-reviewed",
    k.lyric_language ?? "", k.language_flag ?? "", k.confidence, k.known, k.themes.join("; "),
    k.relationship_stance, k.mood, k.energy, k.setting, k.summary,
  ].map(csv).join(","))].join("\n") + "\n";
}

async function selectedCountsFromRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};
  const counts = {};
  for (const lang of ["en", "th"]) {
    const res = await fetch(`${url}/hgetall/galaxseea:v2:selected:${lang}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const list = (await res.json()).result ?? [];
    for (let i = 0; i < list.length; i += 2) counts[list[i]] = (counts[list[i]] ?? 0) + Number(list[i + 1]);
  }
  return counts;
}

async function main() {
  loadEnvLocal();
  const approved = await readJson(path.join(CATALOG_DIR, "approved.json"), null);
  if (!approved) throw new Error("Run scripts/sync-playlist.mjs --approve first.");
  const legacy = await readJson(LEGACY_PATH, {});
  const knowledge = await readJson(KNOWLEDGE_PATH, {});

  for (const track of approved.tracks) {
    if (knowledge[track.track_id]) continue;
    const alias = (track.aliases ?? []).find((id) => knowledge[id] || legacy[id]);
    if (alias && knowledge[alias]) knowledge[track.track_id] = { ...knowledge[alias], isrc: track.isrc };
    else if (legacy[track.track_id] ?? (alias && legacy[alias])) knowledge[track.track_id] = fromLegacy(legacy[track.track_id] ?? legacy[alias], track.isrc);
  }

  if (process.argv.includes("--research-new")) await researchNew(approved, knowledge);
  if (process.argv.includes("--languages")) await auditLanguages(approved, knowledge);
  if (process.argv.includes("--ground-legacy")) {
    await writeFile(path.join(CATALOG_DIR, "reports", "knowledge.before-grounding.json"), JSON.stringify(knowledge, null, 2) + "\n");
    await groundUnverified(approved, knowledge);
  }

  const validated = knowledgeFileSchema.parse(knowledge);
  await writeFile(KNOWLEDGE_PATH, JSON.stringify(validated, null, 2) + "\n");
  await writeFile(path.join(CATALOG_DIR, "review-queue.csv"), reviewQueue(approved, validated, await selectedCountsFromRedis()));
  const entries = Object.values(validated);
  const by = (f) => entries.reduce((acc, e) => ({ ...acc, [f(e)]: (acc[f(e)] ?? 0) + 1 }), {});
  console.log("knowledge.json:", entries.length, "entries", by((e) => e.review_status), "lyric_language:", by((e) => e.lyric_language ?? "unset"), "flags:", by((e) => e.language_flag ?? "none"));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
