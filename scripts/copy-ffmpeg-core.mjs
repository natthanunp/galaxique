#!/usr/bin/env node
/**
 * Copies @ffmpeg/core's umd build into public/ffmpeg/ so the app can
 * serve the 32 MB WASM blob from its own origin instead of pulling it
 * live from a CDN at export time. This is what turns the "Loading
 * ~31 MB converter (one-time)…" spinner into something honest: the
 * assets are still big, but they're already on this server's CDN, not
 * in a third-party round-trip the user pays for on every new device.
 *
 * Pinned to the exact core version our @ffmpeg/ffmpeg wrapper expects
 * (CORE_VERSION in useMp4Exporter.ts). Bumping either side without
 * the other breaks ABI; the script refuses to overwrite if the
 * installed version mismatches the pinned one, so the package.json
 * `postinstall` hook fails loudly instead of silently shipping a
 * broken wasm.
 *
 * Run on `npm install` via the postinstall hook; safe to re-run any
 * time (skips the copy if the destination already matches).
 */

import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEST_DIR = path.join(REPO_ROOT, "public", "ffmpeg");
const CORE_VERSION = "0.12.9";
// The wrapper's CORE_VERSION is also "0.12.9" (see @ffmpeg/ffmpeg's
// dist/esm/const.js). If the wrapper ever upgrades, this script MUST
// be bumped in lockstep — the load() will throw FS errors otherwise.

// Resolve @ffmpeg/core via a direct path to package.json. We can't use
// `require.resolve("@ffmpeg/core/package.json")` because @ffmpeg/core
// has strict `exports` in its package.json that don't expose
// `./package.json` (returns ERR_PACKAGE_PATH_NOT_EXPORTED). Instead,
// walk up from this script to find node_modules/@ffmpeg/core/package.json
// — works for npm/pnpm/yarn because they all leave a parseable
// package.json next to the dist/ dir.
const corePkgPath = path.join(
  REPO_ROOT,
  "node_modules",
  "@ffmpeg",
  "core",
  "package.json",
);
if (!existsSync(corePkgPath)) {
  console.error(
    `[copy-ffmpeg-core] ERROR: ${corePkgPath} not found. Did @ffmpeg/core install?`,
  );
  process.exit(1);
}
const corePkg = JSON.parse(readFileSync(corePkgPath, "utf-8"));
const installedVersion = corePkg.version;
if (installedVersion !== CORE_VERSION) {
  console.error(
    `[copy-ffmpeg-core] ERROR: installed @ffmpeg/core is ${installedVersion}, but useMp4Exporter pins ${CORE_VERSION}. Update one or the other — they MUST match.`,
  );
  process.exit(1);
}

// The wrapper creates a module-type Web Worker (`new Worker(url, { type:
// "module" })`). Inside a module worker, `importScripts()` is unavailable
// and the worker's internal fallback uses dynamic `import()`. That dynamic
// import only works against an actual ES module — `import()`-ing the UMD
// build silently produces no exports (UMD assigns to `var createFFmpegCore`
// on the script's global scope, but module workers don't share scope that
// way), and the `load()` promise never resolves. Hence the
// "stuck at Loading the local video converter…" hang. We MUST ship the
// ESM build for the worker to be able to import it.
const coreRoot = path.dirname(corePkgPath);
const SRC_JS = path.join(coreRoot, "dist", "esm", "ffmpeg-core.js");
const SRC_WASM = path.join(coreRoot, "dist", "esm", "ffmpeg-core.wasm");
if (!existsSync(SRC_JS) || !existsSync(SRC_WASM)) {
  console.error(
    `[copy-ffmpeg-core] ERROR: expected ${SRC_JS} and ${SRC_WASM} — the @ffmpeg/core package layout may have changed.`,
  );
  process.exit(1);
}

// We also ship @ffmpeg/ffmpeg's own `worker.js` (NOT @ffmpeg/core's).
// The wrapper builds its module worker via
//   `new Worker(new URL(classWorkerURL ?? './worker.js', import.meta.url), { type: 'module' })`
// When we `import { FFmpeg } from '@ffmpeg/ffmpeg'` from our app code,
// Turbopack bundles `classes.js` into our chunk but does NOT emit the
// `worker.js` sibling as a separate asset. As a result `new URL('./worker.js',
// import.meta.url)` resolves to a path the browser can't actually fetch —
// and even if it could, Turbopack rewrites the worker's internal
// `await import(_coreURL)` into a static module lookup that throws
// `Cannot find module as expression is too dynamic`. Serving the worker
// ourselves from origin side-steps both problems: the wrapper's
// `classWorkerURL` param points at our static file, and the worker's
// dynamic `import()` runs in the browser's native ESM loader against a
// same-origin module URL.
const wrapperPkgPath = path.join(
  REPO_ROOT,
  "node_modules",
  "@ffmpeg",
  "ffmpeg",
  "package.json",
);
if (!existsSync(wrapperPkgPath)) {
  console.error(
    `[copy-ffmpeg-core] ERROR: ${wrapperPkgPath} not found. Did @ffmpeg/ffmpeg install?`,
  );
  process.exit(1);
}
const SRC_WORKER = path.join(
  REPO_ROOT,
  "node_modules",
  "@ffmpeg",
  "ffmpeg",
  "dist",
  "esm",
  "worker.js",
);
if (!existsSync(SRC_WORKER)) {
  console.error(
    `[copy-ffmpeg-core] ERROR: expected ${SRC_WORKER} — the @ffmpeg/ffmpeg package layout may have changed.`,
  );
  process.exit(1);
}

// The wrapper's worker.js has two bare relative imports:
//   import { CORE_URL, FFMessageType } from "./const.js";
//   import { ... } from "./errors.js";
// We serve the worker from /ffmpeg/ffmpeg-worker.js, so the browser
// resolves those relative imports to /ffmpeg/const.js and /ffmpeg/errors.js
// — which must also be present on origin, otherwise we get
// NS_ERROR_CORRUPTED_CONTENT. Both files are self-contained (no
// transitive deps), so shipping them verbatim is safe.
const SRC_CONST = path.join(
  REPO_ROOT,
  "node_modules",
  "@ffmpeg",
  "ffmpeg",
  "dist",
  "esm",
  "const.js",
);
const SRC_ERRORS = path.join(
  REPO_ROOT,
  "node_modules",
  "@ffmpeg",
  "ffmpeg",
  "dist",
  "esm",
  "errors.js",
);
for (const p of [SRC_CONST, SRC_ERRORS]) {
  if (!existsSync(p)) {
    console.error(
      `[copy-ffmpeg-core] ERROR: expected ${p} — the @ffmpeg/ffmpeg package layout may have changed.`,
    );
    process.exit(1);
  }
}

// Optional: ship the multi-threaded core from @ffmpeg/core-mt into a
// separate /public/ffmpeg-mt/ folder. The mt core uses pthread-style
// workers and requires COOP/COEP headers (set in next.config.ts) so
// SharedArrayBuffer is available in the worker context. If @ffmpeg/core-mt
// is not installed, we silently skip — the single-thread core in /public/ffmpeg/
// is still the fallback. We pin to the same version as @ffmpeg/core so a
// mid-flight upgrade can't leave them out of sync.
const mtPkgPath = path.join(
  REPO_ROOT,
  "node_modules",
  "@ffmpeg",
  "core-mt",
  "package.json",
);
const DEST_DIR_MT = path.join(REPO_ROOT, "public", "ffmpeg-mt");
let mtInstalled = null;
if (existsSync(mtPkgPath)) {
  const mtPkg = JSON.parse(readFileSync(mtPkgPath, "utf-8"));
  if (mtPkg.version !== installedVersion) {
    console.error(
      `[copy-ffmpeg-core] ERROR: @ffmpeg/core-mt is ${mtPkg.version} but @ffmpeg/core is ${installedVersion}. They MUST match.`,
    );
    process.exit(1);
  }
  mtInstalled = mtPkg.version;
  const mtRoot = path.dirname(mtPkgPath);
  const SRC_MT_JS = path.join(mtRoot, "dist", "esm", "ffmpeg-core.js");
  const SRC_MT_WASM = path.join(mtRoot, "dist", "esm", "ffmpeg-core.wasm");
  const SRC_MT_WORKER = path.join(mtRoot, "dist", "esm", "ffmpeg-core.worker.js");
  for (const p of [SRC_MT_JS, SRC_MT_WASM, SRC_MT_WORKER]) {
    if (!existsSync(p)) {
      console.error(
        `[copy-ffmpeg-core] ERROR: expected ${p} — the @ffmpeg/core-mt package layout may have changed.`,
      );
      process.exit(1);
    }
  }
  mkdirSync(DEST_DIR_MT, { recursive: true });
  for (const [src, name] of [
    [SRC_MT_JS, "ffmpeg-core.js"],
    [SRC_MT_WASM, "ffmpeg-core.wasm"],
    [SRC_MT_WORKER, "ffmpeg-core.worker.js"],
  ]) {
    const dest = path.join(DEST_DIR_MT, name);
    if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
      continue;
    }
    copyFileSync(src, dest);
  }
}

mkdirSync(DEST_DIR, { recursive: true });

for (const [src, name] of [
  [SRC_JS, "ffmpeg-core.js"],
  [SRC_WASM, "ffmpeg-core.wasm"],
  [SRC_WORKER, "ffmpeg-worker.js"],
  [SRC_CONST, "const.js"],
  [SRC_ERRORS, "errors.js"],
]) {
  const dest = path.join(DEST_DIR, name);
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
    // Skip — already in place and same size. Saves ~32 MB copy on
    // every install. We compare size only because mtime would always
    // differ after a re-install.
    continue;
  }
  copyFileSync(src, dest);
}

const wasmSize = statSync(path.join(DEST_DIR, "ffmpeg-core.wasm")).size;
const workerSize = statSync(path.join(DEST_DIR, "ffmpeg-worker.js")).size;
let summary = `[copy-ffmpeg-core] ${path.relative(REPO_ROOT, DEST_DIR)}/ ready (wasm: ${(wasmSize / (1024 * 1024)).toFixed(1)} MB, worker: ${(workerSize / 1024).toFixed(1)} KB, core @${installedVersion})`;
if (mtInstalled) {
  const mtWasmSize = statSync(path.join(DEST_DIR_MT, "ffmpeg-core.wasm")).size;
  summary += ` | ${path.relative(REPO_ROOT, DEST_DIR_MT)}/ ready (wasm: ${(mtWasmSize / (1024 * 1024)).toFixed(1)} MB, mt core @${mtInstalled})`;
}
console.log(summary);