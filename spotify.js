// Spotify Web API from the browser: Authorization Code + PKCE (no client secret).
// Used to save playlists and as a now-playing fallback for other devices.
// Follows the February 2026 development-mode endpoints (POST /me/playlists, /playlists/{id}/items).

import { store } from "./util.js";

const SCOPES = "user-read-currently-playing user-read-playback-state playlist-modify-private playlist-read-private playlist-read-collaborative";
const TOKEN_KEY = "spotify-token";
const redirectUri = () => `${location.origin}/callback`;

let clientId = null;

export async function init() {
  try {
    clientId = (await (await fetch("/config.json")).json()).client_id || null;
  } catch {
    clientId = null;
  }
  if (location.pathname === "/callback") await finishLogin();
}

export const configured = () => Boolean(clientId);
export const connected = () => Boolean(store.get(TOKEN_KEY, null)?.refresh_token);

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// `resume` is saved and handed back after the redirect so the pending action can continue.
export async function login(resume) {
  if (!clientId) throw new Error("Add your Spotify Client ID to config.json first (see README).");
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem("pkce", JSON.stringify({ verifier, state, resume }));
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(),
    code_challenge_method: "S256", code_challenge: challenge, state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

let resumeAction = null;
export const takeResume = () => { const r = resumeAction; resumeAction = null; return r; };

async function finishLogin() {
  const params = new URLSearchParams(location.search);
  const pending = JSON.parse(sessionStorage.getItem("pkce") || "null");
  sessionStorage.removeItem("pkce");
  history.replaceState(null, "", "/");
  if (!pending || params.get("state") !== pending.state || !params.get("code")) return;
  await tokenRequest({
    grant_type: "authorization_code", code: params.get("code"), redirect_uri: redirectUri(),
    client_id: clientId, code_verifier: pending.verifier,
  });
  resumeAction = pending.resume ?? null;
}

async function tokenRequest(body) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) {
    if (body.grant_type === "refresh_token") store.set(TOKEN_KEY, null);
    throw new Error(data.error_description || "Spotify login failed");
  }
  const previous = store.get(TOKEN_KEY, {}) || {};
  const token = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || previous.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  store.set(TOKEN_KEY, token);
  return token;
}

async function accessToken() {
  let token = store.get(TOKEN_KEY, null);
  if (!token) throw new Error("Not connected to Spotify");
  if (Date.now() > token.expires_at) token = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: clientId });
  return token.access_token;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 403) throw new Error("Spotify refused this. In development mode the app owner needs Premium and you must be added as a user in the developer dashboard.");
    throw new Error(data?.error?.message || `Spotify API error ${res.status}`);
  }
  return data;
}

export async function currentlyPlaying() {
  if (!connected()) return null;
  const data = await api("/me/player/currently-playing");
  const item = data?.item;
  if (!item || item.type !== "track") return null;
  return {
    source: "web", state: data.is_playing ? "playing" : "paused",
    track: item.name, artist: item.artists?.[0]?.name ?? "", album: item.album?.name ?? "",
    track_uri: item.uri, artwork_url: item.album?.images?.[0]?.url ?? null,
    position_ms: data.progress_ms ?? 0, duration_ms: item.duration_ms ?? 0,
  };
}

// Reading playlists needs scopes a token from before this feature won't carry, so say so plainly
// rather than surfacing Spotify's "Insufficient client scope".
function scopeError(e) {
  return /scope/i.test(e.message) ? new Error("Reconnect to Spotify: reading your playlists needs a permission the old login didn't ask for.") : e;
}

export async function listPlaylists() {
  const out = [];
  let url = "/me/playlists?limit=50";
  try {
    while (url && out.length < 400) {
      const page = await api(url);
      for (const p of page?.items ?? []) {
        if (p) out.push({ id: p.id, name: p.name, count: p.tracks?.total ?? 0, owner: p.owner?.display_name ?? "" });
      }
      url = page?.next ? page.next.replace("https://api.spotify.com/v1", "") : null;
    }
  } catch (e) {
    throw scopeError(e);
  }
  return out;
}

export async function playlistTracks(id) {
  const out = [];
  let url = `/playlists/${id}/tracks?limit=100&fields=next,items(track(uri,name,album(name),duration_ms,artists(name)))`;
  try {
    while (url && out.length < 2000) {
      const page = await api(url);
      for (const row of page?.items ?? []) {
        const t = row?.track;
        if (!t?.uri || !t.name) continue;                       // local files and removed tracks have no uri
        out.push({
          uri: t.uri, title: t.name, artist: t.artists?.[0]?.name ?? "",
          album: t.album?.name ?? "", duration: (t.duration_ms ?? 0) / 1000,
        });
      }
      url = page?.next ? page.next.replace("https://api.spotify.com/v1", "") : null;
    }
  } catch (e) {
    throw scopeError(e);
  }
  return out;
}

export async function savePlaylist(name, description, uris) {
  const playlist = await api("/me/playlists", { method: "POST", body: { name, description, public: false } });
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlist.id}/items`, { method: "POST", body: { uris: uris.slice(i, i + 100) } });
  }
  return { id: playlist.id, uri: playlist.uri, url: playlist.external_urls?.spotify };
}
