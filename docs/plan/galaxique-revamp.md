# Galaxique Revamp Plan

Status: **approved plan, not implemented**. Created 2026-10-02.
Can use threejs skills to help you.

## Decisions

| Topic | Decision |
|---|---|
| Song language | Thai-language users can receive **any** eligible song. English-language users never receive Thai songs; all other songs (including K-pop, J-pop, etc.) remain eligible. |
| Typhoon | Remove. It is a Thai-specialized LLM (SCB 10X) currently wired as an optional Thai quiz engine (`THAI_QUIZ_ENGINE=typhoon`, `TYPHOON_API_KEY`, [lib/typhoonQuiz.ts](../../lib/typhoonQuiz.ts)). It conflicts with the one-shared-model policy. |
| Telegram notifications | **Out of scope. Do not modify** [lib/telegram.ts](../../lib/telegram.ts), [app/api/telegram](../../app/api/telegram) or their payload. They are the owner's analytics. Keep `TELEGRAM_*` env vars. |
| Legacy constellation summaries | Shown only as decorative, non-selectable "legacy stars" with no text, song or reading exposed. They were never published with consent, so they are not visitable worlds. |
| Daily LLM spend cap | None. Per-visitor/IP abuse rate limits still apply. |
| Creature behavior | Creatures must act naturally with context-appropriate animation when a visitor lands (see §8). |

## Current-State Findings

- [scripts/generate-song-knowledge.mjs](../../scripts/generate-song-knowledge.mjs) stops after 300 playlist tracks (`while (tracks.length < 300)`).
- [lib/songSelectionStore.ts](../../lib/songSelectionStore.ts) keeps only the last 50 selections, which is too short for coverage or concentration metrics.
- [lib/songMatching.ts](../../lib/songMatching.ts) uses exact-term TF-IDF overlap with deterministic track-ID tie-breaks.
- [app/api/constellation/route.ts](../../app/api/constellation/route.ts):
  - accepts client-supplied `id` and fields;
  - has no rate limit;
  - publishes every reveal without consent;
  - stores no track ID.
- [lib/constellationStore.ts](../../lib/constellationStore.ts) caps the public list at 500 entries. It is a feed, not durable storage.
- [app/api/creature-chat](../../app/api/creature-chat) trusts the `reveal` object sent by the client, which allows spoofing and prompt injection.
- Model config is spread across many env vars: `OPENROUTER_MODEL`, `OPENROUTER_CHAT_MODEL`, `OPENROUTER_QUIZ_MODEL`, `OPENROUTER_THAI_QUIZ_*`, `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_PROVIDER_SORT`, `OPENROUTER_REQUIRE_ZDR`, `THAI_QUIZ_ENGINE`.
- Thai and English quiz timeouts differ: about 5.8 s for Thai vs 3.9 s for English with 8 questions.
- Creature GLBs in [three/objects/CreatureModel.tsx](../../three/objects/CreatureModel.tsx) each loop a single clip, which won't suit a grounded greeting:
  - fox: `Run`
  - dragon: `Dragon_Flying`
  - fish: none
- Spotify `preview_url` is often null for newer apps, so the Spotify embed is the main playback path.
- A baked Blender galaxy already exists ([art/galaxy/README.md](../../art/galaxy/README.md)) and can be reused.

## 0. Baseline And Guardrails
- Record current metrics before any change:
  - song repeat rate and catalog coverage;
  - quiz latency per language and LLM cost per task;
  - homepage FPS and payload on a mid-range phone.
- Capture visual baselines with `scripts/visual/`.
- Build a golden evaluation set: about 30 personality briefs per language, each with acceptable songs.
- Ship each phase behind flags in one checked-in config file. Validate on Vercel preview deployments before production.
- Security fixes in the first phase:
  - lock down the constellation POST (server-generated IDs, field validation, rate limit, no auto-publish);
  - make creature chat load world data on the server instead of trusting the client.

## 1. Sync The Latest Playlist
- Fetch the entire playlist by following `next` until it ends (no 300 cap). Back off on 429 responses.
- Match tracks by exact Spotify track ID, with ISRC as a backup key so relinked or replaced tracks aren't treated as new.
- Flag local files, episodes, unavailable tracks and duplicates.
- Preserve removed tracks that historical reveals reference, but exclude them from new selections unless explicitly retained.
- Save a dated catalog snapshot plus a sync report: added, removed, metadata changed, unavailable.
- Selection reads only the approved catalog snapshot, never the live playlist. Tracks without reviewed knowledge are ineligible.
- Research new tracks first, then audit existing knowledge. The old 226-entry catalog is not the source of truth.

## 2. Improve Song Knowledge
- Review order:
  1. new tracks;
  2. never-selected songs;
  3. under-reviewed Thai tracks.
- Store per track:
  - source references;
  - confidence;
  - review status (`draft` / `reviewed` / `native-reviewed`);
  - knowledge version.
- Validate the schema with zod. `known: true` alone is not evidence of accuracy.
- Keep these fields separate: lyrical themes, relationship stance, mood, musical energy, setting.
- For instrumentals, set `lyrics: none` and invent no lyrical themes.
- Musical energy is a reviewed field. Don't depend on Spotify audio features.
- **Language field:** replace or verify `is_thai` with an explicit `lyric_language` (primary vocal language).
  - "Thai song" means Thai is the primary lyric language.
  - Flag edge cases for the owner to decide, e.g. Thai artists singing mainly in English, or mixed-language tracks.
- Build a shared Thai/English concept vocabulary so assessment briefs and song descriptors use compatible terms.
- Write original summaries only, never copied lyrics. Leave uncertain facts unknown.
- Thai entries need native review before reaching `native-reviewed`.

## 3. Improve Song Selection
- Personality assessment stays independent of songs, popularity and selection history.
- **Language eligibility is a hard filter, applied first:**
  - `th` users: every eligible song.
  - `en` users: only songs whose `lyric_language` is not Thai.
- Replace exact-word overlap with concept-aware ranking based on the shared vocabulary. Consider offline embeddings only if the golden set shows simpler matching is inadequate.
- Pipeline:
  1. Language filter.
  2. Relevance-qualified shortlist.
  3. Personal cooldowns, artist diversity and recent global exposure.
  4. Seeded weighted random choice (seed from the reveal ID, so results are reproducible).
- Replace the 50-entry log with per-track exposure counters that decay over time. Log shortlists, split by language.
- Offline simulation harness:
  - Runs thousands of synthetic briefs per language.
  - Reports shortlist inclusion, selection coverage, repeat rate, concentration and relevance.
  - Includes a "never competitive" report with reasons.
- Don't force equal distribution across unsuitable songs.
- Confirm shared Redis history works across production instances. The in-memory fallback must never run in production.
- Watch for the English pool being small enough after the language filter to cause repeats; the simulation reports this per language.

## 4. Simplify Model Configuration
- Use one model for English and Thai, with shared provider and fallback rules. Language changes prompts and validation only.
- Keep all model, provider order, fallback, reasoning effort and timeout settings in one checked-in file (e.g. `config/models.ts`). Task overrides only where justified and documented.
- Remove the Typhoon engine: delete [lib/typhoonQuiz.ts](../../lib/typhoonQuiz.ts) usage and the `THAI_QUIZ_ENGINE` branching in [lib/quiz.ts](../../lib/quiz.ts).
- Keep these env vars (secrets and infrastructure):
  - `OPENROUTER_API_KEY`
  - `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or the Upstash equivalents actually in use)
  - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `SPOTIFY_REDIRECT_URI`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_REQUEST_TIMEOUT_MS` (untouched)
  - `BRAVE_SEARCH_API_KEY` (local scripts only)
- Remove (after code no longer reads them):
  - `OPENROUTER_MODEL`, `OPENROUTER_CHAT_MODEL`, `OPENROUTER_QUIZ_MODEL`
  - `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_PROVIDER_SORT`, `OPENROUTER_REQUIRE_ZDR`
  - `OPENROUTER_THAI_QUIZ_MODEL`, `OPENROUTER_THAI_QUIZ_PROVIDER_ORDER`, `OPENROUTER_THAI_QUIZ_REASONING_EFFORT`, `OPENROUTER_THAI_QUIZ_FALLBACK_MODEL`, `OPENROUTER_THAI_QUIZ_FALLBACK_PROVIDER_ORDER`
  - `THAI_QUIZ_ENGINE`, `TYPHOON_API_KEY`
  - `SPOTIFY_PLAYLIST_ID` (moves to config if it's not secret)
- Removal sequence:
  1. Run `vercel env ls` for production, preview and development, and save the inventory.
  2. Deploy code that no longer reads the variables.
  3. Verify in preview, then production.
  4. Get owner confirmation.
  5. Run `vercel env rm` per environment.
- Run `evaluate:quiz` on both languages with the shared model before rollout. It must meet the Thai latency budget and keep Thai quality.
- No silent model changes during cleanup.

## 5. Spiral Galaxy Homepage
- **Art direction:**
  - Full-screen galaxy, tilted about 25–30° and slightly off-center, leaving room for the CTA on portrait mobile.
  - Two clear logarithmic spiral arms, a warm cream-gold core, violet→blue arm transitions and dark dust lanes.
- **Rendering:** the baked Blender galaxy supplies the core and dust lanes. Instanced GPU stars (seeded, gentle twinkle, depth layers, slow rotation) go on top.
- **Thai weekday colors:** subtle nebula accents along the arms, never dominant.

  | Day | Color |
  |---|---|
  | Sun | red |
  | Mon | yellow |
  | Tue | pink |
  | Wed | green |
  | Thu | orange |
  | Fri | blue |
  | Sat | purple |

- **Stars vs planets:** decorative stars form the galaxy. Selectable planets are anonymous published worlds. Legacy summaries appear only as decorative, non-selectable stars.
- **Planet placement:**
  - Position is a deterministic hash of the world ID (arm, radius, offset), so it stays stable as new planets appear.
  - Planets are instanced, picked by raycast, and clustered when zoomed out.
- **Controls:**
  - Drag, pinch/wheel zoom and reset view.
  - Keyboard browsing (focus ring, live label).
  - Clear "Take the quiz" CTA.
  - "My planet" button, via the owner token saved on the device.
- The intro gathering animation lasts 2 s or less and can be skipped. No mandatory long wait.
- Refresh the OG/share image.

## 6. Save And Publish Visit-Ready Worlds
- **Snapshot:** versioned, server-generated, with a server-created ID. Contents:
  - scene seed and config;
  - planet appearance;
  - the owner's personal sky (colors, seed, morphology, original celestial object);
  - creature (kind, name, colors, personality traits);
  - reading;
  - language;
  - exact track ID and ISRC.
- **Consent:**
  - Explicit opt-in publishing with a preview and optional reading redaction.
  - Automated check for personal information in the reading before publishing.
  - Never expose answers or private chat history.
- **Ownership without accounts:**
  - On publish, the creator gets a random owner token; only its hash is stored.
  - The token is kept in localStorage, plus an optional "save my manage link".
  - The owner can unpublish or delete.
- **Abuse:** publishing limits by hashed IP. Reporting hides the world pending review.
- **Storage:**
  - `world:{id}` for world data;
  - a time-ordered discovery index, read in pages;
  - `owner:{tokenHash}`.
  - Don't use the 500-entry list as storage.
- Visits never overwrite the visitor's own reveal.
- Telegram notifications stay exactly as they are.

## 7. Land On A Planet
- **Flow:** select planet → preview → camera approach → atmospheric descent → surface arrival. Every stage can be skipped.
- **Links:** deep link `/w/{id}`. Browser Back returns to the galaxy at the same camera position.
- **Owner's sky:** the anonymous owner's personal galaxy appears overhead, using their saved colors, seed and morphology, at reduced detail. It is not a generic sky or the visitor's galaxy. Their original celestial object is preserved in that sky.
- **Server trust:** the server loads the world snapshot. The client sends only the world ID, never reveal content.
- Start with cinematic landing and limited camera exploration. Free walking and multiplayer are later extensions.

## 8. Meet The Creature: Natural Behavior And Animation
Goal: the creature feels alive, aware of the visitor and in character for its kind. No looping run cycles while standing still, no snapping between poses, no floating feet.

### 8.1 Animation audit and assets
- Inventory every clip in each GLB (bird, cat, dragon, fish, fox, jelly, spirit). Note what's missing for idle, greet, talk, react and rest.
- Fill the gaps:
  - Prefer authoring or retargeting clips in Blender (source files under `art/creatures/`).
  - Where a clip can't be authored, use procedural layers: breathing, head look-at, tail/fin sway, wing settle, jelly pulse, spirit bob.
- Minimum states for every kind:

  | State | Purpose |
  |---|---|
  | idle | calm loop, kind-specific |
  | notice | turns head toward the camera when the visitor arrives |
  | greet | wave/hop/bow/flutter equivalent |
  | talk | subtle motion while a reply streams |
  | listen | attentive tilt while the visitor types |
  | happy, shy, curious, sleepy | reactions |
  | rest | after long inactivity |

- Kind-appropriate staging:
  - fox and cat: sit or stand on the ground, no running in place;
  - bird and dragon: perch or land, with an occasional hover;
  - fish and jelly: swim or drift in an atmospheric current;
  - spirit: float with a soft bob.

### 8.2 Behavior system
- A small state machine drives the creature. All transitions crossfade (about 0.2–0.5 s) through the animation mixer; no hard cuts.
- Arrival sequence:
  1. The creature is mid-idle (or asleep, if the world has been quiet).
  2. It notices the descending camera.
  3. It turns its head, then its body.
  4. It greets in sync with the greeting text appearing.
- Secondary life:
  - irregular blinks (randomized interval, not a fixed timer);
  - eyes and head follow the pointer or camera within natural limits;
  - weight shifts, small idle variations chosen by seeded randomness so loops don't feel mechanical.
- Grounding: correct scale for the landing camera, feet and base touching the surface, a soft contact shadow, and no clipping into terrain.
- Chat-driven expression:
  - Every LLM reply returns `{ text, emotion }`, where emotion ∈ {neutral, happy, shy, curious, sleepy, excited}. The emotion picks the reaction clip and expression.
  - Talk motion runs while text streams; listen runs while the visitor types.
- Tap and gesture reactions:
  - tap → happy;
  - repeated taps → playful or a dizzy spin, with a cooldown;
  - long press → shy;
  - drag near the creature → curious follow.
  - Reactions are interruptible and never break the scene.
- Personality consistency: the creature's traits (from the snapshot) scale motion energy, e.g. a cozy world gets slow, soft motion and an intense world gets snappier motion.
- Reduced motion: lower-amplitude idles, no spins, a static greet pose. Pause when the tab is hidden.

### 8.3 Conversation
- Greeting:
  - AI-generated, based only on approved public world information, in the visitor's language.
  - Generated on arrival, never on hover.
  - A cached pool of about 3 variants per world and language, streamed in.
  - Graceful fallback greeting.
- Visitors can chat and ask about the world or the song.
- Sessions:
  - separate per planet and visitor, with server-created IDs;
  - key `chat:visit:{worldId}:{visitorId}`;
  - never reuse the owner's private history;
  - the creature never impersonates the real owner.
- Output guardrails: length cap, no URLs, reply in the visitor's language.
- Loading, error and cancellation states.
- Per-visitor/IP rate limits; no daily spend cap.
- Accessibility: keyboard- and screen-reader-accessible chat. Creature reactions are announced as short text cues.

## 9. Music And Original Space Soundtrack
- **Planet songs:**
  - Visitors explicitly play the planet's exact song through the Spotify embed, with a 30 s preview where available.
  - Offer "Open in Spotify" when it's unavailable.
  - Resolve availability at visit time.
- **Hand-offs:**
  - Starting a track stops the previous one.
  - Ambient music ducks while a song plays, detected through the Spotify iFrame API playback events.
- **Original score:**
  - Composed in MIDI.
  - Layers: spacious pad, warm low drone, sparse bells, restrained shimmer; no fixed tempo; an open key such as D Lydian.
  - Rendered with high-quality instruments.
- **Delivery:**
  - Seamless loops at about −18 LUFS, as Opus/AAC with an MP3 fallback.
  - Layers load lazily and crossfade through Web Audio gain nodes across galaxy exploration, approach and landing.
  - Handle iOS autoplay rules.
- Keep MIDI and DAW sources plus credits in `art/audio/`. MIDI is the composition source, not a guarantee of sound quality.
- Browser synthesis is an optional later accent. Production requires a listening review.

## 10. Redis Backfill, Quality And Delivery
- Redis access is configured. Before any migration:
  - verify the target database;
  - inventory records read-only;
  - make a protected backup (SCAN export to a gitignored local file, plus an Upstash backup if available);
  - produce a dry-run report.
- Keep the `galaxseea:` prefix and add a version namespace (e.g. `galaxseea:v2:`) for new data.
- Resolve historical title/artist pairs to exact IDs, preserving the original songs. Skip ambiguous matches.
- Don't invent missing scenes or expand publication consent. Legacy records stay legacy summaries.
- Writes must be resumable and idempotent, with locking, checkpoints and rollback. Production writes need separate authorization.
- **Performance:**
  - instanced particles and distance-based detail;
  - lazy-loaded worlds and creature GLBs;
  - adaptive resolution;
  - pause in hidden tabs;
  - reduced motion;
  - a static fallback when WebGL is unavailable.
- **Monitoring:** LLM latency and cost per task, greeting cache hit rate, publish and report counts.
- **Verification:**
  - mobile and desktop screenshots, canvas rendering, touch selection;
  - the overhead galaxy is visible after landing;
  - creature arrival sequence, crossfades, grounding and reactions for all 7 kinds;
  - AI chat isolation (cross-visitor and spoofing tests);
  - audio hand-offs;
  - browser Back and deep links;
  - Thai text rendering;
  - EN users never receive Thai songs.

## Delivery Order
1. Baseline, guardrails, and security fixes (constellation POST, chat server trust)
2. Latest playlist sync
3. Shared-model configuration, Typhoon removal and env cleanup (can run in parallel with step 2)
4. Knowledge audit (including `lyric_language`), then selection changes and evaluation
5. Publishable snapshots, consent, and backfill dry run
6. Galaxy homepage
7. Landing sequence
8. Creature animation audit/assets, behavior system and AI conversation
9. Adaptive soundtrack (composition can start early, in parallel)
10. Staged rollout: preview → production, per phase

## Success Criteria
- Fewer repeated songs without reduced golden-set relevance, per language.
- Broader use of the eligible catalog.
- English users never receive Thai songs; Thai users can receive any song.
- Spiral arms readable on mobile; the homepage is interactive within about 2 s on a mid-range phone.
- Owner skies are visibly distinct.
- Creatures react naturally: no run-in-place, smooth transitions, aware of the visitor, emotion matches the reply.
- Greeting starts within about 1.5 s (cached).
- Private conversations with no cross-session leakage; nothing is published without consent.
- One model configuration for both languages that meets the Thai latency and quality bar, with a minimal env list.
- Reliable mobile visits and music hand-offs.
- Telegram analytics unchanged.
