# Plan: Galaxseea Feedback Round — Quiz Balance, Reveal Redesign, UI Polish, Thai Font

## TL;DR

Four user complaints mapped to four phases: (1) 38/46 cozy-galaxy skew — rebalance quiz+reveal prompts AND add a server-side vibe distribution guardrail that re-rolls when the LLM skews too hard; (2) reveal canvas — full-bleed immersive layout with a spinning DOM vinyl disc as the song-first focal point, creature perched near it, borderless reading overlay; (3) UI de-AI-ification — remove glassmorphism-overuse, gradient-text, neon glows, emoji icons, 3D card flips; (4) Thai font — add Noto Sans Thai via next/font (currently NO Thai font loaded at all).

---

## Phase 1: Thai Font + UI Quick Wins (parallel-safe, no dependencies)

### 1A. Add Noto Sans Thai font

- `app/layout.tsx` — import `Noto_Sans_Thai` from `next/font/google`, add `subsets: ["thai"]`, weights `["400","500","600","700"]`, variable `--font-thai`. Add the CSS variable to the `<html>` className.
- `app/globals.css` — update `@theme inline` to add `--font-thai: var(--font-noto-sans-thai)`. Update the body `font-family` stack to `var(--font-geist-sans), var(--font-thai), Arial, Helvetica, sans-serif` so Thai glyphs use Noto Sans Thai while Latin uses Geist. Consider `unicode-range` approach as alternative but the fallback-stack approach is simpler and sufficient.

### 1B. De-AI-ify UI components

- `components/ui/button.tsx` — remove the neon glow hover shadow (`hover:shadow-[0_0_24px_-4px_hsl(var(--primary)/0.6)]`); replace with a subtle elevation shadow (`hover:shadow-md`) or just a brightness shift.
- `components/ui/card.tsx` — reduce glassmorphism: change `bg-card/70 backdrop-blur-md` to `bg-card/80` (less transparency, drop blur on most cards). Keep blur only for floating overlay elements.
- `components/ui/progress.tsx` — simplify the gradient+glow bar: remove the inline `boxShadow` glow, keep the gradient fill but tone it down.
- `components/shared/VibeCounter.tsx` — replace emoji icons (`VIBE_EMOJI` map: 🌸🔥🌙⚡✨🖤) with Lucide icons or small colored dots. Remove the `motion.div` scale animation on each vibe entry (keep just opacity).
- `app/page.tsx` — replace the gradient-clip hero h1 (`bg-linear-to-br from-foreground via-foreground to-accent bg-clip-text text-transparent`) with solid `text-foreground`. Remove the `SparklesIcon` from the eyebrow badge. Remove the `uppercase tracking-widest` "Version 1.0" pill or make it subtler. Tone down the italic tribute text.
- `components/quiz/QuestionCard.tsx` — simplify the 3D card flip animation: change `initial={{ opacity: 0, x: 60, rotateY: 12 }}` to `initial={{ opacity: 0, x: 30 }}` (remove `rotateY`, reduce distance). Remove `style={{ perspective: 1000 }}`.
- `components/shared/LoadingCosmos.tsx` — simplify the orbiting constellation loader (reduce satellite glow shadows, simplify the animation).
- `components/reveal/PersonalityReading.tsx` — remove `SparklesIcon` from the vibe label; use a simple colored dot or nothing.
- `components/quiz/LanguageToggle.tsx` — reduce glassmorphism (`bg-card/60 backdrop-blur-md` → `bg-card/80`).

### 1C. Relabel "Other" option

- `components/quiz/QuestionCard.tsx` — change `otherLabel` from "Other"/"อื่นๆ" to "None of these — I'd say…"/"ไม่มีข้อไหนใช่ — ขอพิมพ์เอง" to make the escape hatch clearer and less prominent.

---

## Phase 2: Quiz Prompt Rebalance + Distribution Guardrail (depends on nothing, parallel with Phase 1)

### 2A. Rebalance quiz generation prompt

- `prompts/quizSystemPrompt.ts` — **remove the warm-majority mandate**. Replace "At least 6 of the {questionCount} questions should lean warm/connective/positive; at most 2 should lean introspective/private" with a balanced distribution instruction: "Span the full emotional range evenly: roughly 3-4 warm/connective, 3-4 reflective/neutral, 2-3 introspective/private or intense. Do not let any single emotional temperature dominate the batch." Keep the anti-black-hole-bait rule (every question needs at least one warm AND one neutral option) but remove the batch-level warm-majority audit at the end.
- `config/quizConfig.ts` — rebalance `QUESTION_ANGLES` pool from 22 warm / 13 reflective / 5 dark to roughly 14 warm / 12 reflective / 8 dark/intense. Add more dark/intense examples (ambition under pressure, conflict style, what intensity looks like, a fear or vulnerability, a time they felt most alone, what they're driven toward). This rebalances the few-shot examples the LLM sees.
- Keep the 5-dimension option-span instruction (warm/outward, private/inward, intense/driven, playful/light, skeptical/ironic — pick 4 of 5 per question) — this is good and already exists.

### 2B. Rewrite reveal prompt mapping rules

- `prompts/revealSystemPrompt.ts` — **remove the "default to GALAXY on mixed evidence" rule**. Replace with: "When evidence is genuinely mixed, choose the celestial type supported by the MOST SPECIFIC and REPEATED signals — do not default to any type. If two types have equal support, pick the one with the most vivid, specific evidence (not just the warmest)."
- **Remove or rewrite the black-hole audit** — the current "count warm answers, if ≥3 choose galaxy" rule is always triggered since the quiz generates warm-majority questions. Replace with: "Before finalizing, check that your chosen type has the strongest REPEATED pattern across answers, not just a plurality of warm mentions. Black hole is correct when inward/private/gravitational signals appear in at least 4 answers AND are the dominant emotional texture. Galaxy is correct when expansive/connective signals dominate. Neutron star when concentrated drive/resilience dominates."
- **Broaden the vibe rules** — make "cute" and "whimsical" easier to hit for warm profiles (relax the "whimsical ONLY for repeated imaginative play" restriction slightly), and make "cozy" narrower (only for explicit comfort/home/steadiness, not as a catch-all for all warmth). Add: "For warm profiles that show open affection or light confidence, prefer 'cute'. For warmth centered on comfort and home, use 'cozy'. Do not use 'cozy' as a default for all warm profiles."
- Keep the vibe→color palette section (it's good).
- Keep the creature kind hint and song scoring sections (unchanged).

### 2C. Add server-side vibe distribution guardrail

- `app/api/analyze/route.ts` — after the LLM returns a validated `UniverseRevealParsed`, check the recent vibe distribution using the existing `lib/vibeStatsStore.ts` `getVibeStats()`. If the returned `vibe` accounts for more than ~50% of the total (and total > 20 for statistical significance), AND the LLM's chosen vibe is the dominant one, inject a "rebalance nudge" into the retry: on the next attempt, add a user-prompt suffix like "NOTE: recent results have been heavily skewed toward '{vibe}'. If the user's answers genuinely support a different vibe, choose it. Do not force a different vibe if the evidence clearly supports '{vibe}', but be extra careful to read the full range of signals." This is a soft guardrail — it doesn't override genuine evidence, just counteracts LLM defaulting.
- Implementation: the existing retry loop (2 attempts) already exists. Add the distribution check after attempt 1 succeeds; if the skew condition is met, discard attempt 1 and run attempt 2 with the nudge suffix appended to the `userPrompt` (transcript). If attempt 2 also returns the same dominant vibe, accept it (the evidence genuinely supports it).
- `lib/vibeStatsStore.ts` — add a `getVibeStats()` export (it may already exist — check; the stats route uses it). If not, add it as a read-only counterpart to `incrementVibeStat`.
- Log the guardrail intervention for monitoring: `console.log('[analyze] distribution guardrail triggered: vibe=${vibe} share=${share}%')`.

### 2D. Track celestial_type in stats (optional enhancement)

- `lib/vibeStatsStore.ts` — add a separate Redis hash `galaxseea:celestial-stats` tracking galaxy/black_hole/neutron_star counts, mirroring the vibe stats pattern.
- `app/api/stats/increment/route.ts` — accept `celestial_type` in the POST body alongside `vibe`, increment both.
- `app/reveal/page.tsx` — include `reveal.celestial_type` in the stats increment POST body.
- This gives visibility into the galaxy skew specifically, not just vibe.

---

## Phase 3: Reveal Canvas Redesign — Immersive Full-Bleed + DOM Vinyl (depends on nothing, parallel with Phases 1-2)

### 3A. Restructure reveal page layout to full-bleed

- `app/reveal/page.tsx` — replace the current `grid lg:grid-cols-[1.4fr_1fr]` layout with a full-bleed immersive layout:
  - The R3F `<UniverseCanvas>` fills the entire viewport (`fixed inset-0` or `absolute inset-0`), no bordered card, no `overflow-hidden` clipping, no `ring-1 ring-inset`.
  - The `StarfieldBackground` DOM canvas is removed from the reveal page (the R3F `CosmicBackground` shader sphere IS the background now — no need for a separate 2D starfield). OR keep it but make the R3F canvas transparent and let the 2D starfield show through — but the cleaner approach is to let the R3F scene own the full background.
  - Overlay content (vinyl, song info, reading, badges, share button) sits in a DOM layer on top of the canvas using `pointer-events-none` on the container and `pointer-events-auto` on interactive elements.
  - Header (Home/Retake buttons) stays as a floating top bar with `pointer-events-auto`.

### 3B. Create the spinning vinyl disc component (DOM, not 3D)

- New file: `components/reveal/VinylDisc.tsx` — a CSS-animated spinning vinyl record that displays the album art:
  - Outer disc: dark circle with concentric groove rings (CSS `radial-gradient` or `repeating-conic-gradient`), ~200-280px diameter, centered on screen (or slightly above center).
  - Album art: the Spotify album art image in the center label area of the vinyl (~40% of disc diameter), `border-radius: 50%`, with a subtle glow ring in the vibe's primary color.
  - Spinning animation: CSS `@keyframes spin { from: rotate(0deg) to: rotate(360deg) }` at ~8-12s per revolution (slow, hypnotic). Pauses when the song is paused.
  - Song name + artist: floating text beside or below the disc, large and prominent — this is the first thing the user sees.
  - The disc receives `albumArtUrl`, `trackName`, `trackArtist`, `primaryColor`, `isPlaying` as props.
  - Uses the existing `mediaStore` for play/pause state (same shared `<audio>` element).
- The vinyl is positioned center-screen on mobile, and center-left or center on desktop (leaving room for the reading text on the right or below).

### 3C. Reposition creature to perch near the vinyl (preserving GLB bone animations)

- `three/objects/CreatureModel.tsx` — replace the camera-relative positioning logic (lines ~96-130, the `switch (spec.motion)` block that uses `camera.position + forward * 5.5 + right * oscillation`) with a scene-origin-relative perch position.
- **CRITICAL — GLB animations are independent of positioning**: each creature has bone-level animations played via `useAnimations` (bird: "Take 001", dragon: "DragonArmature|Dragon_Flying", fox: "Survey", jelly: "ArmatureAction.001", spirit: "Scene", cat: "Scene"; fish uses a custom `onBeforeCompile` swim shader). These animate the SKINNED MESH BONES via an `AnimationMixer`, NOT the group transform — so they continue to play correctly regardless of how we reposition the parent group. The `useEffect` that calls `action.reset().fadeIn(0.25).play()` stays unchanged.
- **Position the creature near the vinyl disc's 3D-projected location**: since the vinyl is a DOM element (not in the 3D scene), place the creature at a fixed scene-origin-relative position that visually sits near the disc — e.g., orbiting at radius ~2-3 units from the origin, at a slight offset (upper-right or beside the disc).
- **Motion types map to the GLB animation + group path**:
  - "fly" (bird/dragon) → GLB flying animation (wing flapping) plays while the group traces a gentle figure-8 or oval path around the origin at radius ~2.5. The bone animation provides the wing motion; the group path provides the travel.
  - "orbit" (fox/cat) → GLB idle/survey animation plays while the group orbits the origin at radius ~2.5. Fox's "Survey" (looking around) + slow orbit = natural companion behavior.
  - "bob" (jelly/spirit) → GLB floating/pulsing animation plays while the group bobs gently in a fixed perch position near the disc. Jelly's "ArmatureAction.001" (tentacle pulsing) + vertical bob = dreamy floating companion.
  - "swim" (fish) → custom swim shader (tail wiggle via `uSwimTime`) plays while the group traces a slow sinusoidal drift near the disc.
- **Facing direction**: use `group.lookAt(0, 0, 0)` to face the galaxy center (not the camera). Then apply the per-model `rotationY` offset AFTER `lookAt` via `group.rotateY(model.rotationY)` — this preserves each model's correct forward-facing orientation (e.g., bird needs `Math.PI` to face forward). This mirrors the current pattern where `rotateY` is applied after `quaternion.copy`.
- **Remove the manual rotation wobble**: the current `group.rotateY(model.rotationY + Math.sin(time * 0.8) * 0.12)` and `group.rotateZ(Math.sin(time * (1.2 + rotationSpeed)) * ...)` add manual wobble ON TOP of the GLB bone animations. With the bone animations providing organic motion, this manual wobble creates a "double-animated" look. Replace with just the static `rotationY` offset after `lookAt` — let the GLB animation handle the organic motion. Keep a very subtle `rotateZ` wobble (reduced amplitude ~0.02) only for models without active bone animations (fish).
- **Reduce the `pointLight` intensity** from 3 to ~1.2 and `distance` from 5 to 8 to avoid hot spots.
- **Increase `lerp` factor** from 0.07 to ~0.12 for less laggy movement.
- **Scale**: keep per-kind scales but consider a global multiplier so the creature reads as a companion, not a giant.
- **Jelly special case**: currently has `distance: 9.5` (far behind the galaxy). In the new layout, bring it closer (~3-4 units) so it perches near the vinyl like the others — its dreamy floating animation is a good companion for the song-first layout.

### 3D. Make the galaxy/nebula the immersive background

- `three/scene/CosmicBackground.tsx` — smooth the background:
  - Replace the hard `step(thresh, h)` star threshold with a smooth `smoothstep(thresh - 0.003, thresh + 0.003, h)` for anti-aliased star edges (no more popping).
  - Increase the star grid resolution from `dir * 240.0` to `dir * 320.0` for finer star distribution.
  - Raise the minimum `uNebulaSmoothness` across all vibes (floor at 0.4 instead of 0.2 for intense) to prevent harsh banding.
  - Slow the sphere rotation from `delta * 0.006` to `delta * 0.003` for gentler drift.
- `three/objects/RealisticGalaxy.tsx` — consider switching from `NormalBlending` to `AdditiveBlending` for the particle points so the galaxy glows and blends with the rest of the scene (currently it looks flatter than the additive-blended glow particles). Test visually — additive may wash out on bright backgrounds, so may need a compromise (lower opacity additive).
- `components/reveal/UniverseCanvas.tsx` — **activate the dead tint/tintOpacity postfx**: add a color grading pass using the `postfx.tint` and `postfx.tintOpacity` values that are currently computed but never rendered. Use a `<ToneMapping>` or a custom overlay. The simplest approach: add a full-screen quad with the tint color at `tintOpacity` using additive blend, or use the `HueTint`/`LUT` effect from `@react-three/postprocessing` if available. This ties the whole scene's color to the vibe palette.
- Remove the `clearColor #05050a` or make it fully transparent (`alpha: true` is already set, but `setClearColor(#05050a, 1)` makes it opaque — change opacity to 0 so the DOM background shows through if needed, or keep it as the deep space base).

### 3E. Borderless reading overlay

- `components/reveal/PersonalityReading.tsx` — remove the bordered card (`border border-border/70 bg-card/70 backdrop-blur-md`). Replace with borderless text with a subtle gradient scrim behind it for legibility: a `bg-linear-to-t from-background/80 to-transparent` or a `text-shadow` approach. Position it below the vinyl disc.
- The reading text should feel like it's floating in space, not in a box.

### 3F. Redesign SpotifyPlayer into the vinyl-centric layout

- `components/reveal/SpotifyPlayer.tsx` — the current bordered card with Spotify-green gradient is replaced. The track resolution logic (fetch from `/api/spotify/search`, autoplay via `mediaStore`) stays the same, but the UI is extracted into the `VinylDisc` component. `SpotifyPlayer` becomes a thin wrapper that resolves the track and passes data to `VinylDisc`, or the resolution logic moves into the reveal page directly.
- Remove the Spotify-green gradient (`from-[#1DB954]/15`). The play/pause button can keep a subtle Spotify green accent but should fit the cosmic palette.
- The "Open in Spotify" link becomes a subtle text link below the disc, not a bordered footer.

### 3G. Update share/export overlay for new layout

- `three/hooks/useOverlayCanvas.ts` — update `drawFrame()` to composite the new layout (vinyl disc position, borderless reading text, no bordered cards) onto the 1080×1920 export canvas. The vinyl disc can be drawn as a CSS-rendered image (screenshot the DOM element) or re-drawn on canvas (circle + album art image + groove rings). The reading text position changes to match the new borderless layout.

### 3H. Badges and share button

- `app/reveal/page.tsx` — the celestial type / symbol / companion badges become subtle borderless text labels (no `rounded-full border border-border/70 bg-card/60 backdrop-blur-md` pills). Use small text with a dot separator, low opacity.
- `ShareButton` stays as a floating button but loses the heavy border/glass treatment.

---

## Verification

### Phase 1

1. `npx tsc --noEmit` — clean
2. `npm run build` — succeeds
3. Manual: load the app in Thai mode — confirm Thai text renders in Noto Sans Thai (check font in DevTools → Computed → font-family). Compare Latin vs Thai rendering — should look cohesive.
4. Manual: check landing page — no gradient text, no neon glow on button hover, no emoji in VibeCounter, no 3D card flip on quiz.
5. Manual: quiz "Other" button shows the new relabel.

### Phase 2

1. `npx tsc --noEmit` — clean
2. `npm run build` — succeeds
3. Test quiz generation: `curl -X POST localhost:3000/api/generate-quiz -H "Content-Type: application/json" -d '{"language":"en"}'` — confirm 10 questions with a balanced emotional range (not all warm).
4. Test analyze with cozy-leaning answers: `curl -X POST localhost:3000/api/analyze -H "Content-Type: application/json" -d '{"language":"en","answers":[...]}'` — confirm vibe distribution is more varied across 5+ test runs.
5. Test analyze with dark/introspective answers — confirm black_hole or neutron_star is achievable (was nearly impossible before).
6. Check server logs for `[analyze] distribution guardrail triggered` entries.
7. After ~20 test reveals, check `curl localhost:3000/api/stats` — vibe distribution should be more balanced (cozy should not be >50%).
8. Reset stats between test rounds: `node scripts/reset-vibe-stats.mjs`.

### Phase 3

1. `npx tsc --noEmit` — clean
2. `npm run build` — succeeds
3. Manual: navigate to `/reveal` (seed localStorage with a reveal object via `localStorage.setItem("galaxique-quiz", JSON.stringify({state:{language,questions:[],answers:[],reveal:{...},seenAngles:[]},version:0}))`).
4. Visual checks:
   - Canvas fills the full viewport (no bordered card).
   - Spinning vinyl disc is the central focal point with album art + song name.
   - Creature perches near the disc, orbits gently, faces the galaxy center.
   - Galaxy/nebula background is smooth (no star popping, no banding).
   - Color grading tint is visible (scene has a subtle vibe-colored wash).
   - Reading text floats borderless with a legibility scrim.
   - No rigid bordered frames anywhere on the reveal.
   - Badges are subtle text, not bordered pills.
5. Test share video export — confirm the new layout composites correctly.
6. Test on mobile viewport — full-bleed layout, vinyl centered, reading below.
7. Test orbit drag/zoom — galaxy stays smooth, creature stays near disc.
8. **Creature animation check**: take 2 screenshots ~3s apart for each creature kind — confirm GLB bone animations are playing (wing flaps for bird/dragon, survey look-around for fox, tentacle pulse for jelly, idle for cat/spirit, tail wiggle for fish). The group repositioning should NOT interfere with bone-level animation playback.

---

## Decisions

- **Quiz fix**: Prompts + distribution guardrail (user confirmed). Prompt-only fixes have proven unstable (first black-hole bias, now cozy-galaxy bias). The server-side guardrail adds a mechanical counterbalance.
- **Reveal design**: Immersive full-bleed + DOM vinyl (user confirmed). Galaxy becomes the full-bleed background, spinning vinyl disc (CSS animation, album art) is the central focal point, creature perches near it, reading is borderless overlay text.
- **Creature role**: Perch near the song (user confirmed). Creature sits near the vinyl/album art as a companion with subtle idle animation.
- **Thai font**: Noto Sans Thai (user confirmed). Most neutral/standard, widest coverage.
- **Other option**: Keep but relabel (user confirmed). "None of these — I'd say…" / "ไม่มีข้อไหนใช่ — ขอพิมพ์เอง".
- **Scope**: All in one plan, phased (user confirmed). Each phase independently shippable.

## Further Considerations

1. The distribution guardrail threshold (50% share, 20 total) should be tuned after observing real data. Start conservative and adjust. Option A: 50%/20 (recommended starting point). Option B: 45%/15 (more aggressive). Option C: 55%/30 (very conservative).
2. The vinyl disc CSS animation vs 3D object decision — DOM vinyl is simpler and more reliable (no texture loading, no 3D text rendering), but a 3D vinyl inside the R3F scene would be more immersive (lit by scene lights, parallax with camera orbit). Can upgrade to 3D later if the DOM version feels too flat.
3. Removing `StarfieldBackground` from the reveal page means the 2D starfield canvas ref (used by `useOverlayCanvas` for export compositing) is no longer available. The export overlay will need to composite from the R3F canvas only, or the `CosmicBackground` shader needs to be captured. Verify the export still works.
