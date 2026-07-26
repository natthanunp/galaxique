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
import type { Language, QuizAnswer } from "@/types/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeBody {
  answers: QuizAnswer[];
  language: Language;
}

/** How many points below the top fit_score a candidate can be and still be
 *  eligible for the weighted pick below. Keeps a genuine standout fit
 *  deterministic (nothing else qualifies), while letting real near-ties
 *  vary from request to request instead of always returning the same track. */
const SONG_SCORE_TIE_MARGIN = 12;

/** Weight-randomly pick one of the LLM's scored candidates, restricted to
 *  those within SONG_SCORE_TIE_MARGIN of the top fit_score. This is how we
 *  get repeat-visit variety without ever hard-excluding a track: the model
 *  itself decides which tracks are close enough in fit to be "in play", and
 *  we only randomize among those, weighted toward the higher scores. */
function pickWeightedCandidate<
  T extends { spotify_track_id: string; fit_score: number },
>(candidates: T[]): T {
  const topScore = Math.max(...candidates.map((c) => c.fit_score));
  const pool = candidates.filter((c) => c.fit_score >= topScore - SONG_SCORE_TIE_MARGIN);
  const totalWeight = pool.reduce((sum, c) => sum + Math.max(c.fit_score, 1), 0);
  let roll = Math.random() * totalWeight;
  for (const candidate of pool) {
    roll -= Math.max(candidate.fit_score, 1);
    if (roll <= 0) return candidate;
  }
  return pool[pool.length - 1];
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
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const selection = songSelectionSchema.safeParse(
            await callLlm({
              systemPrompt: buildSongSelectionSystemPrompt(enrichedTracks),
              userPrompt: transcript,
              temperature: 0.35,
              maxTokens: 900,
              nonce: `${requestNonce}:song:${attempt}`,
              purpose: "select-song",
            }),
          );
          if (!selection.success) continue;
          // Only candidates the LLM actually returned an ID for that exists
          // in the catalog are eligible — silently drop hallucinated IDs
          // rather than failing the whole attempt over one bad candidate.
          const validCandidates = selection.data.candidates.filter((c) =>
            enrichedTracks.some((track) => track.track_id === c.spotify_track_id),
          );
          if (validCandidates.length === 0) continue;
          const chosen = pickWeightedCandidate(validCandidates);
          selectedTrack = enrichedTracks.find(
            (track) => track.track_id === chosen.spotify_track_id,
          );
          if (selectedTrack) break;
        } catch (err) {
          console.warn(`[analyze] song selection attempt ${attempt + 1} failed`, err);
        }
      }
      if (!selectedTrack) {
        return NextResponse.json(
          { error: "LLM could not select a valid playlist track." },
          { status: 502 },
        );
      }
    }
    // A random era/origin hint is useful only for the legacy global-search
    // fallback. When the owner playlist is available, fit must win over variety.
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
        });
        const parsedReveal = universeRevealSchema.safeParse(parsed);
        validation = parsedReveal;
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
