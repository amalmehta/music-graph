// "For you": pick a vibe, get a playlist built from your own history, play it or save it to Spotify.

import { bus, vibeColor, escapeHtml, fmtAgo, fmtInt, daysBetween, postJSON, toast, norm } from "./util.js";
import * as Spotify from "./spotify.js";

const $ = (s) => document.querySelector(s);

let api, state;
let selected = null, length = 25, mix = 0.35, seed = 1;
let current = [];
const shown = new Set();
let artistIds = new Map(); // normalized artist name -> map artist id

function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isSample = () => state.graph.meta.sample;

export function init(a) {
  api = a;
  state = a.state;
  artistIds = new Map(state.graph.artists.map((x) => [norm(x.name), x.id]));

  $("#recs-mix").value = mix;
  $("#recs-mix").addEventListener("change", (e) => { mix = +e.target.value; generate(); });
  $("#recs-length").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    length = +b.dataset.n;
    $("#recs-length").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    generate();
  });
  $("#recs-shuffle").addEventListener("click", () => { current.forEach((t) => shown.add(t.k)); seed++; generate(); });
  $("#recs-play").addEventListener("click", () => play(current.map((t) => t.u[0]), `Playing ${current.length} songs through Spotify on this Mac`));
  $("#recs-save").addEventListener("click", save);
  $("#rec-list").addEventListener("click", (e) => {
    const b = e.target.closest("button.play");
    if (b) play([b.dataset.uri], "Playing through Spotify on this Mac");
  });

  if (isSample()) {
    const note = $("#recs-note");
    note.hidden = false;
    note.textContent = "These are fictional sample songs, so Play and Save are turned off. They switch on once your real export is built.";
    $("#recs-play").disabled = $("#recs-save").disabled = true;
  }
  bus.on("vibe-names", () => { renderCards(); if (selected != null) renderHeader(); });
  renderCards();
}

export function show() {
  if (selected == null) selectVibe(bestVibeNow() ?? 0);
  else renderCards();
}

export function selectVibe(v) {
  selected = v;
  shown.clear();
  seed = 1;
  renderCards();
  $("#recs").hidden = false;
  generate();
}

export async function resume(action) {
  if (action?.type !== "save") return;
  selectVibe(action.vibe);
  await saveUris(action.name, action.uris);
}

// ---------- vibe cards ----------

function bestVibeNow() {
  const now = new Date(), h = now.getHours(), d = (now.getDay() + 6) % 7; // Monday = 0, like Python
  const around = (arr) => arr[(h + 23) % 24] + 2 * arr[h] + arr[(h + 1) % 24];
  const { hours: oh, dow: od } = state.graph.overall;
  const ohs = d3.sum(oh) || 1, ods = d3.sum(od) || 1;
  let best = null, bestLift = 0;
  for (const v of state.graph.vibes) {
    const hs = d3.sum(v.hours) || 1, ds = d3.sum(v.dow) || 1;
    const lift = ((around(v.hours) / hs) / Math.max(around(oh) / ohs, 1e-6)) * ((v.dow[d] / ds) / Math.max(od[d] / ods, 1e-6));
    if (lift > bestLift) { bestLift = lift; best = v.id; }
  }
  return bestLift > 1.1 ? best : null;
}

function renderCards() {
  const g = state.graph, now = bestVibeNow();
  const counts = new Map();
  for (const t of state.history.tracks) counts.set(t.v, (counts.get(t.v) ?? 0) + 1);
  const wrap = $("#vibe-cards");
  wrap.innerHTML = g.vibes.map((v) => {
    const max = d3.max(v.hours) || 1;
    return `
    <div class="vibe-card" role="button" tabindex="0" data-vibe="${v.id}" aria-pressed="${selected === v.id}" style="--c:${vibeColor(v.id)}">
      ${now === v.id ? `<span class="now-badge">Fits right now</span>` : ""}
      <h3>${escapeHtml(api.vibeName(v.id))}</h3>
      <span class="rename" role="button" tabindex="0" title="Rename this vibe" aria-label="Rename this vibe">✎</span>
      <p>${escapeHtml(v.artists.slice(0, 3).map((i) => g.artists[i].name).join(" · "))}</p>
      <p>${escapeHtml(v.when)} · ${escapeHtml(v.days)} · ${fmtInt(counts.get(v.id) ?? 0)} songs</p>
      <div class="hours" aria-hidden="true">${v.hours.map((x) => `<span style="height:${Math.max(4, (100 * x) / max)}%"></span>`).join("")}</div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".vibe-card").forEach((card) => {
    const v = +card.dataset.vibe;
    const activate = (e) => {
      if (e.target.closest(".rename") || e.target.closest("input")) return;
      selectVibe(v);
      $("#recs").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (e) => {
      if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      activate(e);
    });
    const rename = card.querySelector(".rename");
    const startRename = (e) => {
      e.stopPropagation();
      const h3 = card.querySelector("h3");
      const input = document.createElement("input");
      input.type = "search";
      input.value = api.vibeName(v);
      input.placeholder = state.graph.vibes[v].name;
      input.setAttribute("aria-label", "Vibe name");
      input.style.width = "100%";
      h3.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        if (commit) api.renameVibe(v, input.value === state.graph.vibes[v].name ? "" : input.value);
        else renderCards();
      };
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") finish(true);
        if (ev.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
    };
    rename.addEventListener("click", startRename);
    rename.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") startRename(e); });
  });
}

// ---------- recommendations ----------

function generate() {
  if (selected == null) return;
  const hist = state.history, M = hist.months.length, ref = hist.ref;
  const all = hist.tracks.filter((t) => t.v === selected && t.u.length);
  let pool = all.filter((t) => t.p >= 3);
  if (pool.length < length * 1.5) pool = all.filter((t) => t.p >= 2);
  if (pool.length < length) pool = all;
  const random = rng(seed * 9973 + selected * 31 + 7);

  const scored = pool.map((t) => {
    const days = daysBetween(t.l, ref);
    let recent = 0;
    for (let i = 0; i < t.h.length; i += 2) if (t.h[i] >= M - 6) recent += t.h[i + 1];
    const affinity = Math.log1p(t.p) * (0.3 + 0.7 * t.c);
    const rediscover = 1 / (1 + Math.exp(-(days - 150) / 60));
    const comfort = Math.exp(-days / 120) * (0.5 + 0.5 * Math.min(1, recent / 10));
    const fit = mix * comfort + (1 - mix) * rediscover;
    const score = affinity * (0.08 + fit) * (0.85 + 0.3 * random()) * (shown.has(t.k) ? 0.15 : 1);
    return { ...t, days, recent, score };
  }).sort((a, b) => b.score - a.score);

  const artistsInVibe = new Set(pool.map((t) => t.a)).size;
  const cap = artistsInVibe < 8 ? 3 : 2;
  const perArtist = new Map(), picked = [];
  for (const t of scored) {
    if ((perArtist.get(t.a) ?? 0) >= cap) continue;
    perArtist.set(t.a, (perArtist.get(t.a) ?? 0) + 1);
    picked.push(t);
    if (picked.length >= length) break;
  }
  current = order(picked);
  renderHeader();
  renderList();
}

// Chain songs so each flows from a co-listened artist, never the same artist twice in a row.
function order(tracks) {
  if (tracks.length < 3) return tracks;
  const maxScore = tracks[0].score || 1;
  const link = (a, b) => {
    const ia = artistIds.get(norm(a)), ib = artistIds.get(norm(b));
    if (ia == null || ib == null) return 0.15;
    return state.neighbors.get(ia)?.find((n) => n.id === ib)?.w ?? 0.15;
  };
  const rest = [...tracks], out = [rest.shift()];
  while (rest.length) {
    const last = out[out.length - 1];
    const others = rest.some((t) => t.a !== last.a);
    let best = -1, bi = 0;
    rest.forEach((t, i) => {
      if (others && t.a === last.a) return;
      const s = 0.55 * (t.score / maxScore) + 0.45 * link(last.a, t.a);
      if (s > best) { best = s; bi = i; }
    });
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

function why(t) {
  if (t.days > 180) return `${fmtInt(t.p)} plays · last played ${fmtAgo(t.days)}`;
  if (t.recent >= 5) return `${fmtInt(t.p)} plays · on repeat lately`;
  return `${fmtInt(t.p)} plays · since ${t.f.slice(0, 4)}`;
}

function renderHeader() {
  const minutes = d3.sum(current, (t) => t.m / t.p);
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  $("#recs-title").innerHTML = `<span class="swatch" style="background:${vibeColor(selected)};box-shadow:0 0 12px ${vibeColor(selected)}"></span>${escapeHtml(api.vibeName(selected))}`;
  $("#recs-sub").textContent = current.length
    ? `${current.length} songs · about ${h ? `${h} h ` : ""}${m} min · ${mix < 0.4 ? "mostly songs you haven't played in a while" : mix > 0.6 ? "mostly current favorites" : "a mix of forgotten gems and favorites"}`
    : "Not enough songs in this vibe yet.";
}

function renderList() {
  const disabled = isSample() ? "disabled" : "";
  $("#rec-list").innerHTML = current.map((t) => `
    <li class="rec">
      <button class="play" data-uri="${escapeHtml(t.u[0])}" aria-label="Play ${escapeHtml(t.n)}" ${disabled}>▶</button>
      <div><div class="name">${escapeHtml(t.n)}</div><div class="artist">${escapeHtml(t.a)}</div></div>
      <div class="why">${why(t)}</div>
    </li>`).join("");
}

async function play(uris, message) {
  if (!uris.length) return;
  try {
    await postJSON("/api/play", { uris });
    toast(message);
  } catch (e) {
    toast(e.message === "Failed to fetch" ? "Can't reach the local server. Start it with python3 server.py" : e.message, { error: true });
  }
}

async function save() {
  if (!current.length) return;
  const name = `${api.vibeName(selected)} · Music Graph`;
  const uris = current.map((t) => t.u[0]);
  if (!Spotify.configured()) {
    return toast("To save playlists, add your Spotify Client ID to config.json (see README → Spotify developer app).", { error: true });
  }
  if (!Spotify.connected()) return Spotify.login({ type: "save", vibe: selected, name, uris });
  await saveUris(name, uris);
}

async function saveUris(name, uris) {
  const button = $("#recs-save");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const playlist = await Spotify.savePlaylist(name, `${uris.length} songs picked from my own listening history.`, uris);
    await postJSON("/api/play-context", { uri: playlist.uri }).catch(() => null);
    toast(`Saved “${escapeHtml(name)}” to Spotify. <a href="${escapeHtml(playlist.url)}" target="_blank" rel="noopener">Open it</a>`, { html: true });
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    button.disabled = isSample();
    button.textContent = "Save to Spotify";
  }
}
