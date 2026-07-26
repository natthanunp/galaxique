import type {
  SpotifyPlaylistCandidate,
  SpotifyTrack,
} from "@/types/universe";

/**
 * Server-side Spotify helpers (Client Credentials flow).
 *
 * The client secret never leaves the server. We cache the access token in a
 * module-level variable with its expiry so repeated search calls don't each
 * burn a token request.
 *
 * NOTE: Node's native fetch (undici) sometimes hits transient ECONNRESET
 * errors against Spotify's API (curl works fine). We wrap fetches in a small
 * retry-with-backoff helper to absorb those.
 */

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const AUTHORIZE_ENDPOINT = "https://accounts.spotify.com/authorize";
const SEARCH_ENDPOINT = "https://api.spotify.com/v1/search";
const TRACKS_ENDPOINT = "https://api.spotify.com/v1/tracks";
const PLAYLIST_ENDPOINT = "https://api.spotify.com/v1/playlists";
const DEFAULT_PLAYLIST_ID = "1LGPBmHJCUZWlrxz17lWhP";
const PLAYLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAYLIST_SCOPES = ["playlist-read-private", "playlist-read-collaborative"];

/** Fetch with up to 3 retries on transient network errors (ECONNRESET, etc.). */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, init);
      // 429 / 5xx are also retryable.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`retryable status ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      // Exponential backoff: 200ms, 400ms, 800ms.
      const delay = 200 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

interface CachedToken {
  value: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;
let cachedUserToken: CachedToken | null = null;
let cachedPlaylist: {
  id: string;
  tracks: SpotifyPlaylistCandidate[];
  expiresAt: number;
} | null = null;

/** True when both Spotify env vars are present. */
export function spotifyConfigured(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET,
  );
}

/** True when the owner OAuth flow has been completed for playlist access. */
export function spotifyOwnerAuthorizationConfigured(): boolean {
  return Boolean(
    spotifyConfigured() &&
      process.env.SPOTIFY_REDIRECT_URI &&
      process.env.SPOTIFY_REFRESH_TOKEN,
  );
}

/** The playlist used for new reveal song selections. */
export function getSpotifyPlaylistId(): string {
  return process.env.SPOTIFY_PLAYLIST_ID?.trim() || DEFAULT_PLAYLIST_ID;
}

/** Build Spotify's owner-authorization URL with a caller-generated CSRF state. */
export function getSpotifyAuthorizationUrl(state: string): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI are required for owner authorization.",
    );
  }

  return `${AUTHORIZE_ENDPOINT}?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: PLAYLIST_SCOPES.join(" "),
    state,
  })}`;
}

/** Exchange a one-time Spotify authorization code for the owner's refresh token. */
export async function exchangeSpotifyAuthorizationCode(code: string): Promise<string> {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("SPOTIFY_REDIRECT_URI is not configured.");
  }

  const token = await requestSpotifyToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
  if (!token.refresh_token) {
    throw new Error(
      "Spotify did not return a refresh token. Remove this app from Spotify account access and authorize again.",
    );
  }
  return token.refresh_token;
}

/** Obtain (or reuse) a Client Credentials access token. */
export async function getSpotifyToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.value;
  }

  const data = await requestSpotifyToken(
    new URLSearchParams({ grant_type: "client_credentials" }),
  );
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.value;
}

/** Obtain a short-lived access token for the playlist owner. */
export async function getSpotifyUserToken(): Promise<string> {
  const now = Date.now();
  if (cachedUserToken && cachedUserToken.expiresAt - 30_000 > now) {
    return cachedUserToken.value;
  }

  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "Spotify owner authorization is required. Open /api/spotify/authorize and set SPOTIFY_REFRESH_TOKEN from its callback response.",
    );
  }

  const data = await requestSpotifyToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  cachedUserToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedUserToken.value;
}

interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function requestSpotifyToken(
  body: URLSearchParams,
): Promise<SpotifyTokenResponse> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials are not configured.");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchWithRetry(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Spotify token request failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as SpotifyTokenResponse;
}

/** Search Spotify for tracks matching the query; return the strongest title /
 *  artist match from the top results. We call /v1/tracks/{id} to pick up the 30s `preview_url`
 *  MP3, which is the most reliable way to autoplay audio on the reveal page.
 *  NOTE: Spotify has been deprecating `preview_url` platform-wide, so we fall
 *  back to the free iTunes Search API for a 30s preview when Spotify has none. */
export async function searchTrack(query: string): Promise<SpotifyTrack | null> {
  const token = await getSpotifyToken();
  const url = `${SEARCH_ENDPOINT}?${new URLSearchParams({
    q: query,
    type: "track",
    limit: "10",
  })}`;

  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Spotify search failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    tracks?: { items: SpotifyApiTrack[] };
  };
  const items = data.tracks?.items ?? [];
  if (items.length === 0) return null;

  // Search order can include alternate versions and loose regional matches.
  // Prefer the result whose title and artist actually match the query, and
  // avoid derivative versions when the original is available.
  const track = items
    .map((item, index) => ({ item, index, score: scoreTrackMatch(item, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.item;
  if (!track) return null;

  return resolveTrack(track, token);
}

/** Resolve an exact Spotify track ID without searching the global catalog. */
export async function getTrackById(trackId: string): Promise<SpotifyTrack | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return null;
  const token = await getSpotifyToken();
  const res = await fetchWithRetry(`${TRACKS_ENDPOINT}/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Spotify track lookup failed (${res.status}): ${detail}`);
  }
  return resolveTrack((await res.json()) as SpotifyApiTrack, token);
}

/** Load the configured owner's playlist and return only the fields the LLM needs. */
export async function getSpotifyPlaylistTracks(
  playlistId = getSpotifyPlaylistId(),
): Promise<SpotifyPlaylistCandidate[]> {
  const now = Date.now();
  if (cachedPlaylist && cachedPlaylist.id === playlistId && cachedPlaylist.expiresAt > now) {
    return cachedPlaylist.tracks;
  }

  const token = await getSpotifyUserToken();
  const tracks: SpotifyPlaylistCandidate[] = [];
  let offset = 0;
  const limit = 50;

  while (tracks.length < 200) {
    const url = `${PLAYLIST_ENDPOINT}/${encodeURIComponent(playlistId)}/items?${new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })}`;
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Spotify playlist request failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as {
      items?: {
        /** Current Spotify API response shape. */
        item?: SpotifyApiTrack | null;
        /** Legacy response shape retained for compatibility. */
        track?: SpotifyApiTrack | null;
      }[];
      next?: string | null;
    };
    const page = (data.items ?? [])
      .map((item) => item.item ?? item.track)
      .filter((track): track is SpotifyApiTrack => Boolean(track?.id && track.name));
    tracks.push(
      ...page.map((track) => ({
        track_id: track.id,
        name: track.name,
        artist: track.artists.map((artist) => artist.name).join(", "),
      })),
    );

    if (!data.next || page.length === 0) break;
    offset += limit;
  }

  if (tracks.length === 0) {
    throw new Error("The configured Spotify playlist has no readable tracks.");
  }

  cachedPlaylist = {
    id: playlistId,
    tracks,
    expiresAt: now + PLAYLIST_CACHE_TTL_MS,
  };
  return tracks;
}

async function resolveTrack(
  track: SpotifyApiTrack,
  token: string,
): Promise<SpotifyTrack> {
  // Playlist items often include preview_url already, but a detail lookup
  // keeps this reliable for both playlist and global-search results.
  let preview_url = track.preview_url ?? null;
  if (!preview_url) {
    try {
      const detail = await fetchWithRetry(`${TRACKS_ENDPOINT}/${track.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (detail.ok) {
        const body = (await detail.json()) as { preview_url?: string | null };
        preview_url = body.preview_url ?? null;
      }
    } catch {
      // Non-fatal — fall back to the iframe-only experience.
    }
  }

  const artist = track.artists.map((a) => a.name).join(", ");
  if (!preview_url) preview_url = await fetchItunesPreview(track.name, artist);

  const images = track.album?.images ?? [];
  return {
    track_id: track.id,
    name: track.name,
    artist,
    embed_url: `https://open.spotify.com/embed/track/${track.id}`,
    preview_url,
    album_art_url: images[1]?.url ?? images[0]?.url ?? null,
  };
}

/** Fallback 30s preview lookup via Apple's free, unauthenticated iTunes
 *  Search API — used when Spotify's own preview_url is null (increasingly
 *  common as Spotify winds the field down). Returns null if no match. */
async function fetchItunesPreview(
  trackName: string,
  artist: string,
): Promise<string | null> {
  try {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({
      term: `${trackName} ${artist}`,
      media: "music",
      entity: "song",
      limit: "1",
    })}`;
    const res = await fetchWithRetry(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { previewUrl?: string | null }[];
    };
    return data.results?.[0]?.previewUrl ?? null;
  } catch {
    // Non-fatal — the UI already handles a null preview_url gracefully.
    return null;
  }
}

interface SpotifyApiTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album?: { images: { url: string; width: number; height: number }[] };
  preview_url?: string | null;
  /** Spotify's 0-100 popularity score. Used as a minor tiebreaker so an
   *  obscure same-titled cover doesn't outrank the well-known original when
   *  text-match scores are close. */
  popularity?: number;
}

const DERIVATIVE_TERMS = [
  "remix",
  "slowed",
  "sped up",
  "karaoke",
  "lofi",
  "instrumental",
  "cover",
  "live",
];

function scoreTrackMatch(track: SpotifyApiTrack, query: string): number {
  const normalizedQuery = query.toLowerCase();
  const title = track.name.toLowerCase();
  const artist = track.artists.map((a) => a.name).join(" ").toLowerCase();
  const queryTokens = normalizedQuery.split(/[^a-z0-9ก-๙]+/i).filter(Boolean);
  const titleTokens = title.split(/[^a-z0-9ก-๙]+/i).filter(Boolean);
  const artistTokens = artist.split(/[^a-z0-9ก-๙]+/i).filter(Boolean);
  const titleCoverage = queryTokens.filter((token) => title.includes(token)).length;
  const artistCoverage = queryTokens.filter((token) => artist.includes(token)).length;
  const exactTitle = normalizedQuery.includes(title) ? 20 : 0;
  const derivativePenalty = DERIVATIVE_TERMS.some((term) => title.includes(term))
    ? 25
    : 0;

  return (
    exactTitle +
    titleCoverage * 4 +
    artistCoverage * 6 +
    Math.min(titleTokens.length, 3) +
    Math.min(artistTokens.length, 2) -
    derivativePenalty +
    // Minor tiebreaker only (max +2) — text-match signals above still
    // dominate, this just nudges toward the well-known version when two
    // candidates otherwise score the same (e.g. original vs. an obscure
    // same-titled cover by a different artist).
    (track.popularity ?? 0) / 50
  );
}
