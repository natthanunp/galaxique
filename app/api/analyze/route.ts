import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { pickCreatureKindHint, pickSongFlavorHint } from "@/config/quizConfig";
import { callLlm } from "@/lib/llm";
import { songSelectionSchema, universeRevealSchema } from "@/lib/schemas";
import { enrichPlaylistTracks } from "@/lib/songKnowledge";
import { getSpotifyPlaylistTracks, spotifyConfigured } from "@/lib/spotify";
import { sendAnalyzeResultToTelegram } from "@/lib/telegram";
import {
  buildRevealSystemPrompt,
  buildSongSelectionSystemPrompt,
} from "@/prompts/revealSystemPrompt";
import type { EnrichedPlaylistCandidate, Language, QuizAnswer } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeBody {
  answers: QuizAnswer[];
  language: Language;
  /** Spotify track IDs the user has already received in recent sessions.
   *  The server will avoid re-selecting these to increase song variety. */
  recentTrackIds?: string[];
}

/** How many points below the top fit_score a candidate can be and still be
 *  eligible for the weighted pick below. A smaller margin makes the best fit
 *  win more decisively and reduces the chance that a broadly-famous default
 *  (Holocene, Apocalypse) keeps sliding in on a loose tie. */
const SONG_SCORE_TIE_MARGIN = 8;

/** Score penalty applied to tracks the user has already received recently.
 *  Strong enough to knock a famous default out of the tie margin unless it
 *  is genuinely the standout fit. */
const RECENT_TRACK_PENALTY = 18;

/** Extra penalty for the single most recently used user track so immediate
 *  back-to-back repeats are rare unless that song is an overwhelming fit. */
const MOST_RECENT_TRACK_EXTRA_PENALTY = 14;

/** Soft global cooldown for tracks recently selected by anyone. */
const GLOBAL_RECENT_TRACK_PENALTY = 8;

/** Cap for short-term global over-pick penalty. */
const GLOBAL_FREQUENCY_PENALTY_CAP = 16;

/** Server-side LRU of recently selected track IDs across ALL users. This
 *  prevents the whole app from collapsing onto the same famous defaults
 *  (Holocene, Apocalypse) even when different browsers hit the endpoint. */
const GLOBAL_RECENT_TRACK_IDS: string[] = [];
const MAX_GLOBAL_RECENT_TRACK_IDS = 20;

/** Rolling global history preserving duplicates, used for frequency-aware
 *  diversity penalties across users. */
const GLOBAL_SELECTION_HISTORY: string[] = [];
const MAX_GLOBAL_SELECTION_HISTORY = 120;

/** Record a newly selected track in the global recent history. */
function recordGlobalRecentTrack(trackId: string): void {
  const next = Array.from(new Set([...GLOBAL_RECENT_TRACK_IDS, trackId])).slice(
    -MAX_GLOBAL_RECENT_TRACK_IDS,
  );
  GLOBAL_RECENT_TRACK_IDS.length = 0;
  GLOBAL_RECENT_TRACK_IDS.push(...next);

  GLOBAL_SELECTION_HISTORY.push(trackId);
  if (GLOBAL_SELECTION_HISTORY.length > MAX_GLOBAL_SELECTION_HISTORY) {
    GLOBAL_SELECTION_HISTORY.splice(
      0,
      GLOBAL_SELECTION_HISTORY.length - MAX_GLOBAL_SELECTION_HISTORY,
    );
  }
}

/** User-level recency penalty. Most recent songs are penalized the most. */
function getUserRecencyPenalty(
  trackId: string,
  userRecentTrackIds: readonly string[],
): number {
  const index = userRecentTrackIds.lastIndexOf(trackId);
  if (index < 0) return 0;

  const age = userRecentTrackIds.length - 1 - index;
  if (age === 0) return RECENT_TRACK_PENALTY + MOST_RECENT_TRACK_EXTRA_PENALTY;
  if (age <= 2) return RECENT_TRACK_PENALTY + 8;
  if (age <= 5) return RECENT_TRACK_PENALTY;
  return Math.max(8, RECENT_TRACK_PENALTY - 4);
}

/** Penalize tracks that dominate the recent global selection window.
 *  This is a soft diversity prior — no track is ever hard-excluded. */
function getGlobalFrequencyPenalty(trackId: string): number {
  if (GLOBAL_SELECTION_HISTORY.length === 0) return 0;

  let hits = 0;
  for (const id of GLOBAL_SELECTION_HISTORY) {
    if (id === trackId) hits += 1;
  }

  const ratio = hits / GLOBAL_SELECTION_HISTORY.length;
  return Math.min(
    GLOBAL_FREQUENCY_PENALTY_CAP,
    Math.round(ratio * GLOBAL_FREQUENCY_PENALTY_CAP * 3),
  );
}

/** Rescue a candidate whose ID didn't match the catalog but whose name/artist
 *  the LLM also provided. Protects against minor ID hallucinations without
 *  letting completely invented tracks through. */
function rescueByNameAndArtist(
  candidate: { name: string; artist: string },
  tracks: EnrichedPlaylistCandidate[],
): EnrichedPlaylistCandidate | undefined {
  const needle = `${candidate.name} ${candidate.artist}`.toLowerCase();
  return tracks.find((track) => {
    const haystack = `${track.name} ${track.artist}`.toLowerCase();
    return (
      haystack.includes(needle) ||
      needle.includes(track.name.toLowerCase()) ||
      needle.includes(track.artist.toLowerCase())
    );
  });
}

/** Weight-randomly pick one of the LLM's scored candidates, restricted to
 *  those within SONG_SCORE_TIE_MARGIN of the top fit_score. Applies a strong
 *  penalty to recently-selected tracks so repeat quizzes don't collapse back
 *  onto the same famous defaults (Holocene, Apocalypse, etc.). */
function pickWeightedCandidate<
  T extends { spotify_track_id: string; fit_score: number },
>(
  candidates: T[],
  userRecentTrackIds: readonly string[],
  globalRecentTrackIds: ReadonlySet<string>,
): T {
  if (candidates.length === 0) {
    throw new Error("pickWeightedCandidate called with empty candidates");
  }
  const adjusted = candidates.map((c) => {
    const userRecencyPenalty = getUserRecencyPenalty(
      c.spotify_track_id,
      userRecentTrackIds,
    );
    const globalRecentPenalty = globalRecentTrackIds.has(c.spotify_track_id)
      ? GLOBAL_RECENT_TRACK_PENALTY
      : 0;
    const globalFrequencyPenalty = getGlobalFrequencyPenalty(c.spotify_track_id);

    return {
      ...c,
      effectiveScore: Math.max(
        0,
        c.fit_score -
          userRecencyPenalty -
          globalRecentPenalty -
          globalFrequencyPenalty,
      ),
    };
  });
  const topScore = Math.max(...adjusted.map((c) => c.effectiveScore));
  const pool = adjusted.filter(
    (c) => c.effectiveScore >= topScore - SONG_SCORE_TIE_MARGIN,
  );
  // If every candidate was recent and penalized into oblivion, fall back to
  // the original highest scorer rather than erroring.
  if (pool.length === 0) {
    const best = adjusted.reduce((a, b) =>
      a.effectiveScore > b.effectiveScore ? a : b,
    );
    return best;
  }
  const totalWeight = pool.reduce(
    (sum, c) => sum + Math.max(c.effectiveScore, 1),
    0,
  );
  let roll = Math.random() * totalWeight;
  for (const candidate of pool) {
    roll -= Math.max(candidate.effectiveScore, 1);
    if (roll <= 0) return candidate;
  }
  return pool[pool.length - 1];
}

/** Last-resort fallback when the LLM song-selection pass cannot produce a
 *  valid candidate. Picks a random track from the catalog that has a known
 *  descriptor so we never leave the curated playlist / songKnowledge set.
 *  This keeps every reveal's spotify_track_id strictly inside the catalog. */
function pickCatalogFallback(
  tracks: EnrichedPlaylistCandidate[],
  recentTrackIds: ReadonlySet<string> = new Set(),
): EnrichedPlaylistCandidate {
  const knownTracks = tracks.filter((t) => t.knowledge?.known);
  const freshTracks = knownTracks.filter(
    (t) => !recentTrackIds.has(t.track_id),
  );
  // Prefer tracks the user hasn't heard recently; fall back to the full
  // known catalog only when necessary.
  const pool = freshTracks.length > 0 ? freshTracks : knownTracks.length > 0 ? knownTracks : tracks;
  if (pool.length === 0) {
    throw new Error("pickCatalogFallback called with empty track list");
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/** POST /api/analyze — LLM call #2: map answers → universe reveal JSON. */
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
  if (body.language !== "en" && body.language !== "th") {
    return NextResponse.json(
      { error: "language must be 'en' or 'th'." },
      { status: 400 },
    );
  }

  try {
    // Format the answers once for both the focused song pass and the universe
    // pass. The song selector deliberately receives no visual-universe prompt.
    const transcript = body.answers
      .map(
        (a) =>
          `Q${a.questionId}: ${a.questionText}\nA: ${a.answer}`,
      )
      .join("\n\n");

    // Keep user recency order (oldest -> newest) so weighting can penalize
    // immediate repeats more heavily than older repeats.
    const userRecentTrackIds = Array.isArray(body.recentTrackIds)
      ? body.recentTrackIds
      : [];
    const globalRecentTrackIds = new Set(GLOBAL_RECENT_TRACK_IDS);
    const mergedRecentTrackIds = new Set([
      ...userRecentTrackIds,
      ...GLOBAL_RECENT_TRACK_IDS,
    ]);

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
    let selectedTrack: (typeof playlistTracks)[number] | undefined;
    if (playlistTracks.length > 0) {
      const enrichedTracks = await enrichPlaylistTracks(playlistTracks);
      const recentTracksForPrompt = userRecentTrackIds
        .slice(-8)
        .map((id) => enrichedTracks.find((track) => track.track_id === id))
        .filter((track): track is EnrichedPlaylistCandidate => Boolean(track));
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const selection = songSelectionSchema.safeParse(
            await callLlm({
              systemPrompt: buildSongSelectionSystemPrompt(
                enrichedTracks,
                recentTracksForPrompt,
              ),
              userPrompt: transcript,
              temperature: 0.35,
              maxTokens: 900,
              nonce: `${requestNonce}:song:${attempt}`,
              purpose: "select-song",
              // Song selection is quick but can spike if the provider is slow;
              // give it more headroom than the default 20s.
              timeoutMs: 35_000,
            }),
          );
          if (!selection.success) {
            console.warn(
              "[analyze] song selection schema invalid",
              selection.error.issues,
            );
            continue;
          }
          // Resolve every candidate to an exact catalog ID on the server.
          // Models frequently mistype 22-character IDs, while title + artist
          // are much more reliable and still cannot escape the allowed list.
          const validCandidates = selection.data.candidates.flatMap((c) => {
            const track =
              enrichedTracks.find((item) => item.track_id === c.spotify_track_id) ??
              rescueByNameAndArtist(c, enrichedTracks);
            return track ? [{ ...c, spotify_track_id: track.track_id }] : [];
          });
          if (validCandidates.length === 0) {
            console.warn(
              "[analyze] song selection candidates did not match catalog",
              selection.data.candidates.map(({ spotify_track_id, name, artist }) => ({
                spotify_track_id,
                name,
                artist,
              })),
            );
            continue;
          }
          const chosen = pickWeightedCandidate(
            validCandidates,
            userRecentTrackIds,
            globalRecentTrackIds,
          );
          selectedTrack = enrichedTracks.find(
            (track) => track.track_id === chosen.spotify_track_id,
          );
          if (selectedTrack) break;
        } catch (err) {
          console.warn(`[analyze] song selection attempt ${attempt + 1} failed`, err);
        }
      }
      if (!selectedTrack) {
        selectedTrack = pickCatalogFallback(enrichedTracks, mergedRecentTrackIds);
        console.warn(
          `[analyze] playlist song selection failed after retries; strictly falling back to catalog track ${selectedTrack.track_id} (${selectedTrack.name} — ${selectedTrack.artist}).`,
        );
      }
    }
    // A random era/origin hint is useful only for the legacy global-search
    // fallback when no playlist is configured. When the owner playlist is
    // available, the selected track is always from the catalog.
    const songFlavorHint = selectedTrack ? undefined : pickSongFlavorHint();
    const systemPrompt = buildRevealSystemPrompt(
      songFlavorHint,
      creatureKindHint,
      selectedTrack,
    );

    // The model occasionally drifts on a single enum field (e.g. picks a
    // synonym not in the allowed set). Retry a couple of times before
    // failing the whole request.
    let validation: ReturnType<typeof universeRevealSchema.safeParse> | null =
      null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const parsed = await callLlm({
          systemPrompt,
          userPrompt: transcript,
          temperature: 0.4,
          // Give the full reveal object enough room even when the provider
          // adds formatting or uses extra output tokens.
          maxTokens: 4096,
          nonce: `${requestNonce}:${attempt}`,
          purpose: "analyze",
          // Reveal output is large (bilingual readings + full celestial config).
          timeoutMs: 45_000,
        });
        const parsedReveal = universeRevealSchema.safeParse(parsed);
        validation = parsedReveal;
        // When a catalog track was selected, the reveal MUST keep that exact
        // track ID. Reject any reveal that swaps in a different song.
        if (
          parsedReveal.success &&
          selectedTrack &&
          parsedReveal.data.spotify_track_id !== selectedTrack.track_id
        ) {
          console.warn(
            "[analyze] LLM did not retain the dedicated song selection",
          );
          validation = null;
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

    if (validation.data.spotify_track_id) {
      recordGlobalRecentTrack(validation.data.spotify_track_id);
    }

    try {
      await sendAnalyzeResultToTelegram({
        answers: body.answers,
        language: body.language,
        result: validation.data,
      });
    } catch (err) {
      console.error("[analyze] Telegram notification failed", err);
    }

    return NextResponse.json(validation.data);
  } catch (err) {
    console.error("[analyze]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to analyze answers.", detail: message },
      { status: 500 },
    );
  }
}
