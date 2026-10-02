# Galaxique — Your Unique Universe 🌌

An AI-driven, space-themed personality visualizer. Answer a short bilingual
(EN/TH) quiz, and the AI maps your inner vibe to a real-time 3D cosmic
universe — a spiral galaxy, a black hole, a neutron star — paired with a
matching Spotify song, a procedural creature companion, and a poetic
reading. Export a 12-second MP4 of your spinning universe to share on
Instagram Stories.

> _Made for the person who makes the night sky feel closer. She won't see
> this, but the light is hers._

## ✨ Features

- **AI-generated quiz** — Uses model from OpenRouter writes a fresh set of short, conversational questions per session,
  enforced via JSON-mode output.
- **Personality → universe mapping** — the core of the app. Cozy / loving
  vibes map to a warm spiral galaxy (optionally with a glowing heart at the
  core); deep / intense vibes map to a black hole or neutron star; vast /
  imaginative vibes map to a colorful multi-arm galaxy.
- **LLM-generated creature companion** — the AI also picks a small procedural
  creature (kind + accent + motion + name) that orbits the central cosmic
  object. The creature is rendered procedurally from primitives, so any
  (kind, accent, motion) tuple the model produces renders something cute and
  animated. Wings flap, tails wag, bodies breathe.
- **Animated 3D background** — a layered backdrop of distant and mid stars
  (counter-rotating for parallax), plus drifting, breathing nebula clouds
  tinted with the user's palette. No flat black void.
- **Hybrid 3D rendering** (Three.js + React Three Fiber + Drei):
  - The **spiral galaxy** uses a layered point cloud: a bright dense core
    bulge, two clearly-readable spiral arms, and a soft outer halo — every
    layer has a distinct color so the structure pops.
  - **Cosmic objects** use custom GLSL shaders (swirling accretion disk for
    the black hole, pulsing core + pulsar jets for the neutron star).
  - The **central "soul" symbol** (a heart or a star) is rendered as a
    procedural particle constellation with a custom glow shader.
- **Spotify integration** — server-side Client Credentials flow loads the
  configured playlist, lets the LLM choose one track from that list, and embeds
  the exact Spotify track. Older reveals still fall back to search.
- **Instagram Story export** — `canvas.captureStream()` → `MediaRecorder`
  (webm) → `ffmpeg.wasm` transcode to MP4, all client-side. The ~31MB ffmpeg
  core lazy-loads only on the first Share click.
- **Bilingual EN/TH** with a language toggle; the LLM returns both languages.
- **Framer Motion** floating transitions + Shadcn UI dark cosmic theme.

## 🛠 Tech Stack

| Layer     | Tech                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| Framework | Next.js 16 (App Router), React 19, TypeScript                                        |
| Styling   | Tailwind CSS v4, Shadcn UI (new-york), Framer Motion                                 |
| 3D        | Three.js, @react-three/fiber, @react-three/drei                                      |
| AI        | Groq (`llama-3.3-70b-versatile`, OpenAI-compatible) with Google Gemini as a fallback |
| Music     | Spotify Web API (Client Credentials)                                                 |
| Video     | `MediaRecorder` + `@ffmpeg/ffmpeg` + `@ffmpeg/util`                                  |
| State     | Zustand (persisted)                                                                  |

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Add your API keys

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

| Variable                | Where to get it                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`    | [OpenRouter](https://openrouter.ai/keys)                               |
| `SPOTIFY_CLIENT_ID`     | [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| `SPOTIFY_CLIENT_SECRET` | same dashboard (create an app)                                         |
| `SPOTIFY_REDIRECT_URI`  | Spotify OAuth callback; local default is `http://127.0.0.1:3000/api/spotify/callback` |
| `SPOTIFY_REFRESH_TOKEN` | generated once at `/api/spotify/authorize`; store it as a secret       |
| `SPOTIFY_PLAYLIST_ID`   | optional; defaults to the configured Galaxseea playlist                |

> All keys stay server-side in Next.js API routes — they are never exposed to
> the browser bundle.

### 3. Authorize your Spotify playlist

Register `http://127.0.0.1:3000/api/spotify/callback` as a redirect URI in the
Spotify Developer Dashboard, start the dev server, then open
`http://127.0.0.1:3000/api/spotify/authorize`. Sign in as the playlist owner and
approve access. The callback returns a one-time refresh token; add it as
`SPOTIFY_REFRESH_TOKEN` in `.env.local` and restart the dev server.

For Vercel, register the production callback URL, set `SPOTIFY_REDIRECT_URI` to
that HTTPS URL, and add the same refresh token as an encrypted Production
environment variable. The app uses this owner token to read the playlist before
the LLM chooses a track.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), pick a language, and begin.

## 🧭 User Flow

1. **Landing** — choose EN/TH, click "Begin your journey".
2. **Quiz** — answer a few short open-ended questions (Framer Motion transitions). One of them is always about your ideal soulmate.
3. **AI processing** — the LLM analyzes your answers and returns a universe
   reveal (vibe, cosmic object, central symbol, colors, rotation speed,
   particle density, a Spotify query, and a 2-sentence reading).
4. **Reveal** — your 3D universe renders in real time with the matching song
   and poetic reading.
5. **Share** — click "Share to Story" to record a 12s MP4 of your spinning
   universe and download it for Instagram.

## 📁 Project Structure

```
app/            # Next.js App Router pages + API routes
  api/
    generate-quiz/   # LLM call #1 (question generation)
    analyze/         # LLM call #2 (personality → universe)
    spotify/
      token/         # Client Credentials token exchange
      search/        # Track search → track_id
components/     # UI components (Shadcn primitives + quiz + reveal + shared)
three/          # All R3F/Three.js scene logic
  constellations/    # Hand-authored Float32Array outlines (heart, star)
  objects/           # Galaxy, BlackHole, NeutronStar, CentralSymbolObject
  scene/             # UniverseScene, CosmicBackground, ParticleField
  shaders/           # GLSL (glow particle)
  materials/         # GlowPointMaterial
  hooks/             # useUniverseConfig, useCanvasRecorder, useMp4Exporter
lib/            # quiz.ts, analyze.ts, llm.ts, schemas.ts, spotify.ts
prompts/        # companion chat prompt
config/         # quizConfig.ts (question count and generic model)
types/          # universe.ts (shared types)
store/          # quizStore.ts (Zustand, persisted)
```

## 🔬 How the mapping works

The personality → universe mapping is the heart of the app. `lib/analyze.ts`
scores answer evidence separately from the creative reveal, then fixes the
selected profile and song before the final writing call.

- **Cozy / warm / loving** → `galaxy` (a warm spiral) + `heart` (or `star`)
  symbol, warm palette.
- **Deep / quiet / intense** → `black_hole` (or `neutron_star`) + `star` (or
  `none`) symbol, deep saturated palette.
- **Focused / driven / carrying weight** → `neutron_star` + `star` (or
  `heart`) symbol, electric / high-contrast palette.
- **Vast / imaginative / dreamy** → `galaxy` + `star` (or `heart`) symbol,
  iridescent palette.

Output is JSON-mode and re-validated with Zod (`lib/schemas.ts`) before
reaching the 3D layer.

## 🎥 Video export notes

- The R3F canvas uses `preserveDrawingBuffer: true` so `captureStream()` works.
- `MediaRecorder` produces a webm, which `ffmpeg.wasm` transcodes to an
  IG-friendly MP4 (`libx264`, `yuv420p`, `+faststart`).
- The ffmpeg core (~31MB) is fetched from jsdelivr on first Share click and
  reused after. Single-thread build is used to avoid COOP/COEP header setup.

## ⚙️ Configuration

All LLM settings (one shared model for English and Thai, provider order,
fallbacks, reasoning effort, timeouts, quiz limits) live in
`config/models.ts`. Only `OPENROUTER_API_KEY` comes from the environment.

## 📝 Notes

- Without `OPENROUTER_API_KEY`, the quiz/analyze routes return 500.
- Without Spotify credentials, the song card shows an error but the rest of the
  reveal still works.
- The constellation outlines are hand-authored for v1; they can be upgraded to
  SVG-traced silhouettes later if denser shapes are desired.
