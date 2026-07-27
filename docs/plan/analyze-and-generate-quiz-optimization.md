# Plan: Rewrite `/api/analyze` + `/api/generate-quiz` for <10s latency, song variety, single-language output

Status: **ready to implement**. This consolidates a full planning session (root-cause investigation
+ live OpenRouter model/provider research) into one actionable spec for a fresh implementation
session. Nothing in this plan has been implemented yet — see "Current repo state" below for the
one partially-applied diff already sitting uncommitted in the working tree.

## Goals (from the user)
1. Cut `/api/analyze` and `/api/generate-quiz` latency from the reported 15-30s down to ~5-10s.
2. Fix song selection reliably picking "Holocene" by Bon Iver (measured ~7/10 times) and other
   generic-fit tracks (e.g. "Loving Is Easy") — via a structural/statistical fix, not more prompt
   patching (multiple prompt-only fixes have already been tried and recurred).
3. Move language switching to the landing page only; generate single-language content (not
   bilingual EN+TH) to cut LLM output tokens roughly in half.
4. Extend the quiz from 5 → 10 questions for richer signal (accepted UX tradeoff: quiz takes longer).
5. Try `mistralai/mistral-small-3.2-24b-instruct` as the primary model for this rewrite (see
   "Model choice" below for why, and the fallback plan if it underperforms).

## Current repo state (verified, not assumed)
- **`app/api/analyze/route.ts` has a real TypeScript compile error** at the call to
  `buildRevealSystemPrompt(...)`: it passes `selectedTrack` (an object) where the function now
  expects `songPending?: boolean`. Confirmed via `get_errors`. **The app does not currently build.**
- This is because **a previous, incomplete refactor is sitting uncommitted in the working tree**
  (`git status --short` shows `M lib/llm.ts` and `M prompts/revealSystemPrompt.ts`,
  `git diff` inspected). That partial diff already:
  - Updated `prompts/revealSystemPrompt.ts`'s `buildRevealSystemPrompt` to take
    `(songFlavorHint?, creatureKindHint?, songPending?: boolean)` instead of `(..., selectedTrack?)`,
    with a `"[SELECTED SONG]"` placeholder-token branch when `songPending` is true. **This part is
    good and should be kept/built upon, not redone.**
  - Updated `lib/llm.ts`'s `DEFAULT_PROVIDER_ORDER` to `["deepinfra", "deepseek", "novita"]` (an
    earlier, now-outdated tuning pass — see "Provider order" below for the current correct order).
  - Did **NOT** update `app/api/analyze/route.ts`'s call site to match — that's the compile error,
    and also why the route currently still runs the OLD two-sequential-LLM-call flow (confirmed via
    live dev server logs: `[llm] select-song completed in ...ms` followed by a separate
    `[llm] analyze completed in ...ms`, with total request times of 11-22s, and `Holocene` showing
    up repeatedly in `[analyze] song selected: ...` log lines).
- Recent commits (`git log`): `chore: update song knowledge` (x2 — `data/songKnowledge.json` was
  just regenerated via `node scripts/generate-song-knowledge.mjs --force`, unrelated to this plan),
  `Optimize quiz and song selection latency`, `Improve quiz variety and song selection`. None of
  these implement this plan — this plan's changes are still all pending.
- This project **is deployed on Vercel** (`.vercel/project.json` has a real `projectId`/`orgId`,
  `projectName: "galaxique"`) — relevant for the song-variety state storage decision below.
- `OPENROUTER_PROVIDER_ORDER` account now has `baidu` and `alibaba` enabled (user action, done this
  session) in addition to the pre-existing `novita`/`deepinfra`/`deepseek`.

## Architecture changes

### A. Single-language generation (do first — simplifies everything downstream)
1. `types/universe.ts`: `QuizOption` → `{ text: string }` (drop `text_en`/`text_th`). `QuizQuestion`
   → drop `text_en`/`text_th`, add `text: string` (keep `id`, `angle`, `options`). `UniverseReveal`
   → drop `personality_reading_en`/`_th`, add single `personality_reading: string`.
2. `lib/schemas.ts`: mirror the same shape changes in `quizOptionSchema`, `quizQuestionSchema`,
   `universeRevealSchema`.
3. `prompts/quizSystemPrompt.ts`: `buildQuizSystemPrompt(exampleAngles, avoidAngles)` → add a
   `language: Language` param; instruct the model to write question `text` and all 4 `options` in
   ONLY that language (drop bilingual dual-authoring instructions and the bilingual JSON example).
   Add an explicit conciseness instruction for option wording (short, punchy, no filler).
4. `app/api/generate-quiz/route.ts`: accept a required `language` field in the request body schema,
   pass through to `buildQuizSystemPrompt`. Response shape unchanged (`{questions, pickedAngles}`),
   each question/option now has one `text` field instead of `text_en`/`text_th`.
5. `prompts/revealSystemPrompt.ts`: the merged prompt-builder (see section B) takes a `language:
   Language` param; `personality_reading` becomes ONE field, authored directly in that language.
   The already-uncommitted `songPending`/`"[SELECTED SONG]"` placeholder logic becomes
   single-language too (currently writes both `_en`/`_th` guidance — trim to one).
6. `lib/quizPrefetch.ts`: `requestQuiz`/`prefetchQuiz`/`takePrefetchedQuiz` gain a `language`
   parameter, folded into the prefetch cache key (a prefetched EN quiz must never be served for a
   TH session or vice versa).
7. Client updates (mechanical ternary removals):
   - `components/quiz/QuestionCard.tsx`: render `question.text` / `option.text` directly. Keep the
     `language` prop only for static UI strings (Next/Back/Other labels — cheap, no LLM cost).
   - `components/quiz/QuizStepper.tsx`: `text = currentQuestion.text`; stored-answer lookup via
     `options.findIndex(o => o.text === stored.answer)`; `canonicalAnswer =
     currentQuestion.options[i].text`.
   - `app/reveal/page.tsx`: pass `reveal.personality_reading` directly to `PersonalityReading`
     (drop the `language === "th" ? ... : ...` ternary at ~line 222).
     `components/reveal/PersonalityReading.tsx` needs NO change (already takes a single `reading`
     prop — only its caller changes).
   - `app/page.tsx`: `prefetchNextQuiz` passes `useQuizStore.getState().language` into
     `prefetchQuiz(...)`. Also fire `prefetchQuiz` from a `useEffect` on mount (not just
     hover/focus/touchstart) for a real head start (see Phase C).
   - Remove `<LanguageToggle />` (and its now-unused import) from `app/quiz/page.tsx` and
     `app/reveal/page.tsx`. Keep it ONLY on `app/page.tsx` (the landing page).
   - `lib/telegram.ts`: collapse the EN/TH personality-reading block into one block using
     `reveal.personality_reading`.
8. **Accepted, not fixed**: old bilingual `localStorage` state (`galaxique-quiz` key) from before
   this ships will render blank/broken lookups — same precedented non-issue as the earlier
   bilingual-reading migration ("redo the quiz to get a fresh object"). No migration code planned.

### B. `/api/analyze` — merge into ONE LLM call + structural song-variety engine
1. `lib/schemas.ts`: keep `dimensionScoreSchema` (themes/stance/mood/energy/setting 0-10 each +
   `why`) unchanged. Add `song_candidates: z.array(dimensionScoreSchema.extend({ catalog_code:
   z.string().regex(/^C\d{3}$/) })).optional()` onto `universeRevealSchema`. Remove the standalone
   `songSelectionSchema` (fold into the extension above) — confirmed via grep it's referenced ONLY
   from `app/api/analyze/route.ts`, safe to delete.
2. `prompts/revealSystemPrompt.ts`: delete `buildSongSelectionSystemPrompt` as a separate export;
   fold its catalog-scoring instructions (the scoring rubric + JSON shape for `song_candidates` +
   "use the full 0-10 range" note) into `buildRevealSystemPrompt` as an extra "=== SONG SCORING ==="
   section, included only when a catalog sample is provided. **Do NOT re-add the named
   "Holocene"/"Apocalypse" fame-guard paragraph** that existed in the pre-refactor version — the
   structural mechanism in step 3 replaces it (prompt-patching specific song names has already
   been tried multiple times historically and kept recurring; don't repeat that pattern). Catalog
   lines are rendered from a server-pre-sampled subset (next step), not the full track list.
3. `app/api/analyze/route.ts` — finish the restructure (build on the already-uncommitted prompt
   changes, don't redo them):
   - Fetch/cache `playlistTracks` + `enrichPlaylistTracks` (unchanged).
   - NEW `sampleCatalogForRequest(enrichedTracks, n = 18)`: Fisher-Yates partial shuffle, take
     first `n` (or all, if the catalog has ≤ n tracks — catalog is currently 101 tracks). This is
     the FIRST variety layer: any single track is only even a *candidate* in roughly `n/101 ≈ 18%`
     of requests, independent of how the model scores it when present.
   - ONE `callLlm(...)` call: merged system prompt (mapping rules + song-scoring section over the
     sampled subset + `songPending` placeholder guidance), single `language`, `temperature` ~0.4,
     `maxTokens` ~2800, `timeoutMs` ~25s, **2 attempts** (down from the old 3 reveal + 2 song
     attempts across two separate calls).
   - Parse leniently: the STRICT schema parse for the core reveal fields must succeed to accept the
     response / retry; SEPARATELY parse `song_candidates` — a malformed/missing song shortlist must
     NOT force a full-response retry, it just falls through to `pickCatalogFallback` for that
     attempt.
   - NEW `pickWeightedSongSelection(candidates, tracks)` replacing the old
     `pickBestScoredCatalogTrack` (always-pick-max — this is exactly why Holocene/Apocalypse/etc.
     kept dominating: no randomness, no memory of recent picks). Algorithm:
     a. Resolve each candidate's `catalog_code` → track (index-based, same as before).
     b. **Short-term recency penalty**: keep a rolling list of the last ~12 selected track IDs
        (see storage note below), apply a decaying penalty to the most-recently-picked few
        (prevents back-to-back repeats).
     c. **Rolling frequency-share correction** (the key lever for the empirical "7/10" problem):
        keep a rolling list of the last ~50 selections. For each candidate, compute
        `observedShare = countInLog(track) / log.length` vs `fairShare = 1/101`. Penalty scales
        with `max(0, observedShare - fairShare)` — a track sitting at 70% observed share gets a
        large, dominant penalty; a track at/below fair share gets ~0. This directly targets
        long-run overrepresentation, not just per-request scoring.
     d. `adjustedScore = max(1, rawScore - recencyPenalty - frequencyPenalty)` (raw score maxes at
        55: `themes + stance*1.5 + mood + energy + setting`).
     e. Convert to pick probabilities via **softmax(adjustedScore / T)** across ALL resolved
        candidates (not a hard tie-margin cutoff — a hard margin does nothing when one track wins
        by a wide margin every time, which is exactly the observed failure mode). Weighted-random
        draw from that distribution. Record the pick into the rolling log.
     f. Tune `T` (temperature) so a clear leader still wins often but not automatically — start
        around a value where a ~15-point score gap still leaves the runner-up a real (not
        negligible) chance, adjust based on Phase D's variety test results.
   - **Remove** the `spotify_track_id !== selectedTrack.track_id` mismatch-retry block from the old
     code entirely — no longer applicable since the server always deterministically overwrites
     `spotify_track_id` after picking (this was a real tail-latency bug: a full 4096-token reveal
     regeneration triggered by a song-ID mismatch).
   - `mergeSelectedSong(revealData, selectedTrack, language)`: substitute the literal
     `"[SELECTED SONG]"` token in `personality_reading` with `` `"${selectedTrack.name}" by
     ${selectedTrack.artist}` ``. When `language === "en"` AND `selectedTrack.knowledge?.known`,
     append a short deterministic clause built from the track's verified `mood`/`themes[0]` fields
     in `data/songKnowledge.json` (e.g. `` ` Its ${mood} pull echoes that same feeling.` ``) — Thai
     gets plain name/artist substitution only (mixing English descriptor words into a Thai sentence
     reads oddly; intentional asymmetry). Overwrite `spotify_track_id`/`spotify_search_query` with
     the resolved track's real id/name/artist.
   - Strip `song_candidates` from the final response object before `NextResponse.json(...)` (same
     "strip internal field" pattern `generate-quiz` already uses for `angle`).
   - Change `await sendAnalyzeResultToTelegram(...)` to fire-and-forget:
     `void sendAnalyzeResultToTelegram(...).catch((err) => console.error(...))` — confirmed in live
     logs this call sometimes times out (`[analyze] Telegram notification failed
     Error [TimeoutError]`) and currently blocks the response regardless.
4. **Non-English catalog songs remain equally pickable** — this falls out of the design for free:
   subsampling is uniform over the whole enriched catalog regardless of language, and scoring is
   purely tag-based (no title/artist/language signal reaches the model, since catalog identity is
   already obfuscated behind `C001`-style codes). No separate code path needed; verify via the
   Phase D variety test (log track name/origin across runs, not just repetition rate). An earlier
   idea to add an explicit `origin` field + stratified sampling was considered and DROPPED: the
   catalog is actually ~34% Thai/international (recounted directly from `data/songKnowledge.json`),
   so a uniform 18-track sample has only a ~0.06% chance of excluding all non-English tracks —
   already "all but guaranteed" without extra schema/script work.
5. **Song-selection state storage — use Upstash Redis, not plain in-memory arrays**: since this app
   is deployed on Vercel serverless, a plain in-memory module-level array for the recency/frequency
   logs would reset on every cold start and NOT be shared across concurrent instances — defeating
   the frequency-share correction exactly when it matters (production traffic, the reported "7/10"
   problem). Add:
   - **New dependency**: `@upstash/redis` (official REST-based client, no persistent TCP
     connection — ideal for serverless functions).
   - **New file**: `lib/songSelectionStore.ts` — wraps Redis `LPUSH`/`LTRIM`/`LRANGE` for the
     ~12-entry recency list and ~50-entry frequency log (can share one capped list and derive both
     penalties from it, or keep two — implementation detail). **Graceful fallback**: if Upstash env
     vars aren't present (e.g. local dev before provisioning), fall back to a plain in-memory
     module-level array so local dev keeps working with zero required setup.
   - `pickWeightedSongSelection` becomes `async` (Redis calls are awaited).
   - **User action required (cannot be automated)**: run `vercel install upstash` from the project
     root (or provision via Vercel dashboard → Storage → Marketplace → Upstash), select the free
     tier (~10K commands/day, 256MB — plenty for two tiny rolling lists), then `vercel env pull
     .env.local` so credentials are available locally too. Env var names vary by integration
     version (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/
     `UPSTASH_REDIS_REST_TOKEN`) — code should check for either.

### C. `/api/generate-quiz` tuning
1. `app/page.tsx`: fire `prefetchQuiz(seenAngles, language)` from a `useEffect` on landing-page
   mount, in addition to the existing hover/focus/touchstart triggers (mobile taps get little real
   head-start from touchstart alone).
2. `app/api/generate-quiz/route.ts`: reduce the schema-validation retry loop from 3 → 2 attempts.
3. `config/quizConfig.ts`: `questionCount: 5` → `questionCount: 10` (more per-user signal for the
   song-matching dimension scoring; explicitly accepted UX tradeoff that the quiz takes longer).
4. Token/latency math reconciliation: 10 single-language questions works out to roughly the SAME
   total text-field volume as the old 5-question BILINGUAL baseline (10 × 5 fields = 50, vs
   5 × 10 fields = 50) — so keep `maxTokens` around ~3200, don't lower it further just because of
   the single-language change. `timeoutMs` 40s → ~25s.
5. Minor, not essential: `EXAMPLE_ANGLE_COUNT` (currently 5) and `MAX_AVOID_ANGLES_IN_PROMPT`
   (currently 12) in `app/api/generate-quiz/route.ts` may be worth revisiting once 10 angles are
   picked per call instead of 5 — tune during/after implementation, not a blocking decision.
6. No change needed to `QuestionCard.tsx`/`QuizStepper.tsx` beyond section A.7 — they already loop
   over however many `questions` the API returns.

### D. Provider order + model choice (live-verified this session, not stale assumptions)
1. **Provider order** — update `lib/llm.ts`'s `DEFAULT_PROVIDER_ORDER` (currently
   `["deepinfra", "deepseek", "novita"]` per the uncommitted diff) to:
   ```
   ["baidu", "deepseek", "alibaba", "deepinfra", "novita"]
   ```
   Live-measured weekly-average stats for `deepseek/deepseek-v4-flash` (now that baidu/alibaba are
   enabled on this account): Baidu Qianfan 0.73s latency / 65-74 tok/s / 99.44% uptime; DeepSeek
   (official) 0.78s / 70-74 tok/s / 99.96%; Alibaba Cloud Int. 0.97s / 75 tok/s / 99.77%; DeepInfra
   (current #1) only 29 tok/s throughput despite 0.96s latency — 2-2.5x slower generation for the
   same output size. Structured-output error rate on the best routes (Morph/Cloudflare/CoreWeave)
   is already sub-1%. This reorder alone is expected to bring `/api/analyze`'s realistic completion
   size (~400-600 tokens after the merge + single-language changes) down to roughly `500/72 ≈ 7s`
   generation + ~0.7-1s TTFT ≈ **~7.5-8s total** — consistent with the <10s goal.
   `/api/generate-quiz` at 10 questions has a larger realistic completion (~800-1200 tokens) →
   `~14s` generation alone even with this reorder — an accepted, quantified consequence of the
   10-question decision, not a provider/prompt inefficiency; much less painful in practice since
   it's prefetched behind the landing page.
2. **Model choice — try `mistralai/mistral-small-3.2-24b-instruct` first** (per explicit user
   request this session). Live-verified stats: **$0.075/$0.20 per 1M tokens** (cheaper input,
   comparable output vs `deepseek-v4-flash`'s $0.09/$0.18); official Mistral provider: 0.30s
   latency, **94 tok/s** throughput (comparable to/better than deepseek's baidu/alibaba routes),
   99.99% uptime; Structured Output Error Rate sub-1% across all 3 providers (Venice 0.35%,
   DeepInfra 0.53%, Mistral official 0.98%) — comparable reliability to deepseek. This was the
   single most balanced alternative found across ~10 models researched live this session (Gemini
   2.5/3.1 Flash-Lite, Qwen3-30B-A3B/3.5-Flash/3.6-Flash, Groq-hosted Llama 3.3 70B, MiniMax M3,
   Mercury 2 all had a clear disqualifying tradeoff — too unreliable, too expensive, or too weak on
   reasoning benchmarks; see "Model research notes" below for the full comparison).
   - **Implementation**: set `OPENROUTER_MODEL=mistralai/mistral-small-3.2-24b-instruct` in
     `.env.local` and use it as the model for this implementation pass. `config/quizConfig.ts`
     already reads `process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash"` — no code change
     needed beyond the env var, `deepseek/deepseek-v4-flash` remains the coded-in fallback default.
   - **Known caveat, verify during Phase E**: no live GPQA/reasoning-benchmark score was available
     for this specific checkpoint — it's a mid-2025, 24B dense model, plausibly a little behind
     `deepseek-v4-flash`'s more recent architecture on nuanced nuance. Explicitly read through a
     handful of generated `personality_reading` values for quality/naturalness before committing to
     it long-term, not just timing. If quality disappoints, revert to
     `OPENROUTER_MODEL=deepseek/deepseek-v4-flash` (or unset — same default) with the provider
     reorder above still applied — that combination alone should already meet the latency goal.
   - **Secondary experiment, not required**: `inception/mercury-2` (a diffusion LLM, ~300+ tok/s,
     single-provider — no OpenRouter routing-lottery variance, but 3.10% structured-output error
     rate and weaker general reasoning per `GPQA Diamond` 77.0% vs deepseek's 87.8-87.9%) is worth
     trying specifically for `/api/generate-quiz` (mechanical MCQ generation, least sensitive to
     nuance) if Mistral Small doesn't fully close the gap there.

## Verification
1. `npx tsc --noEmit` and `npm run build` clean — confirms the current compile error is resolved.
2. Timing: curl loop (8-10x) against `/api/analyze` (with playlist configured) and
   `/api/generate-quiz`, both languages. Target consistently <10s for analyze; generate-quiz may
   land ~10-14s (see D.1) which is acceptable given it's prefetched.
3. Song variety: run analyze ~15-20x with varied AND deliberately-similar answers; log
   `selectedTrack.name`/`artist` each run (already logged via `console.log`). Confirm no single
   track (Holocene/Apocalypse included) appears more than ~2-3x in 15-20 runs, and non-English
   catalog tracks appear at a rate roughly proportional to their catalog share. Note: the
   frequency-share penalty is a long-run statistic — true convergence may take more like 50-100
   runs (the log window size); a 15-20-run test is a partial check, not a guarantee.
4. Correctness: `spotify_track_id` always resolves to a real catalog track id when a playlist is
   configured (never null/invented); no leftover literal `"[SELECTED SONG]"` in any
   `personality_reading`; single-language output actually matches the requested `language` in both
   endpoints (spot-check a `th` and an `en` run of each).
5. Concurrency: two concurrent `/api/analyze` requests with different answers still return distinct
   results (confirms the nonce-keyed dedup in `lib/llm.ts` still works after the restructure).
6. Manual UI smoke test: landing page toggle still works; `/quiz` and `/reveal` no longer show a
   language toggle; switching language on landing BEFORE starting a new quiz produces a fully
   single-language run end to end.
7. Confirm `@upstash/redis` calls actually hit the provisioned database (not just the in-memory
   fallback) — e.g. a log line showing `source: "upstash"` vs `source: "memory"` during the
   song-variety test. Re-run the variety test once against the deployed Vercel URL (not just
   `localhost:3000`), since only that catches a real cold-start/multi-instance bug.

## Deployment — sync env vars to Vercel BEFORE pushing/deploying
Local `.env.local` changes are NOT automatically reflected on Vercel — anything added or changed
there during this implementation must be mirrored to the Vercel project's env vars, or production
will silently keep the old value (e.g. still default to `deepseek/deepseek-v4-flash` provider order
or miss the Upstash credentials entirely) even though local testing looked correct. Do this as the
last step, after local verification passes and immediately before `git push`:
1. **`OPENROUTER_MODEL`** — set to `mistralai/mistral-small-3.2-24b-instruct` (see D.2) for
   Production (and Preview, so PR/preview deploys test the same model). Skip this if you decide
   during Phase D's quality check to stay on the coded-in `deepseek/deepseek-v4-flash` default —
   in that case just don't set the var at all (leaving it unset is equivalent to the fallback).
2. **`OPENROUTER_PROVIDER_ORDER`** — only needs setting on Vercel if you want to override the new
   `DEFAULT_PROVIDER_ORDER` baked into `lib/llm.ts` (see D.1); the reordered default is committed in
   code, so this env var is optional, not required.
3. **Upstash Redis credentials** (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, whichever names the Vercel Marketplace
   integration actually provisions) — if you provision Upstash through `vercel install upstash` or
   the dashboard's Storage tab, Vercel adds these to the Production/Preview env automatically; if
   you instead created the Upstash database directly on upstash.com, add the vars manually. Either
   way, explicitly confirm via `vercel env ls` that they're present before pushing — the in-memory
   fallback in `lib/songSelectionStore.ts` will mask a missing-credentials mistake by silently
   working, just without cross-instance memory, so this is easy to miss without checking.
4. Run `vercel env pull .env.local` afterward (or before, whichever is more convenient) so the local
   dev environment matches Production/Preview going forward, not just at the moment env vars were
   added.
5. Only then `git push` / let Vercel auto-deploy from `main`. If the project auto-deploys on push,
   pushing before step 1-3 are done means the first deploy runs with stale/missing env vars.

## Decisions / rejected alternatives (so a fresh session doesn't re-litigate these)
- Merge the two `/api/analyze` LLM calls into ONE call (not `Promise.all`-parallelized two calls).
  Parallelizing was the original plan but merging removes an entire network round trip for a
  bigger win, at the cost of a slightly larger single prompt/schema.
- Song selection uses weighted-random softmax + recency/frequency penalties, NOT a deterministic
  always-pick-max. This is an intentional, explicit tradeoff: the single "best" scoring track will
  not always win — that's the fix, not a bug.
- Removed prompt-based "fame guard" naming specific songs — this exact kind of patch was tried
  multiple times historically (per commit history / repo notes) and kept recurring. The structural
  mechanism replaces it; don't re-add named-song prompt text.
- Dropped the `origin`/language-stratified-sampling idea — uniform sampling is already sufficient
  given the catalog's real ~34% non-English composition (see B.4).
- Hedged/raced concurrent LLM requests (fire 2 requests, take whichever resolves first): explicitly
  OUT of scope — added complexity not wanted for this pass. Available future work if tail latency
  remains an issue after this plan ships.
- No migration for old bilingual `localStorage` state (see A.8) — consistent with existing project
  precedent for the earlier bilingual-reading schema change.

## Model research notes (for reference — full comparison from this planning session)
All figures below are live OpenRouter data pulled during this session, not training-data guesses.

| Model | Price in/out per 1M | Best reliable throughput | Structured-output error | Verdict |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` (current, reordered providers) | $0.09/$0.18 | 65-75 tok/s (baidu/deepseek/alibaba) | <1% | Solid baseline |
| `mistralai/mistral-small-3.2-24b-instruct` | $0.075/$0.20 | 94 tok/s (official Mistral) | <1% | **Chosen to try first** |
| `inception/mercury-2` | $0.25/$0.75 | 300+ tok/s (single provider) | 3.10% | Secondary experiment only (generate-quiz) |
| `google/gemini-2.5-flash-lite` | $0.10/$0.40 | 109-123 tok/s | **25.46%** on default route | Rejected — unreliable |
| `google/gemini-3.1-flash-lite` | $0.25/$1.50 | 85-116 tok/s | 0.48-2.73% | Rejected — pricier, no clear win |
| Groq-hosted `meta-llama/llama-3.3-70b-instruct` | $0.59/$0.79 | 217 tok/s (Groq only) | n/a | Rejected — 6.5x pricier, weak reasoning (GPQA 49.8%) |
| `qwen/qwen3-30b-a3b-instruct-2507` | $0.048/$0.193 | 44 tok/s (reliable routes) | n/a | Rejected — weak reasoning (GPQA 65.9%), fast route unreliable (41% uptime) |
| `qwen/qwen3.5-flash-02-23` | $0.065/$0.26 | 79 tok/s (single provider) | 4.95% | Rejected — unreliable, no fallback |
| `qwen/qwen3.6-flash` | $0.1875/$1.125 | 77 tok/s (single provider) | 1.06% | Rejected — pricier, bad tail latency (P99 42s) |
| `minimax/minimax-m3` | $0.24/$0.96 | not evaluated | not evaluated | Rejected — price alone disqualifies |
