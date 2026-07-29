#!/usr/bin/env node
/**
 * Offline generator for the curated song-knowledge cache.
 *
 * Fetches every track in the configured Spotify playlist, asks an LLM for a
 * factual semantic descriptor of EACH track individually (lyrical premise,
 * mood, energy, setting — never derived from title/artist/genre stereotype),
 * and writes the result to data/songKnowledge.json keyed by track ID.
 *
 * If the model isn't confident about a track from memory alone (common for
 * non-English/niche indie tracks — this catalog's Thai tracks especially),
 * it falls back to a web-search-grounded pass: query the Brave Search API
 * for the song's lyrics/meaning, and ask the model to describe it using
 * ONLY those retrieved snippets. Still marked known:false if even that
 * isn't enough — never fabricated.
 *
 * Run after the configured playlist changes, or to refresh/curate entries:
 *   node scripts/generate-song-knowledge.mjs
 *   node scripts/generate-song-knowledge.mjs --force              (regenerate everything)
 *   node scripts/generate-song-knowledge.mjs --reground-unknown   (retry only known:false entries)
 *
 * Reads credentials from .env.local (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
 * SPOTIFY_REFRESH_TOKEN, SPOTIFY_PLAYLIST_ID, OPENROUTER_API_KEY,
 * OPENROUTER_MODEL, BRAVE_SEARCH_API_KEY). The resulting JSON is plain data —
 * safe to hand-edit afterward to correct any entry the model got wrong.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "songKnowledge.json");
const CONCURRENCY = 5;

function loadEnvLocal() {
  try {
    const raw = readFileSync(path.join(ROOT, ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.local is optional if the shell already has the vars exported.
  }
}

async function requestSpotifyToken(body) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are required.");
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function getUserAccessToken() {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "SPOTIFY_REFRESH_TOKEN is required — complete the owner OAuth flow via /api/spotify/authorize first.",
    );
  }
  const data = await requestSpotifyToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  return data.access_token;
}

async function fetchPlaylistTracks(token, playlistId) {
  const tracks = [];
  let offset = 0;
  const limit = 50;
  while (tracks.length < 300) {
    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?${new URLSearchParams(
      { limit: String(limit), offset: String(offset) },
    )}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Spotify playlist request failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const page = (data.items ?? [])
      .map((item) => item.item ?? item.track)
      .filter((t) => t && t.id && t.name);
    tracks.push(
      ...page.map((t) => ({
        track_id: t.id,
        name: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
      })),
    );
    if (!data.next || page.length === 0) break;
    offset += limit;
  }
  return tracks;
}

function buildDescriptorPrompt(track) {
  return `Song: "${track.name}" by ${track.artist}

If you are not genuinely confident about this exact track's real content and
sound (not a guess from its title, artist reputation, or genre), respond with
exactly: {"known": false}

Note: some tracks are instrumental (film/game scores, ambient, classical) with
no lyrics at all — that is NOT a reason to say known:false. For those, base
themes/mood/setting on the piece's actual musical character and known context
(e.g. the film scene or album it's from), not lyrics.

Otherwise, respond with ONLY this JSON object (no markdown, no commentary):
{
  "known": true,
  "themes": ["2 to 4 short theme tags"],
  "relationship_stance": "one short phrase, e.g. heartbreak, secure closeness, independence, romantic yearning, playful connection, loneliness, being seen, awe, wonder (use a non-relationship phrase like 'awe' or 'wonder' if the track is instrumental/non-romantic)",
  "mood": "one short phrase",
  "energy": "one short phrase, e.g. still and intimate, driving, euphoric, restrained",
  "setting": "one short phrase, e.g. late-night alone, sunlit and social",
  "summary": "one sentence describing the lyrical or musical premise and sonic character, in your own words, no lyric quotes",
  "vibe": "one of: cute, cozy, mysterious, intense, whimsical. Most songs in a dreamy/indie playlist are cozy or mysterious — reserve intense for tracks that are genuinely dark, anguished, confrontational, or high-stakes emotional turmoil. cozy = warm, comforting, tender, nostalgic warmth (most gentle indie/dream-pop love songs are cozy); cute = light, affectionate, openly warm, optimistic; mysterious = eerie, private, ambiguous, dreamlike, enigmatic; intense = genuinely dark, tense, brooding, anguished, confrontational; whimsical = surreal, playful, imaginative, delightfully odd. A driving beat does NOT make a song intense — a driving love song is cozy or whimsical. A melancholic but gentle song is cozy or mysterious, NOT intense.",
  "celestial_affinity": ["1-2 of: galaxy, black_hole, neutron_star — based on the song's EMOTIONAL DIRECTION, NOT its mood or energy level. Mood (sad/melancholic) is NOT the same as direction (inward vs outward). galaxy = outward, expansive, connective, self-expressive — songs about love, longing for connection, romantic yearning, belonging, celebration, self-empowerment, self-love, uplift, freedom, or play are GALAXY even if they sound melancholic (yearning for someone = reaching outward). black_hole = inward, withdrawn, solitary, drawn to darkness — only songs about solitude as a state (not longing for someone), emotional withdrawal, genuine darkness, paranoia, or deep introspection with no outward pull. neutron_star = concentrated, disciplined, ambitious, driven, high-pressure — ONLY songs about determination, ambition, fierce drive, or resilience UNDER PRESSURE (not just any upbeat/empowering song). Self-love/self-empowerment songs are GALAXY (outward self-expression), NOT neutron_star. A melancholic love song is GALAXY (it yearns outward), NOT black_hole."],
  "intensity": "integer 1-5 (1=still/ambient, 2=restrained/gentle, 3=mid-tempo, 4=driving, 5=euphoric/anthemic)",
  "is_thai": "true if this is a Thai-language song or a Thai artist targeting a Thai audience (e.g. lyrics in Thai, or a Thai indie/pop artist like FREEHAND, Safeplanet, Dept, loserpop, YOUNGOHM, Television off, Hugo, fellow fellow, FOLK9, Sqweez Animal, AYLA's, Temper City, guncharlie, Musketeers, PURPEECH, LANDOKMAI, Violette Wautier); false for English/international songs. A Thai artist singing in English to an international audience is still is_thai:true if they are primarily known in the Thai music scene."
}

Do not infer meaning from the title, artist reputation, genre stereotype, or
popularity. Only describe what the track is actually about and how it sounds.`;
}

const THAI_RE = /[\u0E00-\u0E7F]/;

/** Query the Brave Search API and return the top result titles + snippets as
 *  plain text — used to ground the descriptor for tracks the model doesn't
 *  confidently know from memory (this is where most of the Thai-language
 *  catalog ended up, since the LLM's training data skews heavily
 *  English/mainstream).
 *
 *  Official, keyed, ToS-compliant JSON API (unlike scraping DuckDuckGo's HTML
 *  results page, which trips bot-detection/rate-limits fast). Free tier is
 *  2,000 queries/month — get a key at https://brave.com/search/api/. Retries
 *  with backoff on 429 (rate limit) since the free tier also has a low
 *  requests-per-second cap. */
const SEARCH_MIN_GAP_MS = 1100; // free tier: 1 request/sec
let searchQueue = Promise.resolve();

async function searchWebOnce(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is required for web-search grounding.");
  const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({
    q: query,
    count: "8",
  })}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  if (res.status === 429) return null;
  if (!res.ok) {
    throw new Error(`Brave Search request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const results = data.web?.results ?? [];
  return results.slice(0, 8).map((r) => ({ title: r.title ?? "", snippet: r.description ?? "" }));
}

async function searchWeb(query) {
  // Chain onto the shared queue so requests stay under the free tier's
  // requests-per-second cap, each separated by SEARCH_MIN_GAP_MS.
  const run = searchQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const results = await searchWebOnce(query).catch(() => null);
      if (results !== null) return results;
      const backoffMs = 4000 * (attempt + 1);
      console.warn(`  ! Brave Search rate-limited for "${query}" — backing off ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    return [];
  });
  searchQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, SEARCH_MIN_GAP_MS)));
  return run;
}

function buildGroundedPrompt(track, results) {
  const groundingText = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
    .join("\n\n");
  return `Song: "${track.name}" by ${track.artist}

Below are web search results (titles + snippets) about this song, which may
include lyric excerpts, fan/press descriptions of its meaning, or — for
instrumental tracks (film/game scores, ambient, classical) — descriptions of
its musical character and the scene/context it's used in:

${groundingText || "(no search results found)"}

Using ONLY the information above (not your own prior knowledge), determine
whether it gives you enough to honestly describe this track's real theme and
likely mood/energy. A track being instrumental/non-lyrical (e.g. tagged
"non-lyrical vocals" or described purely by its score/production notes) is NOT
a reason to say known:false — ground themes/mood/setting in its musical
character and context instead. Only respond {"known": false} if the results
truly give no indication of subject matter at all (e.g. just chord/karaoke
listings with zero context).

Otherwise, respond with ONLY this JSON object (no markdown, no commentary):
{
  "known": true,
  "themes": ["2 to 4 short theme tags"],
  "relationship_stance": "one short phrase, e.g. heartbreak, secure closeness, independence, romantic yearning, playful connection, loneliness, being seen, awe, wonder (use a non-relationship phrase like 'awe' or 'wonder' if the track is instrumental/non-romantic)",
  "mood": "one short phrase",
  "energy": "one short phrase, e.g. still and intimate, driving, euphoric, restrained",
  "setting": "one short phrase, e.g. late-night alone, sunlit and social",
  "summary": "one sentence describing the lyrical premise and sonic character, in your own words, no lyric quotes, based only on the provided excerpts",
  "vibe": "one of: cute, cozy, mysterious, intense, whimsical. Most songs in a dreamy/indie playlist are cozy or mysterious — reserve intense for tracks that are genuinely dark, anguished, confrontational, or high-stakes emotional turmoil. cozy = warm, comforting, tender, nostalgic warmth (most gentle indie/dream-pop love songs are cozy); cute = light, affectionate, openly warm, optimistic; mysterious = eerie, private, ambiguous, dreamlike, enigmatic; intense = genuinely dark, tense, brooding, anguished, confrontational; whimsical = surreal, playful, imaginative, delightfully odd. A driving beat does NOT make a song intense — a driving love song is cozy or whimsical. A melancholic but gentle song is cozy or mysterious, NOT intense.",
  "celestial_affinity": ["1-2 of: galaxy, black_hole, neutron_star — based on the song's EMOTIONAL DIRECTION, NOT its mood or energy level. Mood (sad/melancholic) is NOT the same as direction (inward vs outward). galaxy = outward, expansive, connective, self-expressive — songs about love, longing for connection, romantic yearning, belonging, celebration, self-empowerment, self-love, uplift, freedom, or play are GALAXY even if they sound melancholic (yearning for someone = reaching outward). black_hole = inward, withdrawn, solitary, drawn to darkness — only songs about solitude as a state (not longing for someone), emotional withdrawal, genuine darkness, paranoia, or deep introspection with no outward pull. neutron_star = concentrated, disciplined, ambitious, driven, high-pressure — ONLY songs about determination, ambition, fierce drive, or resilience UNDER PRESSURE (not just any upbeat/empowering song). Self-love/self-empowerment songs are GALAXY (outward self-expression), NOT neutron_star. A melancholic love song is GALAXY (it yearns outward), NOT black_hole."],
  "intensity": "integer 1-5 (1=still/ambient, 2=restrained/gentle, 3=mid-tempo, 4=driving, 5=euphoric/anthemic)",
  "is_thai": "true if this is a Thai-language song or a Thai artist targeting a Thai audience (e.g. lyrics in Thai, or a Thai indie/pop artist); false for English/international songs. A Thai artist singing in English to an international audience is still is_thai:true if they are primarily known in the Thai music scene."
}`;
}

async function callOpenRouter(userPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a knowledgeable, honest music editor. You never fabricate a song's lyrical meaning — you only describe songs you actually know well.",
        },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 400,
      reasoning: { enabled: false },
      provider: { sort: "throughput" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1]?.trim() ?? content.trim());
}

const VALID_VIBES = new Set(["cute", "cozy", "mysterious", "intense", "whimsical"]);
const VALID_CELESTIAL = new Set(["galaxy", "black_hole", "neutron_star"]);

/** Coerce the LLM's new-field output into the schema shape, dropping
 *  anything invalid so a bad value never poisons the cache. */
function normalizeNewFields(parsed) {
  const vibe = typeof parsed.vibe === "string" && VALID_VIBES.has(parsed.vibe)
    ? parsed.vibe
    : undefined;
  const celestial_affinity = Array.isArray(parsed.celestial_affinity)
    ? parsed.celestial_affinity.filter((c) => VALID_CELESTIAL.has(c)).slice(0, 2)
    : undefined;
  const intensityRaw = Number(parsed.intensity);
  const intensity = Number.isFinite(intensityRaw) && intensityRaw >= 1 && intensityRaw <= 5
    ? Math.round(intensityRaw)
    : undefined;
  const is_thai = typeof parsed.is_thai === "boolean" ? parsed.is_thai : undefined;
  const extra = {};
  if (vibe) extra.vibe = vibe;
  if (celestial_affinity && celestial_affinity.length > 0) extra.celestial_affinity = celestial_affinity;
  if (intensity !== undefined) extra.intensity = intensity;
  if (is_thai !== undefined) extra.is_thai = is_thai;
  return extra;
}

async function describeTrack(track, index, total) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const parsed = await callOpenRouter(buildDescriptorPrompt(track));
      if (parsed.known) {
        process.stdout.write(`[${index + 1}/${total}] ${track.name} — ${track.artist}: known\n`);
        return {
          name: track.name,
          artist: track.artist,
          known: true,
          themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 4) : [],
          relationship_stance: String(parsed.relationship_stance ?? ""),
          mood: String(parsed.mood ?? ""),
          energy: String(parsed.energy ?? ""),
          setting: String(parsed.setting ?? ""),
          summary: String(parsed.summary ?? ""),
          ...normalizeNewFields(parsed),
        };
      }
      // Not confident from memory — fall back to a web-search-grounded pass
      // instead of giving up. This is where most of the catalog's
      // Thai-language indie tracks get resolved, since the base LLM's
      // training data skews heavily English/mainstream.
      const query = THAI_RE.test(track.name)
        ? `${track.name} ${track.artist} เนื้อเพลง ความหมาย`
        : `${track.name} ${track.artist} lyrics meaning explained`;
      const results = await searchWeb(query).catch(() => []);
      const grounded = await callOpenRouter(buildGroundedPrompt(track, results));
      process.stdout.write(
        `[${index + 1}/${total}] ${track.name} — ${track.artist}: ${
          grounded.known ? "known (grounded via web search)" : "unknown"
        }\n`,
      );
      if (!grounded.known) {
        return {
          name: track.name,
          artist: track.artist,
          known: false,
          themes: [],
          relationship_stance: "",
          mood: "",
          energy: "",
          setting: "",
          summary: "",
        };
      }
      return {
        name: track.name,
        artist: track.artist,
        known: true,
        grounded: true,
        themes: Array.isArray(grounded.themes) ? grounded.themes.slice(0, 4) : [],
        relationship_stance: String(grounded.relationship_stance ?? ""),
        mood: String(grounded.mood ?? ""),
        energy: String(grounded.energy ?? ""),
        setting: String(grounded.setting ?? ""),
        summary: String(grounded.summary ?? ""),
        ...normalizeNewFields(grounded),
      };
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  ! failed after 3 attempts: ${track.name} — ${track.artist}`, err.message);
        return {
          name: track.name,
          artist: track.artist,
          known: false,
          themes: [],
          relationship_stance: "",
          mood: "",
          energy: "",
          setting: "",
          summary: "",
        };
      }
    }
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  loadEnvLocal();
  const playlistId = (process.env.SPOTIFY_PLAYLIST_ID || "1LGPBmHJCUZWlrxz17lWhP").trim();

  console.log(`Fetching playlist ${playlistId}...`);
  const token = await getUserAccessToken();
  const tracks = await fetchPlaylistTracks(token, playlistId);
  console.log(`Fetched ${tracks.length} tracks. Generating descriptors (concurrency=${CONCURRENCY})...`);

  // Preserve any existing curated entries — only (re)generate what's missing,
  // unless --force (regenerate everything) or --reground-unknown (retry just
  // the tracks currently marked known:false, e.g. after improving the
  // grounding logic) is passed.
  const force = process.argv.includes("--force");
  const regroundUnknown = process.argv.includes("--reground-unknown");
  let existing = {};
  if (!force) {
    try {
      existing = JSON.parse(await readFile(OUT_PATH, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const toGenerate = tracks.filter(
    (t) => force || !existing[t.track_id] || (regroundUnknown && existing[t.track_id]?.known === false),
  );
  console.log(`${toGenerate.length} track(s) need generation (${tracks.length - toGenerate.length} already cached).`);

  const generated = await mapWithConcurrency(toGenerate, CONCURRENCY, describeTrack);

  const result = { ...existing };
  toGenerate.forEach((t, i) => {
    result[t.track_id] = generated[i];
  });

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(result, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${Object.keys(result).length} entries to ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
