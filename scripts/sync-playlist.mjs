#!/usr/bin/env node
/**
 * Syncs the whole Spotify playlist into a dated catalog snapshot plus a sync report.
 *
 *   node scripts/sync-playlist.mjs            write data/catalog/snapshots/<date>.json + reports/<date>.json
 *   node scripts/sync-playlist.mjs --approve  also make that snapshot the one selection reads (data/catalog/approved.json)
 *
 * Tracks are matched by Spotify ID, then ISRC, so relinked/replaced tracks are not
 * treated as new. Removed tracks are preserved (status "removed") for history.
 */
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const ROOT = path.resolve(import.meta.dirname, "..");
const CATALOG_DIR = path.join(ROOT, "data", "catalog");
const DEFAULT_PLAYLIST_ID = "1LGPBmHJCUZWlrxz17lWhP";

export function loadEnvLocal() {
  try {
    for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Optional when variables are already exported.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spotifyFetch(url, init, attempt = 0) {
  const res = await fetch(url, init);
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const waitMs = (Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000;
    console.warn(`  ! Spotify ${res.status} — waiting ${waitMs}ms`);
    await sleep(waitMs);
    return spotifyFetch(url, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`Spotify request failed (${res.status})`);
  return res.json();
}

async function ownerToken() {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) throw new Error("SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN are required.");
  const data = await spotifyFetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  return data.access_token;
}

export async function fetchPlaylistItems(token, playlistId) {
  const items = [];
  let url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50&market=from_token`;
  while (url) {
    const data = await spotifyFetch(url, { headers: { Authorization: `Bearer ${token}` } });
    items.push(...(data.items ?? []));
    url = data.next;
  }
  return items;
}

function toTrack(item) {
  const t = item.item ?? item.track;
  if (!t) return null;
  const base = {
    track_id: t.linked_from?.id ?? t.id ?? `local:${t.uri ?? t.name}`,
    isrc: t.external_ids?.isrc ?? null,
    name: t.name ?? "",
    artist: (t.artists ?? []).map((a) => a.name).join(", ") || (t.show?.name ?? ""),
    added_at: item.added_at ?? null,
  };
  if (item.is_local || t.is_local) return { ...base, status: "local" };
  if (t.type === "episode") return { ...base, status: "episode" };
  if (t.is_playable === false) return { ...base, status: "unavailable" };
  return { ...base, status: "active" };
}

async function latestSnapshot(excludeName) {
  try {
    const names = (await readdir(path.join(CATALOG_DIR, "snapshots")))
      .filter((n) => n.endsWith(".json") && n !== excludeName).sort();
    if (!names.length) return null;
    return JSON.parse(await readFile(path.join(CATALOG_DIR, "snapshots", names.at(-1)), "utf-8"));
  } catch {
    return null;
  }
}

export function buildSnapshot(items, previous, playlistId) {
  const tracks = [];
  const seenIds = new Set();
  const seenIsrc = new Set();
  for (const item of items) {
    const track = toTrack(item);
    if (!track) continue;
    if (seenIds.has(track.track_id) || (track.isrc && seenIsrc.has(track.isrc))) {
      tracks.push({ ...track, status: "duplicate" });
      continue;
    }
    seenIds.add(track.track_id);
    if (track.isrc) seenIsrc.add(track.isrc);
    tracks.push(track);
  }

  const report = { added: [], removed: [], relinked: [], metadata_changed: [], unavailable: [], duplicates: [], local_or_episode: [] };
  const prevTracks = previous?.tracks ?? [];
  const prevById = new Map(prevTracks.map((t) => [t.track_id, t]));
  const prevByIsrc = new Map(prevTracks.filter((t) => t.isrc).map((t) => [t.isrc, t]));
  const matched = new Set();

  for (const track of tracks) {
    const label = { track_id: track.track_id, name: track.name, artist: track.artist };
    if (track.status === "duplicate") { report.duplicates.push(label); continue; }
    if (track.status === "local" || track.status === "episode") { report.local_or_episode.push({ ...label, status: track.status }); continue; }
    if (track.status === "unavailable") report.unavailable.push(label);
    const byId = prevById.get(track.track_id);
    const byIsrc = !byId && track.isrc ? prevByIsrc.get(track.isrc) : undefined;
    const prev = byId ?? byIsrc;
    if (!prev) { if (previous) report.added.push(label); continue; }
    matched.add(prev.track_id);
    if (byIsrc) {
      track.aliases = [...new Set([...(prev.aliases ?? []), prev.track_id])];
      report.relinked.push({ ...label, previous_track_id: prev.track_id });
    } else if (prev.aliases) {
      track.aliases = prev.aliases;
    }
    if (prev.name !== track.name || prev.artist !== track.artist || (prev.isrc && prev.isrc !== track.isrc)) {
      report.metadata_changed.push({ ...label, before: { name: prev.name, artist: prev.artist, isrc: prev.isrc } });
    }
  }
  for (const prev of prevTracks) {
    if (matched.has(prev.track_id) || prev.status === "duplicate") continue;
    if (prev.status !== "removed") report.removed.push({ track_id: prev.track_id, name: prev.name, artist: prev.artist });
    tracks.push({ ...prev, status: "removed", retained: prev.retained ?? false });
  }

  const snapshot = { version: 1, playlist_id: playlistId, synced_at: new Date().toISOString(), tracks };
  return { snapshot, report };
}

async function main() {
  loadEnvLocal();
  const playlistId = process.env.SPOTIFY_PLAYLIST_ID?.trim() || DEFAULT_PLAYLIST_ID;
  const date = new Date().toISOString().slice(0, 10);
  const snapshotName = `${date}.json`;
  console.log(`Syncing playlist ${playlistId}…`);
  const items = await fetchPlaylistItems(await ownerToken(), playlistId);
  const previous = await latestSnapshot(snapshotName);
  const { snapshot, report } = buildSnapshot(items, previous, playlistId);

  await mkdir(path.join(CATALOG_DIR, "snapshots"), { recursive: true });
  await mkdir(path.join(CATALOG_DIR, "reports"), { recursive: true });
  await writeFile(path.join(CATALOG_DIR, "snapshots", snapshotName), JSON.stringify(snapshot, null, 2) + "\n");
  const counts = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length]));
  await writeFile(path.join(CATALOG_DIR, "reports", snapshotName),
    JSON.stringify({ synced_at: snapshot.synced_at, previous_snapshot: previous?.synced_at ?? null, playlist_items: items.length, counts, ...report }, null, 2) + "\n");
  console.log(`Snapshot: ${snapshot.tracks.length} tracks (${snapshot.tracks.filter((t) => t.status === "active").length} active)`, counts);

  if (process.argv.includes("--approve")) {
    await writeFile(path.join(CATALOG_DIR, "approved.json"), JSON.stringify({ ...snapshot, approved_from: snapshotName }, null, 2) + "\n");
    console.log(`Approved ${snapshotName} for selection.`);
  } else {
    console.log("Review the report, then re-run with --approve to use this snapshot for selection.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
