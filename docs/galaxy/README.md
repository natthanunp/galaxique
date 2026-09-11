# Cinematic galaxy verification — 8 September 2026

## Shared 3D loading and questionnaire correction

`AnimatedUniverseBackground` now supplies the same real 3D scene to the homepage, questionnaire, constellation, and both reveal-loading fallbacks. The quiz mounts it outside `QuizStepper`, so question fetching, answering, analysis, and retry screens keep the same animated canvas. Reveal loading places it inside an isolated stacking context and unmounts it when the result renderer takes over. No page still imports `StarfieldBackground`; that legacy Canvas2D component is retained only as unused compatibility code.

`quiz-3d.json` verifies desktop and phone flows with deliberately delayed question/analysis fixture responses: one identical WebGL canvas keeps drawing throughout all three stages, the full quiz reaches reveal, and constellation renders in 3D. `reveal-loading-3d.json` covers a deliberately delayed reveal JavaScript chunk and removal of its background when ready. Production build, TypeScript, and targeted lint pass. The earlier Canvas2D-specific verification below is historical.

## Homepage 3D correction

Following the user's clarification, the homepage now uses a real WebGL perspective scene in `components/shared/HomepageUniverse.tsx`, replacing the mostly static baked Canvas2D composition. The galaxy rotates and precesses; a volumetric star field sits both in front of and behind it; pointer movement and an automatic camera orbit produce perspective parallax. Window-level passive pointer listeners preserve links and native touch scrolling. Reduced motion and hidden tabs pause continuous rendering. It uses seven draw calls, tiered DPR/particle/texture budgets and no postprocessing passes.

The original requirement to avoid an additional homepage WebGL canvas was superseded by that clarification. Quiz and constellation retain their Canvas2D backgrounds. `homepage-3d.json` records the latest three-run desktop/phone frame measurements and checks for motion, reduced motion, visibility, overflow and navigation. The older performance table and screenshots below describe the preceding overhaul; its homepage Canvas2D measurements are historical, not claims about the new 3D implementation.


Implemented locally; no deployment. The pre-existing `next.config.ts` allowedDevOrigins modification is preserved. No API handlers, reveal schemas, GLBs, skeletons, or animation clips were changed.

## Implementation

- Blender-authored diagonal galaxy background, separate deep-field sky, stellar emission and dust absorption textures. Responsive WebP backgrounds are approximately 53 KB desktop / 27 KB phone; 512² and 1024² emission, dust, and sky maps serve the quality tiers.
- Canvas2D homepage/quiz/constellation background uses a cached composition and 28/48/72 sparse stars, capped at 30 painted frames per second. No additional WebGL canvas. The existing homepage creature preview still has its original WebGL canvas.
- The active `Galaxy` uses a textured disk, warm core, and deterministic stellar points with vertical thickness. Texture loading has an origin-clean fallback; all assets remain local and participate in image/video capture.
- One-shot PNG capture snapshots the completed postprocessed frame without creating a temporary video stream, with the original stream path retained as a compatibility fallback.
- All three celestial types share the deep-field sky, directional key/rim lights, soft hemisphere fill, restrained bloom, and reduced full-screen tint. Separate 256² AO sidecars shade the seven original creature models, at 0.38 intensity and without an AO render pass.
- Adaptive tiers now change particles, DPR and texture resolution. Two samples below 48 FPS request a downgrade; twelve above 57 FPS request recovery; an eight-second cooldown avoids rapid oscillation. Exports retain fixed resolution and suspend adaptation. Hidden/reduced-motion scenes use demand rendering; the Canvas2D background and constellation animations stop continuous updates.
- Shared dark panels, buttons, type spacing, loading surfaces and reduced-motion CSS align the pages while retaining English/Thai copy and existing navigation.

## Matched performance runs

Three runs before editing and three after, on the same local Mac using headless installed Chrome, localhost Next.js development server, DPR 1, and 1440×900 / 390×844 viewports. Same fixture, colors, density, creature, API interception, seeded randomness, 2.2-second settling delay and 120-frame sample. No build or other browser verification ran concurrently with the final performance sample. API requests are fulfilled locally, including notifications/stat mutations; no real messages are sent.

FPS is the reciprocal of median animation-frame interval; p95 is calculated from those frame intervals. Draw calls count WebGL2 draw invocations per animation frame. Loading is Navigation Timing `loadEventEnd`, **not full 3D readiness or production LCP**. Photo timing includes the UI export and PNG creation. Video timing includes the existing 12-second recording and local MP4 encoding. Export measurements use the galaxy/fox fixture on both viewports.

| Metric | Desktop before → after | Phone viewport before → after |
|---|---:|---:|
| Homepage median FPS | 59.88 → 59.88 | 59.88 → 59.88 |
| Reveal median FPS, all types | 60.01 → 60.01 | 60.01 → 60.01 |
| Reveal p95 frame time, all types | 16.67 → 16.67 ms | 16.67 → 16.67 ms |
| Galaxy draw calls | 27 → 26 | 27 → 26 |
| Black-hole / neutron-star draw calls | 26 / 25 → 26 / 25 | 26 / 25 → 26 / 25 |
| PNG median duration | 1.412 → 1.310 s | 0.657 → 0.643 s |
| MP4 median duration | 15.267 → 14.538 s | 14.190 → 14.695 s (+3.6%) |

All sampled median FPS, p95 frame time, navigation-load and photo/video export metrics meet the requested ≤5% regression gate in this local harness. See `comparison.json` and the four raw run files for exact loading and photo figures. Development compilation/cache effects make the large loading-time improvements unsuitable as production speed claims.

## Validation

- Production build and TypeScript: pass.
- Targeted lint for the new background, texture, galaxy and quality code: pass. Full lint remains pre-existing-failing: baseline 92 errors / 6513 warnings; after implementation 74 errors / 6510 warnings. Most findings come from generated `.vercel`/FFmpeg output; remaining application errors also existed in the baseline. No new lint errors were introduced.
- `node scripts/visual/check-budgets.mjs`: passes device classification (including modern Android), tier budgets, downgrade cooldown and recovery.
- All AO manifest keys match original GLB material names. Original GLB files are unchanged.
- An eight-question fixture quiz reaches the reveal. A mobile photo export produces a nonempty 1080×1920 image; MP4 previews show the sky, galaxy, creature and reading.
- Mobile page scrolling works with `pointer-events: none` on the reveal canvas.
- The 36-scene visual matrix has no page errors or horizontal overflow. Desktop orbit views and creature-animation samples were inspected; no new AO seams were observed in sampled poses. Home, quiz, constellation, Thai controls, resized layouts, and export previews were inspected. Contact sheets: `desktop.jpg` and `phone.jpg`.
- Missing galaxy/AO textures preserve a usable reveal. The non-ImageBitmap compatibility path still produces a 1080×1920 photo.
- Instrumented WebGL drawing stops for reduced motion after the export dialog closes. Whole-page screenshot equality in `visual-checks.json` is false because it includes independently timed DOM/dev UI; the focused draw-call check in `resilience.json` passes.
- Canvas2D painting stops for reduced motion and simulated document visibility changes, and resumes afterward. Visibility simulation tests the event handler, not physical OS background throttling.

## Limits

One pre-existing homepage metadata request (`/icon?v=2`, configured in `app/layout.tsx`) returned 404 during review. It is unrelated to the new assets and was left unchanged. The independently updated `v1.8 Astra` version label observed during the session was also preserved.

These results establish local Chrome viewport parity, not physical iOS/Android GPU, Safari/Firefox/Edge, thermal, battery, memory-pressure, slow-network or production-loading parity. Full external Spotify/LLM/Redis integrations are mocked; their behavior was not changed or retested against live services. Visual checks sample the 18 celestial-type/vibe combinations on each viewport, rotating through all seven creatures; they are not an exhaustive 126-combination creature matrix or every animation frame. Existing companion scale/orbit choices can let larger fox/jelly silhouettes cross the viewport edge; those baseline product choices were retained.

## Reproduce

An existing Playwright installation is required (no application dependency was added):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/visual/benchmark.mjs after
VIDEO=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/visual/benchmark.mjs after-video
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/visual/matrix.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/visual/resilience.mjs
node scripts/visual/contact-sheet.mjs
node scripts/visual/compare.mjs
node scripts/visual/check-budgets.mjs
```

Run the localhost server on port 3000. Keep performance runs sequential and idle other workloads. Raw screenshots/intermediate renders stay in ignored `artifacts/galaxy/`; the retained editable Blender source is `art/galaxy/cinematic-galaxy.blend`. Blender regeneration commands are in its adjacent README.
