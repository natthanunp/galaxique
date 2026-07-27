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
  /** Retained for client compatibility. Song selection is now based only on
   *  the current answers and curated catalog descriptors. */
  recentTrackIds?: string[];
}

interface ScoredSongCandidate {
  catalog_code: string;
  themes: number;
  stance: number;
  mood: number;
  energy: number;
  setting: number;
}

/** Resolve the scored shortlist to catalog tracks and deterministically select
 *  the strongest tag-grounded match. The model scores each axis against the
 *  current answers; the server owns the final comparison so a famous track
 *  cannot win merely because the model named it as its preferred option. */
function pickBestScoredCatalogTrack(
  candidates: ScoredSongCandidate[],
  tracks: EnrichedPlaylistCandidate[],
): { track: EnrichedPlaylistCandidate; score: number } | undefined {
  const bestByTrackId = new Map<
    string,
    { track: EnrichedPlaylistCandidate; score: number }
  >();

  for (const candidate of candidates) {
    const trackIndex = Number(candidate.catalog_code.slice(1)) - 1;
    const track = tracks[trackIndex];
    if (!track) continue;

    // Relationship stance is more diagnostic than a scenic setting: a user
    // describing care and closeness should not get a solitude song merely
    // because both also mention a landscape or quiet moment.
    const score =
      candidate.themes +
      candidate.stance * 1.5 +
      candidate.mood +
      candidate.energy +
      candidate.setting;
    const previous = bestByTrackId.get(track.track_id);
    if (!previous || score > previous.score) {
      bestByTrackId.set(track.track_id, { track, score });
    }
  }

  return [...bestByTrackId.values()].reduce<
    { track: EnrichedPlaylistCandidate; score: number } | undefined
  >((best, candidate) =>
    !best || candidate.score > best.score ? candidate : best,
  undefined);
}

/** Last-resort fallback when the LLM song-selection pass cannot produce a
 *  valid candidate. Picks a random track from the catalog that has a known
 *  descriptor so we never leave the curated playlist / songKnowledge set.
 *  This keeps every reveal's spotify_track_id strictly inside the catalog. */
function pickCatalogFallback(
  tracks: EnrichedPlaylistCandidate[],
): EnrichedPlaylistCandidate {
  const knownTracks = tracks.filter((t) => t.knowledge?.known);
  const pool = knownTracks.length > 0 ? knownTracks : tracks;
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
      // Two attempts, not three: the scored output is small, and a third slow
      // retry costs more latency than the catalog fallback below.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const selection = songSelectionSchema.safeParse(
            await callLlm({
              systemPrompt: buildSongSelectionSystemPrompt(enrichedTracks),
              userPrompt: transcript,
              // Low temperature: we want the model's single most defensible
              // pick, not a sampled one.
              temperature: 0.2,
              // Four tag-scored candidates plus a compact signal list.
              maxTokens: 550,
              nonce: `${requestNonce}:song:${attempt}`,
              purpose: "select-song",
              timeoutMs: 25_000,
            }),
          );
          if (!selection.success) {
            console.warn(
              "[analyze] song selection schema invalid",
              selection.error.issues,
            );
            continue;
          }
          const scoredPick = pickBestScoredCatalogTrack(
            selection.data.candidates,
            enrichedTracks,
          );
          if (!scoredPick) {
            console.warn(
              "[analyze] scored song candidates did not match catalog",
              selection.data.candidates.map(({ catalog_code }) => catalog_code),
            );
            continue;
          }
          selectedTrack = scoredPick.track;
          console.log(
            `[analyze] song selected: ${selectedTrack.name} — ${selectedTrack.artist} (tag score ${scoredPick.score}/55)`,
          );
          break;
        } catch (err) {
          console.warn(`[analyze] song selection attempt ${attempt + 1} failed`, err);
        }
      }
      if (!selectedTrack) {
        selectedTrack = pickCatalogFallback(enrichedTracks);
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
