// Now Playing: full-screen light show that reacts to the music, plus live graphs of
// where the song sits in your taste map and your history with it.

import { vibeColor, norm, trackKey, dense, fmtDate, fmtHours, fmtInt, fmtMonth, store, toast, prefersReducedMotion } from "./util.js";
import * as Spotify from "./spotify.js";
import * as Recs from "./recs.js";

const $ = (s) => document.querySelector(s);
const DEFAULT_PALETTE = [[1, 0.24, 0.5], [0.21, 0.82, 0.75], [0.55, 0.48, 1], [1, 0.69, 0.23]];

let api, state, els;
let status = null, statusAt = 0, trackUri = null, dismissedFor = null, wasPlaying = false;
let webCache = { at: 0, value: null };
let match = null; // { track, artist, vibe, mapId, trackSeries, artistSeries }
let byUri, byKey, artistByKey;

let palette = DEFAULT_PALETTE.map((c) => [...c]), paletteFrom = palette, paletteTo = palette, paletteT = 1;
const MELODY_TRAIL = 520;        // frames kept on screen: about nine seconds of tune
const melodyTrail = [];          // MIDI notes, NaN where nothing is pitched
const melodyView = { lo: 52, hi: 76 };   // the note range on screen, eased towards what is playing
const audio = { ctx: null, analyser: null, stream: null, freq: null, wave: null, silentSince: 0, label: "" };
const levels = { bass: 0, mid: 0, high: 0, beat: 0, peaks: [0.2, 0.2, 0.2], prevBass: 0, flux: [], lastBeat: 0, spec: new Float32Array(64), specPeak: 0.3 };
const particles = [];
const cam = { x: 0.5, y: 0.5, k: 1, tx: 0.5, ty: 0.5, tk: 1 };
let glr = null, fx = null, running = false, raf = 0, lastFrame = 0, dpr = 1;
let external = null; // DJ mode: { analyser, ctx, freq, wave, progress, onClose }
let autoOpenBlocker = () => false;

export const setAutoOpenBlocker = (fn) => (autoOpenBlocker = fn);
export const isExternal = () => Boolean(external);

// DJ mode: the light show listens to the DJ mix directly instead of the mic or Spotify.
export function openExternal(opts) {
  external = {
    ...opts,
    freq: new Uint8Array(opts.analyser.frequencyBinCount),
    wave: new Uint8Array(opts.analyser.fftSize),
  };
  els.np.classList.add("is-dj");
  $("#np-dj").hidden = false;
  updateExternal(opts);
  open(true);
}

export function updateExternal({ title, subtitle, palette }) {
  if (!external) return;
  els.title.textContent = title;
  els.artist.textContent = subtitle;
  if (palette) setPalette(palette);
}

export function init(a) {
  api = a;
  state = a.state;
  els = {
    np: $("#np"), gl: $("#np-gl"), fx: $("#np-fx"), art: $("#np-art"), artWrap: $("#np-art-wrap"),
    title: $("#np-title"), artist: $("#np-artist"), progress: $("#np-progress-fill"),
    map: $("#np-map"), mapLabel: $("#np-map-label"), history: $("#np-history"), historyLabel: $("#np-history-label"),
    historyStats: $("#np-history-stats"), more: $("#np-more"), pill: $("#np-open"), pillText: $("#np-pill-text"),
    audioBtn: $("#np-audio-btn"), device: $("#np-device"), audioState: $("#np-audio-state"),
  };
  byUri = new Map();
  byKey = new Map();
  for (const t of state.history.tracks) {
    byKey.set(t.k, t);
    for (const u of t.u) byUri.set(u, t);
  }
  artistByKey = new Map(state.history.artists.map((x) => [x.k, x]));

  els.pill.addEventListener("click", () => { dismissedFor = null; open(true); });
  $("#np-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.np.hidden) close(); });
  els.more.addEventListener("click", () => {
    if (!match || match.vibe < 0) return;
    close();
    api.showView("foryou");
    Recs.selectVibe(match.vibe);
  });
  els.audioBtn.addEventListener("click", async () => {
    if (audio.analyser) {
      stopAudio();
      store.set("np-audio", false);
      return;
    }
    try {
      await startAudio(store.get("np-device", null));
      store.set("np-audio", true);
    } catch (e) {
      toast(e.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser's site settings to sync to the sound." : `Couldn't start audio: ${e.message}`, { error: true });
    }
  });
  els.device.addEventListener("change", async () => {
    store.set("np-device", els.device.value);
    try { await startAudio(els.device.value); } catch (e) { toast(`Couldn't switch input: ${e.message}`, { error: true }); }
  });
  window.addEventListener("resize", () => running && sizeCanvases());

  fx = els.fx.getContext("2d");
  glr = initGL(els.gl);
  poll();
}

// ---------- polling ----------

let failures = 0;
async function poll() {
  let s = null;
  try {
    const res = await fetch("/api/now-playing");
    s = await res.json();
    failures = 0;
  } catch {
    failures++;
  }
  const local = s && (s.state === "playing" || s.state === "paused") ? s : null;
  if ((!local || local.state !== "playing") && Spotify.connected()) {
    if (Date.now() - webCache.at > 3000) {
      webCache.at = Date.now();
      webCache.value = await Spotify.currentlyPlaying().catch(() => null);
    }
    if (webCache.value && (webCache.value.state === "playing" || !local)) s = webCache.value;
  }
  update(s && (s.state === "playing" || s.state === "paused") && s.track_uri ? s : null);
  setTimeout(poll, failures > 3 ? 5000 : 1000);
}

function update(s) {
  if (!s) {
    if (status && !els.np.hidden && !external) close(false);
    status = null;
    wasPlaying = false;
    els.pill.hidden = true;
    return;
  }
  status = s;
  statusAt = performance.now();
  els.pill.hidden = hidePill;
  els.pillText.textContent = `${s.track} · ${s.artist}`;
  if (external) return;
  const playing = s.state === "playing";
  if (s.track_uri !== trackUri) {
    trackUri = s.track_uri;
    onTrackChange(s);
    if (playing && dismissedFor !== trackUri) open();
  } else if (playing && !wasPlaying && els.np.hidden && dismissedFor !== trackUri) {
    open();
  }
  wasPlaying = playing;
}

function onTrackChange(s) {
  els.title.textContent = s.track;
  els.artist.textContent = s.album ? `${s.artist} · ${s.album}` : s.artist;
  if (s.artwork_url) {
    const src = `/api/artwork?url=${encodeURIComponent(s.artwork_url)}`;
    const img = new Image();
    img.onload = () => {
      els.art.src = src;
      setPalette(extractPalette(img));
    };
    img.onerror = () => setPalette(DEFAULT_PALETTE);
    img.src = src;
  } else {
    els.art.removeAttribute("src");
    setPalette(DEFAULT_PALETTE);
  }

  const M = state.history.months.length;
  const track = byUri.get(s.track_uri) ?? byKey.get(trackKey(s.track, s.artist)) ?? null;
  const firstArtist = s.artist.split(/,\s*|\s+&\s+|\s+feat\.?\s+/i)[0];
  const artist = artistByKey.get(norm(s.artist)) ?? artistByKey.get(norm(firstArtist)) ?? (track && artistByKey.get(norm(track.a))) ?? null;
  const vibe = track?.v ?? artist?.v ?? -1;
  match = {
    track, artist, vibe, mapId: artist?.id ?? -1,
    trackSeries: track ? dense(track.h, M) : null,
    artistSeries: artist ? dense(artist.h, M) : null,
  };

  els.mapLabel.textContent = vibe >= 0 ? api.vibeName(vibe) : "Not on your map yet";
  els.more.hidden = vibe < 0;
  if (track) {
    const peak = match.trackSeries.indexOf(Math.max(...match.trackSeries));
    els.historyLabel.textContent = `${fmtInt(track.p)} plays`;
    els.historyStats.textContent = `First played ${fmtDate(track.f)} · ${fmtHours(track.m)} · peak ${fmtMonth(state.history.months[peak])}${artist ? ` · ${fmtInt(artist.p)} plays of ${artist.n}` : ""}`;
  } else if (artist) {
    els.historyLabel.textContent = "New song, familiar artist";
    els.historyStats.textContent = `First time with this song. You've played ${artist.n} ${fmtInt(artist.p)} times since ${artist.f.slice(0, 4)}.`;
  } else {
    els.historyLabel.textContent = "New to you";
    els.historyStats.textContent = "Not in your listening history yet. Its story starts today.";
  }
  const a = match.mapId >= 0 ? state.graph.artists[match.mapId] : null;
  Object.assign(cam, a ? { tx: a.x, ty: a.y, tk: 2.4 } : { tx: 0.5, ty: 0.5, tk: 1 });
}

// ---------- open / close ----------

const npMode = new URLSearchParams(location.search).get("np");
const hidePill = npMode === "hide";
const autoOpen = npMode !== "off" && !hidePill;

function open(manual = false) {
  if (!manual && (!status || !autoOpen || autoOpenBlocker())) return;
  if (manual && !status && !external) return;
  els.np.hidden = false;
  document.body.style.overflow = "hidden";
  sizeCanvases();
  if (!external && store.get("np-audio", false) && !audio.analyser) startAudio(store.get("np-device", null)).catch(() => updateAudioUi());
  if (!running) {
    running = true;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function close(remember = true) {
  if (external) {
    const done = external.onClose;
    external = null;
    els.np.classList.remove("is-dj");
    $("#np-dj").hidden = true;
    done?.();
    if (status) {
      trackUri = status.track_uri;
      onTrackChange(status);
    } else {
      setPalette(DEFAULT_PALETTE);
    }
    remember = true;
  }
  if (remember) dismissedFor = trackUri;
  els.np.hidden = true;
  document.body.style.overflow = "";
  running = false;
  cancelAnimationFrame(raf);
}

function sizeCanvases() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = els.np.clientWidth, h = els.np.clientHeight;
  els.fx.width = w * dpr;
  els.fx.height = h * dpr;
  const glScale = Math.min(1, 900 / Math.max(w, h)) * Math.min(dpr, 1.5);
  els.gl.width = Math.max(1, Math.round(w * glScale));
  els.gl.height = Math.max(1, Math.round(h * glScale));
  for (const c of [els.map, els.history]) {
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
  }
}

// ---------- colors ----------

function extractPalette(img) {
  const size = 48, c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2]]);

  // k-means, seeded from luminance quantiles so it's deterministic
  const K = 8;
  const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  let centers = d3.range(K).map((k) => [...sorted[Math.floor(((k + 0.5) / K) * sorted.length)]]);
  let counts = new Array(K).fill(0);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(K).fill(0);
    for (const p of px) {
      let best = 0, bd = Infinity;
      centers.forEach((q, k) => {
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bd) { bd = d; best = k; }
      });
      counts[best]++;
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2];
    }
    centers = centers.map((q, k) => (counts[k] ? sums[k].map((s) => s / counts[k]) : q));
  }

  const scored = centers.map((q, k) => {
    const hsl = d3.hsl(d3.rgb(...q));
    // favor vivid, bright colors over large dark areas: a small gold highlight beats a big near-black background
    return { hsl, score: Math.sqrt(counts[k]) * Math.pow(0.05 + (hsl.s || 0), 1.5) * Math.min(1, (hsl.l || 0) * 3) };
  }).sort((a, b) => b.score - a.score);

  // Only colorful clusters count; a grey or near-black cover falls back to the default glow colors.
  const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const chosen = [];
  for (const { hsl } of scored) {
    if (!(hsl.s > 0.1) || hsl.l < 0.06 || hsl.l > 0.96) continue;
    if (chosen.every((o) => hueGap(hsl.h, o.h) > 24)) chosen.push(d3.hsl(hsl.h, Math.max(hsl.s, 0.72), Math.min(0.62, Math.max(0.5, hsl.l))));
    if (chosen.length === 4) break;
  }
  if (!chosen.length) return DEFAULT_PALETTE;
  const offsets = [40, -40, 150];
  for (let i = 0; chosen.length < 4; i++) {
    const base = chosen[0];
    chosen.push(d3.hsl((base.h + offsets[i] + 360) % 360, base.s, base.l));
  }
  return chosen.map((hsl) => {
    const rgb = d3.rgb(hsl);
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  });
}

function setPalette(p) {
  paletteFrom = palette.map((c) => [...c]);
  paletteTo = p;
  paletteT = 0;
}

const vibeRgbCache = new Map();
function vibeRgb(v) {
  if (!vibeRgbCache.has(v)) { const c = d3.rgb(vibeColor(v)); vibeRgbCache.set(v, [c.r / 255, c.g / 255, c.b / 255]); }
  return vibeRgbCache.get(v);
}
const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
function paletteAt(t) {
  const x = ((t % 1) + 1) % 1 * palette.length, i = Math.floor(x), f = x - i;
  const a = palette[i], b = palette[(i + 1) % palette.length];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ---------- audio ----------

async function startAudio(deviceId) {
  stopAudio(false);
  const constraints = (id) => ({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (e) {
    if (!deviceId || e.name === "NotAllowedError") throw e;
    stream = await navigator.mediaDevices.getUserMedia(constraints(null));
  }
  audio.ctx ??= new AudioContext();
  if (audio.ctx.state === "suspended") {
    audio.ctx.resume().catch(() => {});
    document.addEventListener("pointerdown", () => audio.ctx.resume(), { once: true });
  }
  const source = audio.ctx.createMediaStreamSource(stream);
  const analyser = audio.ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -15;
  source.connect(analyser);
  Object.assign(audio, { stream, analyser, freq: new Uint8Array(analyser.frequencyBinCount), wave: new Uint8Array(analyser.fftSize), silentSince: 0 });
  audio.label = stream.getAudioTracks()[0]?.label || "microphone";

  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
  els.device.innerHTML = inputs.map((d, i) => `<option value="${d.deviceId}">${(d.label || `Input ${i + 1}`).replace(/</g, "&lt;")}</option>`).join("");
  if (activeId) els.device.value = activeId;
  updateAudioUi();
}

function stopAudio(updateUi = true) {
  audio.stream?.getTracks().forEach((t) => t.stop());
  Object.assign(audio, { stream: null, analyser: null });
  if (updateUi) updateAudioUi();
}

function updateAudioUi() {
  const on = Boolean(audio.analyser);
  els.audioBtn.textContent = on ? "Stop syncing" : "Sync to sound";
  els.device.hidden = !on;
  els.audioState.textContent = on
    ? /blackhole|loopback|soundflower/i.test(audio.label) ? "Listening to system audio" : "Listening through the mic · pick BlackHole for a cleaner signal"
    : "Reacting to the album colors";
}

function readLevels(now, dt) {
  const reduced = prefersReducedMotion();
  let raw;
  const input = external ?? (audio.analyser ? audio : null);
  if (input) {
    const { analyser, freq, wave } = input;
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    const hz = input.ctx.sampleRate / analyser.fftSize;
    const band = (lo, hi) => {
      let s = 0, n = 0;
      for (let i = Math.max(1, Math.floor(lo / hz)); i <= Math.min(freq.length - 1, Math.ceil(hi / hz)); i++, n++) s += freq[i];
      return n ? s / n / 255 : 0;
    };
    raw = [band(20, 150), band(150, 2000), band(2000, 10000)];
    const bins = levels.spec.length;
    let peak = 0;
    for (let i = 0; i < bins; i++) {
      const lo = 40 * Math.pow(12000 / 40, i / bins), hi = 40 * Math.pow(12000 / 40, (i + 1) / bins);
      const v = band(lo, hi);
      levels.spec[i] += (v - levels.spec[i]) * 0.5;
      peak = Math.max(peak, v);
    }
    levels.specPeak = Math.max(peak, levels.specPeak * 0.997, 0.08);
    pushPitch(detectPitch(wave, input.ctx.sampleRate));

    if (!external) {
      const quiet = raw.every((v) => v < 0.02);
      if (quiet && !audio.silentSince) audio.silentSince = now;
      if (!quiet) audio.silentSince = 0;
      if (audio.silentSince && now - audio.silentSince > 3000) els.audioState.textContent = "No sound picked up yet. Turn the volume up or pick another input.";
      else if (!quiet && /No sound/.test(els.audioState.textContent)) updateAudioUi();
    }

    const flux = Math.max(0, raw[0] - levels.prevBass);
    levels.prevBass = raw[0];
    const hist = levels.flux;
    hist.push(flux);
    if (hist.length > 45) hist.shift();
    const mean = d3.mean(hist), sd = d3.deviation(hist) || 0;
    if (!reduced && flux > mean + 1.5 * sd && flux > 0.015 && now - levels.lastBeat > 230) {
      levels.lastBeat = now;
      levels.beat = 1;
      burst(22);
    }
  } else {
    const pos = currentPosition(), dur = status?.duration_ms || 1;
    const progress = Math.min(1, pos / dur);
    const breath = 0.5 + 0.5 * Math.sin(now * 0.0019);
    raw = [0.22 + 0.22 * breath + 0.3 * progress * progress, 0.3 + 0.15 * Math.sin(now * 0.0011 + 1), 0.18 + 0.12 * Math.sin(now * 0.0027 + 2)];
    for (let i = 0; i < levels.spec.length; i++) {
      const v = 0.18 + 0.14 * Math.sin(i * 0.42 + now * 0.0016) + 0.1 * Math.sin(i * 0.13 - now * 0.0009) + 0.12 * breath * (1 - i / levels.spec.length);
      levels.spec[i] += (v - levels.spec[i]) * 0.1;
    }
    levels.specPeak = 0.6;
    if (!reduced && Math.random() < dt / 900) burst(4);
  }

  const keys = ["bass", "mid", "high"];
  raw.forEach((v, i) => {
    levels.peaks[i] = Math.max(v, levels.peaks[i] * 0.998, 0.05);
    const target = Math.min(1, v / levels.peaks[i]) * (reduced ? 0.35 : 1);
    levels[keys[i]] += (target - levels[keys[i]]) * (target > levels[keys[i]] ? 0.45 : 0.1);
  });
  levels.beat *= Math.pow(0.9, dt / 16.7);
}

function currentPosition() {
  if (!status) return 0;
  const extra = status.state === "playing" ? performance.now() - statusAt : 0;
  return Math.min(status.duration_ms || Infinity, status.position_ms + extra);
}

// ---------- WebGL aurora ----------

const FRAG = `
precision mediump float;
uniform vec2 uRes; uniform float uTime, uBass, uMid, uHigh, uBeat;
uniform vec3 uC0, uC1, uC2, uC3;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * (0.06 + 0.06 * uMid);
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  vec2 r = vec2(fbm(p * 1.8 + q * 2.0 + vec2(1.7, 9.2) + t * 1.2), fbm(p * 1.8 + q * 2.0 + vec2(8.3, 2.8) - t));
  // Each palette color glows in its own noise-shaped region, so colors never average into mud.
  float m0 = smoothstep(0.42, 0.82, fbm(p * 1.2 + r * 1.6 + vec2(0.0, t)));
  float m1 = smoothstep(0.42, 0.82, fbm(p * 1.2 + r * 1.6 + vec2(5.2, -t)));
  float m2 = smoothstep(0.48, 0.88, fbm(p * 1.6 + q * 2.0 + vec2(t, 2.7)));
  float m3 = smoothstep(0.48, 0.88, fbm(p * 1.6 - q * 2.0 + vec2(-t, 7.1)));
  vec3 c = vec3(0.01, 0.01, 0.025);
  c += uC0 * m0 * (0.5 + 0.8 * uBass) + uC1 * m1 * (0.45 + 0.5 * uMid) + uC2 * m2 * 0.5 + uC3 * m3 * (0.3 + 0.6 * uHigh);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = sin(p.x * (1.3 + fi * 0.55) + uTime * (0.14 + fi * 0.06) + r.x * 2.4) * (0.2 + 0.08 * uMid) + (fi - 1.0) * 0.32;
    vec3 rc = fi < 0.5 ? uC1 : (fi < 1.5 ? uC0 : uC3);
    c += rc * (0.003 + 0.012 * uMid) / (abs(p.y - y) + 0.012) * (0.35 + 0.65 * r.y) * 0.4;
  }
  c += uC0 * uBeat * 0.18;
  c *= smoothstep(1.45, 0.15, length(p));
  c = 1.0 - exp(-c * 1.7);
  gl_FragColor = vec4(c, 1.0);
}`;

function initGL(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return null;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(["uRes", "uTime", "uBass", "uMid", "uHigh", "uBeat", "uC0", "uC1", "uC2", "uC3"].map((n) => [n, gl.getUniformLocation(prog, n)]));
    return { gl, u };
  } catch (e) {
    console.warn("WebGL light show unavailable:", e);
    return null;
  }
}

function drawGL(now) {
  const { gl, u } = glr;
  gl.viewport(0, 0, els.gl.width, els.gl.height);
  gl.uniform2f(u.uRes, els.gl.width, els.gl.height);
  gl.uniform1f(u.uTime, (now / 1000) * (prefersReducedMotion() ? 0.35 : 1));
  gl.uniform1f(u.uBass, levels.bass);
  gl.uniform1f(u.uMid, levels.mid);
  gl.uniform1f(u.uHigh, levels.high);
  gl.uniform1f(u.uBeat, levels.beat);
  palette.forEach((c, i) => gl.uniform3f(u[`uC${i}`], ...c));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---------- canvas effects ----------

function artCenter() {
  const r = els.artWrap.getBoundingClientRect(), host = els.np.getBoundingClientRect();
  return { x: (r.left - host.left + r.width / 2) * dpr, y: (r.top - host.top + r.height / 2) * dpr, radius: (r.width / 2) * dpr };
}

function burst(n) {
  const { x, y, radius } = artCenter();
  for (let i = 0; i < n && particles.length < 420; i++) {
    const a = Math.random() * Math.PI * 2, speed = (1.5 + Math.random() * 4.5) * dpr;
    particles.push({
      x: x + Math.cos(a) * radius * 1.1, y: y + Math.sin(a) * radius * 1.1,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life: 0, max: 900 + Math.random() * 1400, size: (1 + Math.random() * 2.6) * dpr, c: paletteAt(Math.random()),
    });
  }
}

// The strongest pitch right now, by autocorrelation on a decimated copy of the waveform —
// cheap enough to run every frame. Returns a MIDI note, or NaN when nothing is really pitched.
const pitchBuf = new Float32Array(512);

function detectPitch(wave, sampleRate) {
  const step = Math.max(1, Math.floor(wave.length / pitchBuf.length));
  const sr = sampleRate / step;
  let energy = 0;
  for (let i = 0; i < pitchBuf.length; i++) {
    let s = 0;
    for (let j = 0; j < step; j++) s += wave[i * step + j] - 128;
    const v = s / (step * 128);
    pitchBuf[i] = v;
    energy += v * v;
  }
  if (energy < 0.02) return NaN;                                  // basically silence

  const minLag = Math.max(2, Math.floor(sr / 1100));              // C6
  const maxLag = Math.min(Math.floor(sr / 65), pitchBuf.length >> 1);   // C2
  const acf = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < pitchBuf.length - lag; i++) sum += pitchBuf[i] * pitchBuf[i + lag];
    acf[lag] = sum / (pitchBuf.length - lag);
  }
  const zero = energy / pitchBuf.length;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) if (acf[lag] > best) best = acf[lag];
  if (best / zero < 0.35) return NaN;                             // noisy or percussive: no note

  // The tallest peak is often an octave down, so take the shortest lag that gets close to it.
  const floorValue = best * 0.85;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] >= floorValue && acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1]) {
      const a = acf[lag - 1], b = acf[lag], c = acf[lag + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c)) || 0;
      return 69 + 12 * Math.log2(sr / (lag + shift) / 440);
    }
  }
  return NaN;
}

function pushPitch(midi) {
  const last = melodyTrail.length ? melodyTrail[melodyTrail.length - 1] : NaN;
  // Ease small wobbles, let real leaps through, so the line glides but still jumps when the tune does.
  const value = Number.isNaN(midi) || Number.isNaN(last) || Math.abs(midi - last) > 2
    ? midi
    : last + (midi - last) * 0.35;
  melodyTrail.push(value);
  if (melodyTrail.length > MELODY_TRAIL) melodyTrail.shift();
}

// A line of the melody across the whole backdrop: time runs left to right, pitch runs up.
function drawMelody(ctx, W, H, now) {
  const voiced = melodyTrail.filter((v) => !Number.isNaN(v));
  const band = H * 0.42, midY = H * 0.5;
  const points = [];
  if (voiced.length > 8) {
    // Ease the window towards the notes in view, so the line uses the height without jittering.
    const lo = Math.min(...voiced), hi = Math.max(...voiced);
    melodyView.lo += (Math.min(lo, hi - 7) - melodyView.lo) * 0.03;
    melodyView.hi += (Math.max(hi, lo + 7) - melodyView.hi) * 0.03;
    const span = Math.max(4, melodyView.hi - melodyView.lo);
    for (let i = 0; i < melodyTrail.length; i++) {
      const v = melodyTrail[i];
      points.push(Number.isNaN(v) ? null : [
        (i / (MELODY_TRAIL - 1)) * W,
        midY + band / 2 - ((v - melodyView.lo) / span) * band,
      ]);
    }
  } else {
    // Nothing pitched yet: a slow breathing wave, so the backdrop never looks broken.
    for (let i = 0; i < MELODY_TRAIL; i++) {
      const t = i / (MELODY_TRAIL - 1);
      points.push([t * W, midY + Math.sin(t * 7 + now * 0.0012) * band * 0.16 * (0.4 + levels.bass)]);
    }
  }

  // Three passes: a wide wash, a soft body, a bright core — it reads as light rather than a chart line.
  for (const pass of [{ w: 22, a: 0.1 }, { w: 7, a: 0.2 }, { w: 2, a: 0.75 }]) {
    ctx.lineWidth = pass.w * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let run = [];
    const stroke = () => {
      if (run.length > 1) {
        const grad = ctx.createLinearGradient(run[0][0], 0, run[run.length - 1][0], 0);
        grad.addColorStop(0, css(palette[2], 0));
        grad.addColorStop(0.25, css(palette[2], pass.a * 0.7));
        grad.addColorStop(1, css(palette[0], pass.a));
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(run[0][0], run[0][1]);
        for (let i = 1; i < run.length; i++) {
          const [px, py] = run[i - 1], [x, y] = run[i];
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);   // round off the corners
        }
        ctx.stroke();
      }
      run = [];
    };
    for (const p of points) p ? run.push(p) : stroke();
    stroke();
  }

  // A head on the newest note, so your eye has something to follow.
  const head = points[points.length - 1];
  if (head) {
    const r = (3 + 5 * levels.bass) * dpr;
    const glow = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], r * 5);
    glow.addColorStop(0, css(palette[0], 0.9));
    glow.addColorStop(1, css(palette[0], 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(head[0], head[1], r * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFx(now, dt) {
  const ctx = fx, W = els.fx.width, H = els.fx.height;
  ctx.globalCompositeOperation = "source-over";
  if (glr) ctx.clearRect(0, 0, W, H);
  else {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, css(palette[0], 0.55 + 0.3 * levels.bass));
    g.addColorStop(0.5, css(palette[2], 0.35));
    g.addColorStop(1, "#05050a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = "lighter";
  drawMelody(ctx, W, H, now);

  const { x: cx, y: cy, radius } = artCenter();
  const R = radius + 14 * dpr, N = levels.spec.length;
  for (const pass of [{ width: 9, alpha: 0.16 }, { width: 2.6, alpha: 0.9 }]) {
    ctx.lineWidth = pass.width * dpr;
    ctx.lineCap = "round";
    for (let i = 0; i < N; i++) {
      const v = Math.min(1, levels.spec[i] / levels.specPeak);
      const len = (4 + v * 70 * (0.7 + 0.5 * levels.bass)) * dpr;
      const c = paletteAt(i / N);
      ctx.strokeStyle = css(c, pass.alpha);
      for (const side of [1, -1]) {
        const a = -Math.PI / 2 + side * ((i + 0.5) / N) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len));
        ctx.stroke();
      }
    }
  }

  ctx.beginPath();
  const samples = 180;
  for (let i = 0; i <= samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    let v;
    const input = external ?? (audio.analyser ? audio : null);
    if (input) v = (input.wave[Math.floor((i / samples) * (input.wave.length - 1))] - 128) / 128;
    else v = 0.25 * Math.sin(a * 6 + now * 0.002) * (0.4 + levels.bass);
    const rr = radius + 5 * dpr + v * 16 * dpr;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.strokeStyle = css(palette[1], 0.55);
  ctx.lineWidth = 1.6 * dpr;
  ctx.stroke();

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life > p.max) { particles.splice(i, 1); continue; }
    const k = dt / 16.7;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.vx *= Math.pow(0.985, k);
    p.vy *= Math.pow(0.985, k);
    const alpha = Math.sin((p.life / p.max) * Math.PI) * (0.5 + 0.5 * levels.high);
    ctx.fillStyle = css(p.c, alpha * 0.25);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(p.c, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- live graphs ----------

function drawMap(dt) {
  const c = els.map, ctx = c.getContext("2d"), W = c.width, H = c.height;
  if (!W) return;
  ctx.clearRect(0, 0, W, H);
  const ease = 1 - Math.exp(-dt / 700);
  cam.x += (cam.tx - cam.x) * ease;
  cam.y += (cam.ty - cam.y) * ease;
  cam.k += (cam.tk - cam.k) * ease;
  const X = (a) => (a.x - cam.x) * W * 0.85 * cam.k + W / 2, Y = (a) => (a.y - cam.y) * H * 0.8 * cam.k + H / 2;
  const artists = state.graph.artists, maxM = artists[0]?.minutes || 1;
  const focus = match?.mapId ?? -1, vibe = match?.vibe ?? -1;
  ctx.globalCompositeOperation = "lighter";

  if (focus >= 0) {
    for (const n of state.neighbors.get(focus) ?? []) {
      const b = artists[n.id], a = artists[focus];
      ctx.strokeStyle = css(palette[1], 0.15 + 0.6 * n.w);
      ctx.lineWidth = (0.6 + 2 * n.w + levels.bass) * dpr;
      ctx.beginPath();
      ctx.moveTo(X(a), Y(a));
      ctx.lineTo(X(b), Y(b));
      ctx.stroke();
    }
  }
  const near = new Set(focus >= 0 ? (state.neighbors.get(focus) ?? []).map((n) => n.id) : []);
  for (const a of artists) {
    const x = X(a), y = Y(a);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const r = (1.2 + 5 * Math.sqrt(a.minutes / maxM)) * dpr * Math.sqrt(cam.k);
    const inVibe = a.vibe === vibe;
    const col = near.has(a.id) ? palette[1] : inVibe ? palette[2] : vibeRgb(a.vibe);
    const alpha = near.has(a.id) ? 0.95 : inVibe ? 0.7 : vibe >= 0 ? 0.14 : 0.45;
    if (inVibe || near.has(a.id)) {
      ctx.fillStyle = css(col, alpha * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = css(col, alpha);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (focus >= 0) {
    const a = artists[focus], x = X(a), y = Y(a);
    const pulse = (10 + 10 * levels.bass + 14 * levels.beat) * dpr;
    ctx.strokeStyle = css(palette[0], 0.9);
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = css(palette[0], 1);
    ctx.beginPath();
    ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.font = `600 ${12 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = x > W * 0.7 ? "right" : "left";
    ctx.fillText(a.name, x + (x > W * 0.7 ? -1 : 1) * (pulse + 6 * dpr), y + 4 * dpr);
  } else {
    ctx.globalCompositeOperation = "source-over";
  }
}

function drawHistory(now) {
  const c = els.history, ctx = c.getContext("2d"), W = c.width, H = c.height;
  if (!W) return;
  ctx.clearRect(0, 0, W, H);
  const months = state.history.months, M = months.length;
  const pad = { l: 4 * dpr, r: 12 * dpr, t: 10 * dpr, b: 16 * dpr };
  const X = (i) => pad.l + (i / Math.max(1, M - 1)) * (W - pad.l - pad.r);
  const base = H - pad.b;

  ctx.font = `${10 * dpr}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.textAlign = "center";
  const step = M > 60 ? 2 : 1;
  months.forEach((m, i) => { if (m.endsWith("-01") && +m.slice(0, 4) % step === 0) ctx.fillText(m.slice(0, 4), X(i), H - 3 * dpr); });

  const area = (series, color, alpha, height) => {
    const max = Math.max(...series) || 1;
    ctx.beginPath();
    ctx.moveTo(X(0), base);
    series.forEach((v, i) => ctx.lineTo(X(i), base - (v / max) * height));
    ctx.lineTo(X(M - 1), base);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, base - height, 0, base);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.fill();
    return max;
  };
  const line = (series, max, color, height) => {
    ctx.beginPath();
    series.forEach((v, i) => (i ? ctx.lineTo(X(i), base - (v / max) * height) : ctx.moveTo(X(i), base - (v / max) * height)));
    for (const [w, a] of [[7, 0.18], [2, 0.95]]) {
      ctx.lineWidth = w * dpr;
      ctx.strokeStyle = css(color, a);
      ctx.stroke();
    }
  };
  const height = H - pad.t - pad.b;
  ctx.globalCompositeOperation = "lighter";
  if (match?.artistSeries) area(match.artistSeries, palette[2], 0.35, height * 0.75);
  if (match?.trackSeries) {
    const max = area(match.trackSeries, palette[0], 0.5, height);
    line(match.trackSeries, max, palette[0], height);
    const first = match.trackSeries.findIndex((v) => v > 0);
    const peak = match.trackSeries.indexOf(max);
    for (const [i, label] of [[first, "first"], [peak, "peak"]]) {
      const x = X(i), y = base - (match.trackSeries[i] / max) * height;
      ctx.fillStyle = css(palette[1], 0.95);
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.textAlign = x > W * 0.8 ? "right" : "left";
      ctx.fillText(label, x + (x > W * 0.8 ? -6 : 6) * dpr, Math.max(pad.t + 8 * dpr, y - 6 * dpr));
      ctx.globalCompositeOperation = "lighter";
    }
  } else {
    const y = base - 2 * dpr;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    palette.forEach((p, i) => g.addColorStop(i / (palette.length - 1), css(p, 0.7)));
    ctx.strokeStyle = g;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(0), y);
    ctx.lineTo(X(M - 1), y);
    ctx.stroke();
  }
  const pulse = (3 + 4 * levels.bass + 5 * levels.beat + Math.sin(now * 0.004)) * dpr;
  ctx.fillStyle = css(palette[3], 0.9);
  ctx.beginPath();
  ctx.arc(X(M - 1), base - 2 * dpr, pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// ---------- frame loop ----------

function frame(now) {
  if (!running) return;
  const dt = Math.min(50, now - lastFrame);
  lastFrame = now;
  if (els.fx.width !== Math.round(els.np.clientWidth * Math.min(2, window.devicePixelRatio || 1)) || els.map.width !== Math.round(els.map.clientWidth * dpr)) sizeCanvases();

  if (paletteT < 1) {
    paletteT = Math.min(1, paletteT + dt / 1500);
    const e = paletteT * paletteT * (3 - 2 * paletteT);
    palette = paletteFrom.map((a, i) => a.map((v, j) => v + (paletteTo[i][j] - v) * e));
    els.np.style.setProperty("--np-c0", css(palette[0]));
    els.np.style.setProperty("--np-c1", css(palette[1], 0.7));
  }

  readLevels(now, dt);
  if (glr) drawGL(now);
  drawFx(now, dt);
  if (!external) {
    drawMap(dt);
    drawHistory(now);
  }

  if (external) els.progress.style.width = `${100 * (external.progress?.() ?? 0)}%`;
  else {
    const dur = status?.duration_ms || 0;
    els.progress.style.width = dur ? `${(100 * currentPosition()) / dur}%` : "0";
  }
  els.artWrap.style.transform = prefersReducedMotion() ? "" : `scale(${1 + levels.bass * 0.035 + levels.beat * 0.03})`;
  raf = requestAnimationFrame(frame);
}
