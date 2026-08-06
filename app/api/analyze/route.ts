import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { pickCreatureKindHint, pickSongFlavorHint } from "@/config/quizConfig";
import { callLlm } from "@/lib/llm";
import {
  songCandidatesSchema,
  universeRevealSchema,
  type UniverseRevealParsed,
} from "@/lib/schemas";
import { enrichPlaylistTracks } from "@/lib/songKnowledge";
import { getRecentSelections, recordSelection, type SongSelectionSource } from "@/lib/songSelectionStore";
import { sseStream, wantsEventStream, type ProgressCallback } from "@/lib/analyzeProgress";
import { getSpotifyPlaylistTracks, spotifyConfigured } from "@/lib/spotify";
import { getVibeStats } from "@/lib/vibeStatsStore";
import { buildRevealSystemPrompt } from "@/prompts/revealSystemPrompt";
import type { EnrichedPlaylistCandidate, Language, QuizAnswer, Vibe } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeBody {
  answers: QuizAnswer[];
  /** Runtime request data is untrusted even though current clients type this
   * as `Language`; an invalid value falls back to English rather than
   * guessing from the answers' visible text. */
  language?: unknown;
  /** Retained for client compatibility; no longer used server-side. Song
   *  variety is now driven by the shared rolling log in
   *  lib/songSelectionStore.ts (see pickWeightedSongSelection below), which
   *  works across users/instances instead of per-client history. */
  recentTrackIds?: string[];
}

/**
 * Accept "en" or "th"; anything else (missing, malformed, or a stale-client
 * unknown value) is treated as English. Clients select the language on the
 * landing page, so the request always carries an authoritative value; no
 * fallback inference is needed.
 */
function resolveLanguage(value: unknown): Language {
  return value === "en" || value === "th" ? value : "th";
}

interface ScoredSongCandidate {
  catalog_code: string;
  themes: number;
  stance: number;
  mood: number;
  energy: number;
  setting: number;
}

/** Per-phase breakdown logging for /api/analyze. Set BENCH_ANALYZE=1 in the
 *  env to enable; off by default so production logs stay clean. Emits one
 *  structured line per phase so the relative cost of Spotify fetch, biased
 *  sampler, weighted picker, and the merged LLM call is visible at a
 *  glance — useful when deciding where to spend latency-budget effort. */
const BENCH = process.env.BENCH_ANALYZE === "1";

function benchStart(): bigint {
  return process.hrtime.bigint();
}

function benchMs(since: bigint): number {
  return Number(process.hrtime.bigint() - since) / 1e6;
}

/** Tracks sampled as scoring candidates per request, out of the full
 *  catalog. This is the FIRST variety layer: any single track is only even
 *  a *candidate* in roughly `CATALOG_SAMPLE_SIZE / catalogSize` of requests,
 *  independent of how the model scores it when present. Bumped to 48 now
 *  that the sampler is biased toward under-served tracks (see
 *  sampleCatalogForRequest); an earlier uniform 18-sample let the same ~18
 *  tracks cycle while ~144 sat untouched. 48 of 162 (~30%) keeps the LLM
 *  catalog section bounded (~3k extra input tokens vs. 28) while giving
 *  the weighted picker substantially more fresh material each call — and
 *  combined with the under-served sampler below, the picker sees a near-
 *  completely unique candidate pool every request in steady state. */
const CATALOG_SAMPLE_SIZE = 48;

function isThaiTrack(track: EnrichedPlaylistCandidate): boolean {
  // Prefer the explicit is_thai flag from the curated knowledge cache — it
  // correctly catches Thai artists with English track names (e.g. YOUNGOHM's
  // "Sunset In Pattaya") that the script-detection heuristic below would miss.
  if (typeof track.knowledge?.is_thai === "boolean") {
    return track.knowledge.is_thai;
  }
  // Fallback for tracks without a knowledge entry (known:false or missing):
  // detect Thai script in name/artist, or the word "thai" in the summary.
  const thaiScript = /\p{Script=Thai}/u;
  return (
    thaiScript.test(track.name) ||
    thaiScript.test(track.artist) ||
    Boolean(track.knowledge?.summary && /\bthai\b/i.test(track.knowledge.summary))
  );
}

/** How many of the most-recently-picked tracks get a decaying recency
 *  penalty (prevents back-to-back repeats). Recency-only penalty was
 *  softened (0.8 / position, was 1.5 / position) because the biased
 *  sampler below already steers fresh tracks into the candidate pool —
 *  stacking a heavy recency penalty on top just suppresses already-served
 *  tracks harder without helping the long tail. Kept equal to MAX_LOG_LENGTH
 *  (50) so the recency penalty covers the full shared rolling log for a
 *  ~200-track catalog. */
const RECENCY_WINDOW = 50;

/** Weight assigned to a track per occurrence in the recent-selection log.
 *  Used by sampleCatalogForRequest to bias the candidate pool toward
 *  under-served tracks. Tracks with ZERO appearances get the full
 *  boost; tracks with N appearances get this weight per occurrence,
 *  subtracted from the base — so a track picked 7 times in the log
 *  gets a much smaller (or zero) sampling weight than one never picked. */
const UNDER_SERVED_BASE_WEIGHT = 7;

/** Softmax temperature for the final weighted pick. Lower = more strongly
 *  favors the top-scoring candidate; higher = flatter/more random. */
const SOFTMAX_TEMPERATURE = 8;

/** Vibe distribution guardrail: if the LLM's first-attempt `vibe` accounts
 *  for more than this share of recent reveals AND total reveals exceeds
 *  MIN_STATS_FOR_GUARDRAIL, retry the call with a rebalance nudge appended
 *  to the user prompt. The nudge is a soft counter — it does NOT force a
 *  different vibe, just asks the model to re-examine the full range of
 *  signals when the chosen vibe matches an over-represented bucket. If
 *  the second attempt returns the same dominant vibe, accept it (the
 *  evidence genuinely supports it). */
const VIBE_SKEW_THRESHOLD = 0.5;
const MIN_STATS_FOR_GUARDRAIL = 20;

/** Biased sampler: returns up to `n` tracks from the full catalog, with
 *  sampling weight proportional to how *under-served* each track is in the
 *  recent-selection log. A track never picked before gets weight 7; a
 *  track picked once gets weight 7 - 1 = 6; picked 7 times gets weight 0
 *  (excluded). This is the structural fix for "the same ~18 songs every
 *  time": even with the weighted picker perfectly fair, it can only pick
 *  from the sampled pool, so the pool itself must keep rotating. The bias
 *  is bounded — tracks NOT in the recent log still get the base weight,
 *  so a song that's been silent for a while (and therefore absent from the
 *  log) resurfaces naturally rather than being permanently shelved.
 *
 *  Cost is one O(N) pass over the catalog to compute weights, plus a
 *  weighted Fisher-Yates partial shuffle. N is ~162 in production — trivial. */
function sampleCatalogForRequest(
  tracks: EnrichedPlaylistCandidate[],
  n: number,
  recentLog: readonly string[],
): EnrichedPlaylistCandidate[] {
  if (tracks.length <= n) return [...tracks];
  // Count occurrences per track id in the rolling log (max 50 entries).
  const occurrenceCounts = new Map<string, number>();
  for (const id of recentLog) {
    occurrenceCounts.set(id, (occurrenceCounts.get(id) ?? 0) + 1);
  }
  // Pre-compute non-negative sampling weights so we never select a fully
  // saturated track over a never-picked one. Under-served tracks sit at
  // UNDER_SERVED_BASE_WEIGHT; tracks picked too often fall to 0.
  const indexed = tracks.map((track, index) => {
    const occurrences = occurrenceCounts.get(track.track_id) ?? 0;
    const weight = Math.max(0, UNDER_SERVED_BASE_WEIGHT - occurrences);
    return { index, weight };
  });
  const eligible = indexed.filter((entry) => entry.weight > 0);
  // Safety net: if every track is somehow saturated (log length >=
  // UNDER_SERVED_BASE_WEIGHT * catalog size), fall back to a uniform draw
  // over the whole catalog so the picker still has something to choose.
  const source = eligible.length >= n ? eligible : indexed;
  const totalWeight = source.reduce((sum, entry) => sum + entry.weight, 0);
  // Uniform draw fallback when all weights collapse (log just saturated).
  if (totalWeight <= 0) {
    const pool = [...tracks];
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }
  // Weighted Fisher-Yates partial shuffle: at step i, pick the next slot
  // proportional to weight among the remaining entries.
  const remaining = [...source];
  const picked: number[] = [];
  for (let i = 0; i < n && remaining.length > 0; i++) {
    const remainingTotal = remaining.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * remainingTotal;
    let chosenIndex = 0;
    for (let j = 0; j < remaining.length; j++) {
      roll -= remaining[j].weight;
      if (roll <= 0) {
        chosenIndex = j;
        break;
      }
    }
    picked.push(remaining[chosenIndex].index);
    remaining.splice(chosenIndex, 1);
  }
  return picked.map((idx) => tracks[idx]);
}

/** Resolves the model's scored shortlist to catalog tracks, applies
 *  recency + rolling frequency-share penalties (backed by the shared log in
 *  lib/songSelectionStore.ts), and does a weighted-random draw across ALL
 *  resolved candidates via softmax — NOT a deterministic always-pick-max.
 *  This is the structural fix for a single "safe default" track dominating
 *  selection: even a clear score leader doesn't always win, and a track
 *  sitting at a high observed share gets an increasingly large penalty.
 *
 *  The recent-selection log is supplied by the caller so this phase doesn't
 *  double-hit Redis / memory after the biased sampler already read it. */
async function pickWeightedSongSelection(
  candidates: ScoredSongCandidate[],
  sampledTracks: EnrichedPlaylistCandidate[],
  catalogSize: number,
  recentLog: readonly string[],
  recentLogSource: SongSelectionSource,
): Promise<{ track: EnrichedPlaylistCandidate; score: number } | undefined> {
  const bestByTrackId = new Map<
    string,
    { track: EnrichedPlaylistCandidate; rawScore: number }
  >();

  for (const candidate of candidates) {
    const trackIndex = Number(candidate.catalog_code.slice(1)) - 1;
    const track = sampledTracks[trackIndex];
    if (!track) continue;
    // Relationship stance is more diagnostic than a scenic setting: a user
    // describing care and closeness should not get a solitude song merely
    // because both also mention a landscape or quiet moment.
    const rawScore =
      candidate.themes +
      candidate.stance * 1.5 +
      candidate.mood +
      candidate.energy +
      candidate.setting;
    const previous = bestByTrackId.get(track.track_id);
    if (!previous || rawScore > previous.rawScore) {
      bestByTrackId.set(track.track_id, { track, rawScore });
    }
  }

  const resolved = [...bestByTrackId.values()];
  if (resolved.length === 0) return undefined;

  const fairShare = catalogSize > 0 ? 1 / catalogSize : 0;

  const adjusted = resolved.map(({ track, rawScore }) => {
    const recencyIndex = recentLog.indexOf(track.track_id);
    const recencyPenalty =
      recencyIndex === -1 || recencyIndex >= RECENCY_WINDOW
        ? 0
        : (RECENCY_WINDOW - recencyIndex) * 0.8;

    const countInLog = recentLog.filter((id) => id === track.track_id).length;
    const observedShare = recentLog.length > 0 ? countInLog / recentLog.length : 0;
    const frequencyPenalty = Math.max(0, observedShare - fairShare) * 100;

    const adjustedScore = Math.max(1, rawScore - recencyPenalty - frequencyPenalty);
    return { track, rawScore, adjustedScore };
  });

  const maxAdjusted = Math.max(...adjusted.map((a) => a.adjustedScore));
  const weights = adjusted.map((a) =>
    Math.exp((a.adjustedScore - maxAdjusted) / SOFTMAX_TEMPERATURE),
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * totalWeight;
  let pick = adjusted[0];
  for (let i = 0; i < adjusted.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      pick = adjusted[i];
      break;
    }
  }

  await recordSelection(pick.track.track_id);
  console.log(
    `[analyze] song selected: ${pick.track.name} — ${pick.track.artist} (raw score ${pick.rawScore}/55, log source=${recentLogSource})`,
  );
  return { track: pick.track, score: pick.rawScore };
}

/** Last-resort fallback when the LLM's song shortlist is missing or every
 *  candidate fails to resolve to a catalog track. Picks a random track that
 *  has a known descriptor so we never leave the curated playlist /
 *  songKnowledge set. Also recorded into the rolling log so a run of
 *  fallback picks still counts toward the frequency-share correction. */
async function pickCatalogFallback(
  tracks: EnrichedPlaylistCandidate[],
): Promise<EnrichedPlaylistCandidate> {
  const knownTracks = tracks.filter((t) => t.knowledge?.known);
  const pool = knownTracks.length > 0 ? knownTracks : tracks;
  if (pool.length === 0) {
    throw new Error("pickCatalogFallback called with empty track list");
  }
  const track = pool[Math.floor(Math.random() * pool.length)];
  await recordSelection(track.track_id);
  return track;
}

/** Substitutes the reveal's literal "[SELECTED SONG]" placeholder with the
 *  resolved track's real title/artist, and overwrites spotify_track_id /
 *  spotify_search_query with the resolved track (the LLM never invents
 *  these when a catalog is configured). English readings get a short
 *  deterministic clause built from the track's verified mood tag; Thai
 *  gets plain name/artist substitution only (mixing English descriptor
 *  words into a Thai sentence reads oddly — intentional asymmetry). */
function mergeSelectedSong(
  reveal: UniverseRevealParsed,
  selectedTrack: EnrichedPlaylistCandidate,
  language: Language,
): UniverseRevealParsed {
  const songMention = `"${selectedTrack.name}" by ${selectedTrack.artist}`;
  let reading = reveal.personality_reading.replace("[SELECTED SONG]", songMention);
  if (language === "en" && selectedTrack.knowledge?.known) {
    reading = `${reading} Its ${selectedTrack.knowledge.mood} pull echoes that same feeling.`;
  }
  return {
    ...reveal,
    spotify_track_id: selectedTrack.track_id,
    spotify_search_query: `${selectedTrack.name} ${selectedTrack.artist}`,
    personality_reading: reading,
  };
}

/** POST /api/analyze — ONE merged LLM call: map answers → universe reveal
 *  JSON, plus (when a playlist catalog is configured) a folded-in song
 *  scoring pass. Previously this was two sequential LLM calls; merging
 *  removes an entire network round trip.
 *
 *  Two response modes:
 *   - JSON (default, legacy): returns the final `UniverseReveal` as a
 *     single JSON body. Used by the benchmark script and any older
 *     bundle that doesn't set `Accept: text/event-stream`.
 *   - SSE (opt-in via `Accept: text/event-stream`): streams one
 *     `event: progress` line per phase boundary, then `event: result`
 *     with the final payload. Lets the client animate a multi-stage
 *     loading story instead of staring at a single spinner for ~7 s.
 *
 *  Both modes share the same `runAnalyze` worker. In SSE mode the worker
 *  runs INSIDE the stream's async producer, so `progress(...)` calls
 *  actually fire while the response is being consumed (rather than all
 *  before it, which would defeat the streaming). */
export async function POST(request: Request) {
  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
    return NextResponse.json(
      { error: "answers[] is required and must be non-empty." },
      { status: 400 },
    );
  }
  const streamRequested = wantsEventStream(request);

  if (streamRequested) {
    // Run the work inside the stream so each `progress()` call lands on
    // the SSE controller as the consumer reads. The worker is awaited
    // before `event: result` is emitted; the framework keeps the response
    // open until the stream closes.
    const stream = sseStream((progress) => runAnalyze(body, progress));
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable reverse-proxy buffering so events reach the client as
        // they're written instead of being held until the response closes.
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Legacy JSON path: progress callback is a no-op so call sites stay
  // identical between modes. The 502/500 error envelopes still come back
  // as plain JSON to preserve back-compat with existing callers.
  try {
    return NextResponse.json(await runAnalyze(body, () => {}));
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    console.error("[analyze]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to analyze answers.", detail: message },
      { status: 500 },
    );
  }
}

/** Tiny error type so the worker can throw non-fatal failures (Spotify
 *  unavailable, schema validation failed) with a structured envelope that
 *  the SSE path translates into an `event: error` and the JSON path
 *  returns directly. */
class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "HTTP error");
  }
}

/** The full analyze worker — Spotify fetch, biased sampler, merged LLM
 *  call, weighted picker, song substitution. Accepts a `progress` callback
 *  invoked at each phase boundary; in JSON mode the callback is a no-op.
 *
 *  Throws `HttpError` for recoverable failures (Spotify 503, schema 502)
 *  and lets unexpected errors propagate. Both POST branches above know
 *  how to render either as a response. */
async function runAnalyze(
  body: AnalyzeBody,
  progress: ProgressCallback,
): Promise<UniverseRevealParsed> {
  const language = resolveLanguage(body.language);
  const transcript = body.answers
    .map((a) => `Q${a.questionId}: ${a.questionText}\nA: ${a.answer}`)
    .join("\n\n");

  // A fresh nonce per incoming request is critical: callLlm() dedupes
  // concurrent calls sharing the same key onto one in-flight promise.
  const requestNonce = randomUUID();
  const creatureKindHint = pickCreatureKindHint();
  const benchRequestStart = BENCH ? benchStart() : BigInt(0);
  progress({ stage: "starting", msElapsed: 0 });

  let playlistTracks = [] as Awaited<ReturnType<typeof getSpotifyPlaylistTracks>>;
  const benchSpotifyStart = BENCH ? benchStart() : BigInt(0);
  if (spotifyConfigured()) {
    try {
      playlistTracks = await getSpotifyPlaylistTracks();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[analyze] Spotify playlist unavailable", err);
      throw new HttpError(503, {
        error: "Could not load the configured Spotify playlist.",
        detail: message,
      });
    }
  }
  const fetchedPlaylistTrackCount = playlistTracks.length;
  if (language === "en") {
    playlistTracks = playlistTracks.filter(
      (track) => !/\p{Script=Thai}/u.test(track.name) && !/\p{Script=Thai}/u.test(track.artist),
    );
    if (fetchedPlaylistTrackCount > 0 && playlistTracks.length === 0) {
      throw new HttpError(503, {
        error: "No non-Thai songs are available for English mode.",
      });
    }
  }
  if (BENCH) {
    console.log(
      `[bench-analyze] phase=spotify_fetch tracks=${playlistTracks.length} ms=${benchMs(benchSpotifyStart).toFixed(1)}`,
    );
  }
  progress({ stage: "spotify", msElapsed: 0 });

  let enrichedTracks: EnrichedPlaylistCandidate[] = [];
  let sampledTracks: EnrichedPlaylistCandidate[] = [];
  let recentLog: readonly string[] = [];
  let recentLogSource: SongSelectionSource = "memory";
  const benchEnrichStart = BENCH ? benchStart() : BigInt(0);
  if (playlistTracks.length > 0) {
    enrichedTracks = await enrichPlaylistTracks(playlistTracks);
    if (language === "en") {
      enrichedTracks = enrichedTracks.filter((track) => !isThaiTrack(track));
      if (enrichedTracks.length === 0) {
        throw new HttpError(503, {
          error: "No non-Thai songs are available for English mode.",
        });
      }
    }
    // Sample with a bias toward under-served tracks using the most-recent
    // selection log, so the picker sees fresh material every call. We
    // capture the log source here and pass it down to the picker phase
    // so it doesn't re-read the same store entry on the next Redis/memory
    // hit — a previous version paid for two reads per request.
    const recentRead = await getRecentSelections();
    recentLog = recentRead.trackIds;
    recentLogSource = recentRead.source;
    sampledTracks = sampleCatalogForRequest(
      enrichedTracks,
      CATALOG_SAMPLE_SIZE,
      recentLog,
    );
  }
  if (BENCH) {
    console.log(
      `[bench-analyze] phase=enrich+sample enriched=${enrichedTracks.length} sampled=${sampledTracks.length} ms=${benchMs(benchEnrichStart).toFixed(1)}`,
    );
  }
  progress({
    stage: "enrich",
    msElapsed: 0,
    sampledCount: sampledTracks.length,
  });

  // A random era/origin hint is useful only for the legacy global-search
  // fallback when no playlist is configured. When the owner playlist is
  // available, the selected track is always from the sampled catalog.
  const songFlavorHint = sampledTracks.length === 0 ? pickSongFlavorHint() : undefined;
  const systemPrompt = buildRevealSystemPrompt(
    language,
    songFlavorHint,
    creatureKindHint,
    sampledTracks.length > 0 ? sampledTracks : undefined,
  );

  // The model occasionally drifts on a single enum field (e.g. picks a
  // synonym not in the allowed set). Retry once before failing. Only 2
  // attempts (down from 3 reveal + 2 song attempts across two separate
  // calls) since the merged call is the whole latency budget now.
  let validation: ReturnType<typeof universeRevealSchema.safeParse> | null = null;
  let rawSongCandidates: ScoredSongCandidate[] = [];
  let llmAttempts = 0;
  // The vibe distribution guardrail inspects the first successful attempt
  // and, when the chosen vibe is over-represented in recent reveals,
  // discards it and re-prompts with a rebalance nudge appended to the
  // user message. A null guardrailTriggered means the second attempt was
  // skipped (or this is the first attempt); a string is the dominant vibe
  // name when the nudge was injected. We log this once at the end so the
  // intervention is visible in production logs.
  let guardrailTriggered: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const benchLlmStart = BENCH ? benchStart() : BigInt(0);
    let userPromptForAttempt = transcript;
    if (attempt === 1 && guardrailTriggered) {
      // Append a soft counter-nudge explaining the recent skew. The model
      // is free to ignore it if the evidence clearly supports the same
      // vibe; the nudge just asks it to re-examine the full signal range.
      userPromptForAttempt = `${transcript}\n\nNOTE: recent results have been heavily skewed toward '${guardrailTriggered}'. If the user's answers genuinely support a different vibe, choose it. Do not force a different vibe if the evidence clearly supports '${guardrailTriggered}', but be extra careful to read the full range of signals.`;
    }
    try {
      const parsed = await callLlm({
        systemPrompt,
        userPrompt: userPromptForAttempt,
        temperature: 0.4,
        // Single-language reading + celestial config + (optionally) a
        // song shortlist — comfortably smaller than the old bilingual
        // 4096-token ceiling.
        maxTokens: 2800,
        nonce: `${requestNonce}:${attempt}`,
        purpose: "analyze",
        timeoutMs: 25_000,
      });
      llmAttempts = attempt + 1;

      // Strict parse gates retry/acceptance; song_candidates is parsed
      // SEPARATELY and leniently so a malformed shortlist doesn't force a
      // full-response retry — it just falls through to the catalog
      // fallback pick below.
      const revealParse = universeRevealSchema.safeParse(parsed);
      validation = revealParse;
      if (revealParse.success) {
        const rawObj = parsed as Record<string, unknown>;
        const candidatesParse = songCandidatesSchema.safeParse(rawObj.song_candidates);
        rawSongCandidates = candidatesParse.success ? candidatesParse.data : [];

        // Vibe distribution guardrail — only on the first successful
        // attempt. We check whether the LLM's chosen vibe accounts for
        // more than VIBE_SKEW_THRESHOLD of recent reveals (and there are
        // enough samples to be statistically meaningful). If so, discard
        // this attempt and retry with a rebalance nudge. The retry loop's
        // `break` only fires after the second attempt completes, so the
        // LLM gets its second chance.
        if (attempt === 0) {
          try {
            const { stats } = await getVibeStats();
            const total = stats.total;
            if (total >= MIN_STATS_FOR_GUARDRAIL) {
              const chosenVibe = revealParse.data.vibe as Vibe;
              const vibeCount = (stats as Record<string, number>)[chosenVibe] ?? 0;
              const share = total > 0 ? vibeCount / total : 0;
              if (share > VIBE_SKEW_THRESHOLD) {
                guardrailTriggered = chosenVibe;
                // Discard this attempt — force the retry to run with the
                // nudge by NOT breaking out of the loop.
                validation = null;
                rawSongCandidates = [];
                console.log(
                  `[analyze] distribution guardrail triggered: vibe=${chosenVibe} share=${(share * 100).toFixed(1)}% (${vibeCount}/${total}) — retrying with rebalance nudge`,
                );
                if (BENCH) {
                  console.log(
                    `[bench-analyze] phase=guardrail vibe=${chosenVibe} share=${(share * 100).toFixed(1)} ms=${benchMs(benchLlmStart).toFixed(1)}`,
                  );
                }
                // Fall through to next attempt (no `break`).
              } else {
                guardrailTriggered = null;
              }
            }
          } catch (statsErr) {
            // If the stats read fails for any reason, don't block the
            // happy path — accept this attempt as-is.
            console.warn("[analyze] vibe stats read failed, skipping guardrail:", statsErr);
            guardrailTriggered = null;
          }
        }
      }
      if (BENCH) {
        console.log(
          `[bench-analyze] phase=llm attempt=${attempt + 1} success=${revealParse.success ? "1" : "0"} ms=${benchMs(benchLlmStart).toFixed(1)}`,
        );
      }
      progress({
        stage: "llm",
        msElapsed: 0,
        attempt: attempt + 1,
      });
    } catch (err) {
      if (BENCH) {
        console.log(
          `[bench-analyze] phase=llm attempt=${attempt + 1} success=0 threw ms=${benchMs(benchLlmStart).toFixed(1)}`,
        );
      }
      console.warn(`[analyze] LLM attempt ${attempt + 1} failed`, err);
    }
    if (validation?.success) break;
  }

  if (!validation || !validation.success) {
    throw new HttpError(502, {
      error: "LLM output failed schema validation.",
      issues: validation?.error.issues,
    });
  }

  let result: UniverseRevealParsed = validation.data;
  console.log(
    `[analyze] reveal mapped: language=${language} celestial_type=${result.celestial_type} vibe=${result.vibe} attempt=${llmAttempts}`,
  );

  if (sampledTracks.length > 0) {
    let selectedTrack: EnrichedPlaylistCandidate | undefined;
    const benchPickerStart = BENCH ? benchStart() : BigInt(0);
    if (rawSongCandidates.length > 0) {
      const pick = await pickWeightedSongSelection(
        rawSongCandidates,
        sampledTracks,
        enrichedTracks.length,
        recentLog,
        recentLogSource,
      );
      selectedTrack = pick?.track;
    }
    if (!selectedTrack) {
      console.warn(
        "[analyze] no usable song candidates from the LLM; falling back to catalog pick",
      );
      selectedTrack = await pickCatalogFallback(enrichedTracks);
    }
    if (BENCH) {
      console.log(
        `[bench-analyze] phase=picker used=${selectedTrack ? "weighted" : "fallback"} ms=${benchMs(benchPickerStart).toFixed(1)}`,
      );
    }
    progress({ stage: "picker", msElapsed: 0 });
    result = mergeSelectedSong(result, selectedTrack, language);
  }

  if (BENCH) {
    console.log(
      `[bench-analyze] phase=total attempts=${llmAttempts} ms=${benchMs(benchRequestStart).toFixed(1)}`,
    );
  }
  progress({ stage: "done", msElapsed: 0 });
  // Telegram notification is intentionally NOT sent here. We only want to
  // be notified about reveals the user actually saw, so the /reveal page
  // POSTs to /api/telegram/notify after it has hydrated and rendered.
  return result;
}

