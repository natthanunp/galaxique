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
import { getRecentSelections, recordSelection } from "@/lib/songSelectionStore";
import { getSpotifyPlaylistTracks, spotifyConfigured } from "@/lib/spotify";
import { sendAnalyzeResultToTelegram } from "@/lib/telegram";
import { buildRevealSystemPrompt } from "@/prompts/revealSystemPrompt";
import type { EnrichedPlaylistCandidate, Language, QuizAnswer } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeBody {
  answers: QuizAnswer[];
  /** Runtime request data is untrusted even though current clients type this
   * as `Language`; a stale browser can rehydrate an older/corrupt value. */
  language?: unknown;
  /** Retained for client compatibility; no longer used server-side. Song
   *  variety is now driven by the shared rolling log in
   *  lib/songSelectionStore.ts (see pickWeightedSongSelection below), which
   *  works across users/instances instead of per-client history. */
  recentTrackIds?: string[];
}

const THAI_CHARACTER = /\p{Script=Thai}/u;

/**
 * Honor explicit valid selections. If an old browser bundle sends an invalid
 * or absent value, infer the contract language from the submitted visible
 * quiz text rather than guessing a default: Thai question/answer text means
 * Thai output, otherwise the legacy English path. This is only a bridge for
 * stale clients; current clients always send "en" or "th" explicitly.
 */
function resolveLanguage(value: unknown, answers: QuizAnswer[]): Language {
  if (value === "en" || value === "th") return value;
  const visibleText = answers
    .map((answer) => `${answer.questionText} ${answer.answer}`)
    .join(" ");
  return THAI_CHARACTER.test(visibleText) ? "th" : "en";
}

interface ScoredSongCandidate {
  catalog_code: string;
  themes: number;
  stance: number;
  mood: number;
  energy: number;
  setting: number;
}

/** Tracks sampled as scoring candidates per request, out of the full
 *  catalog. This is the FIRST variety layer: any single track is only even
 *  a *candidate* in roughly `CATALOG_SAMPLE_SIZE / catalogSize` of requests,
 *  independent of how the model scores it when present. */
const CATALOG_SAMPLE_SIZE = 18;

/** How many of the most-recently-picked tracks get a decaying recency
 *  penalty (prevents back-to-back repeats). */
const RECENCY_WINDOW = 12;

/** Softmax temperature for the final weighted pick. Lower = more strongly
 *  favors the top-scoring candidate; higher = flatter/more random. */
const SOFTMAX_TEMPERATURE = 6;

/** Fisher-Yates partial shuffle: returns up to `n` tracks sampled uniformly
 *  from the full catalog (or the whole catalog if it has ≤ n tracks). */
function sampleCatalogForRequest(
  tracks: EnrichedPlaylistCandidate[],
  n: number,
): EnrichedPlaylistCandidate[] {
  if (tracks.length <= n) return tracks;
  const pool = [...tracks];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Resolves the model's scored shortlist to catalog tracks, applies
 *  recency + rolling frequency-share penalties (backed by the shared log in
 *  lib/songSelectionStore.ts), and does a weighted-random draw across ALL
 *  resolved candidates via softmax — NOT a deterministic always-pick-max.
 *  This is the structural fix for a single "safe default" track dominating
 *  selection: even a clear score leader doesn't always win, and a track
 *  sitting at a high observed share gets an increasingly large penalty. */
async function pickWeightedSongSelection(
  candidates: ScoredSongCandidate[],
  sampledTracks: EnrichedPlaylistCandidate[],
  catalogSize: number,
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

  const { trackIds: recentLog, source } = await getRecentSelections();
  const fairShare = catalogSize > 0 ? 1 / catalogSize : 0;

  const adjusted = resolved.map(({ track, rawScore }) => {
    const recencyIndex = recentLog.indexOf(track.track_id);
    const recencyPenalty =
      recencyIndex === -1 || recencyIndex >= RECENCY_WINDOW
        ? 0
        : (RECENCY_WINDOW - recencyIndex) * 1.5;

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
    `[analyze] song selected: ${pick.track.name} — ${pick.track.artist} (raw score ${pick.rawScore}/55, log source=${source})`,
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
 *  removes an entire network round trip. */
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
  const language = resolveLanguage(body.language, body.answers);

  try {
    const transcript = body.answers
      .map((a) => `Q${a.questionId}: ${a.questionText}\nA: ${a.answer}`)
      .join("\n\n");

    // A fresh nonce per incoming request is critical: callLlm() dedupes
    // concurrent calls sharing the same key onto one in-flight promise.
    const requestNonce = randomUUID();
    const creatureKindHint = pickCreatureKindHint();

    let playlistTracks = [] as Awaited<ReturnType<typeof getSpotifyPlaylistTracks>>;
    if (spotifyConfigured()) {
      try {
        playlistTracks = await getSpotifyPlaylistTracks();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[analyze] Spotify playlist unavailable", err);
        return NextResponse.json(
          { error: "Could not load the configured Spotify playlist.", detail: message },
          { status: 503 },
        );
      }
    }

    let enrichedTracks: EnrichedPlaylistCandidate[] = [];
    let sampledTracks: EnrichedPlaylistCandidate[] = [];
    if (playlistTracks.length > 0) {
      enrichedTracks = await enrichPlaylistTracks(playlistTracks);
      sampledTracks = sampleCatalogForRequest(enrichedTracks, CATALOG_SAMPLE_SIZE);
    }

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
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const parsed = await callLlm({
          systemPrompt,
          userPrompt: transcript,
          temperature: 0.4,
          // Single-language reading + celestial config + (optionally) a
          // song shortlist — comfortably smaller than the old bilingual
          // 4096-token ceiling.
          maxTokens: 2800,
          nonce: `${requestNonce}:${attempt}`,
          purpose: "analyze",
          timeoutMs: 25_000,
        });

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
        }
      } catch (err) {
        console.warn(`[analyze] LLM attempt ${attempt + 1} failed`, err);
      }
      if (validation?.success) break;
    }

    if (!validation || !validation.success) {
      return NextResponse.json(
        {
          error: "LLM output failed schema validation.",
          issues: validation?.error.issues,
        },
        { status: 502 },
      );
    }

    let result: UniverseRevealParsed = validation.data;

    if (sampledTracks.length > 0) {
      let selectedTrack: EnrichedPlaylistCandidate | undefined;
      if (rawSongCandidates.length > 0) {
        const pick = await pickWeightedSongSelection(
          rawSongCandidates,
          sampledTracks,
          enrichedTracks.length,
        );
        selectedTrack = pick?.track;
      }
      if (!selectedTrack) {
        console.warn(
          "[analyze] no usable song candidates from the LLM; falling back to catalog pick",
        );
        selectedTrack = await pickCatalogFallback(enrichedTracks);
      }
      result = mergeSelectedSong(result, selectedTrack, language);
    }

    // Fire-and-forget: this call sometimes times out and previously blocked
    // the response regardless of its own outcome.
    void sendAnalyzeResultToTelegram({
      answers: body.answers,
      language,
      result,
    }).catch((err) => console.error("[analyze] Telegram notification failed", err));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[analyze]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to analyze answers.", detail: message },
      { status: 500 },
    );
  }
}

