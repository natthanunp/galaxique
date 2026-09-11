# Questionnaire and song matching

The current quiz and profile pipeline is the only runtime path. It requires no feature flag and generates a fresh eight-question quiz for every request.

## Behavior

- Eight server-assigned topics: connection, recharging, decision-making, curiosity, pressure, persistence, disagreement, and personal priorities. Each request starts one generated batch, then repairs only invalid or missing questions within the same 40-second budget. A rate-limited upstream is excluded from later attempts.
- Thai visible text has script, option-distinctness, and grapheme-length checks. Options shuffle once before delivery. Semantic topic coverage and equally appealing options still need human review because schema checks cannot prove them.
- A separate model call returns answer-specific evidence with scores 1–2. Evidence must quote the supplied answer. Server code ranks themes and celestial types independently by total support, explicit support, then a stable transcript hash. Population data and song metadata never enter assessment. All-zero dimensions fail instead of producing a default profile.
- The six themes are Affectionate / ใส่ใจผู้อื่น, Grounded / มั่นคง, Reflective / ช่างคิด, Driven / มุ่งมั่น, Imaginative / มีจินตนาการ, and Questioning / ช่างตั้งคำถาม. Existing `vibe` values remain rendering palette keys.
- Song retrieval uses answer-derived English tags across themes, stance, mood, energy, and setting. The selected profile and actual catalog song are fixed before the creative reveal call.
- The configured playlist must contain at least one described eligible track. Unavailable Spotify data or missing descriptions return a retryable error; the system does not invent a verified song.

## Data compatibility

New reveals and constellation entries include `profile_version: 2`, `theme`, and a UUID `reveal_id`. `profile_version` is persisted schema metadata for recognizing existing records; it does not select a code path. Older saved records remain readable with their original labels.

Current counters retain the existing `galaxseea:profile-v2` Redis namespace so production statistics are not discarded during this code cleanup. A Redis script atomically deduplicates the reveal UUID and increments total, theme, theme × celestial, and daily language × theme × celestial counts. Only aggregate statistics and UUIDs are stored here, never quiz answers.

`GET /api/stats` now returns only current profile statistics in the rendering-key shape used by the homepage. Increment requests require the UUID, theme, rendering key, celestial type, and language.

## Verification

Run `npm run test:profile`, `npx tsc --noEmit`, and `npm run build`. Tests mock external calls and cover independent theme/celestial fixtures, mixed evidence, Thai answers, question validation and repair, song selection, JSON and SSE routes, stream cancellation, and deduplicated counters.

Live model checks should review natural Thai, neutral and distinct options, full validation pass rate, end-to-end latency including repairs, and cost per completed quiz. `lib/llmError.ts` strips provider errors to safe metadata; never log the original SDK error because it may include authorization or response-cookie data.
