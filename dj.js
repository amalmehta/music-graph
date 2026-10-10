// DJ tab: two decks with beat-matching, key lock, EQ, filters, loops and hot cues, a crossfader,
// WAV recording, and a full-screen mode that drives the Now Playing light show.

import { trackKey, escapeHtml, fmtInt, vibeColor, store, toast, postJSON } from "./util.js";
import * as NowPlaying from "./nowplaying.js";
import * as Spotify from "./spotify.js";

const $ = (s, root = document) => root.querySelector(s);
const DECK_COLORS = { A: "#ff4f8b", B: "#35d0c0" };
const LOOPS = [1, 2, 4, 8, 16];
const MAX_RECORD_SECONDS = 90 * 60;
const RECORDER = `
class DjRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.active = true; this.port.onmessage = () => { this.active = false; }; }
  process(inputs) {
    const input = inputs[0];
    if (this.active && input && input.length) {
      const l = input[0], r = input[1] || input[0], out = new Int16Array(l.length * 2);
      for (let i = 0; i < l.length; i++) {
        out[2 * i] = Math.max(-1, Math.min(1, l[i])) * 32767;
        out[2 * i + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
      }
      this.port.postMessage(out, [out.buffer]);
    }
    return this.active;
  }
}
registerProcessor("dj-recorder", DjRecorder);`;

let api, state;
let ctx = null, masterGain = null, analyser = null;
const decks = {};
let xfade = 0.5, masterVolume = 0.9;
let crate = { tracks: [], dir: "", loaded: false }, dropped = [], crateSource = "folder", crateQuery = "";
let playlists = null;            // the user's Spotify playlists, once fetched
let playlist = null;             // { id, name, tracks } currently shown in the crate
let playlistError = "";
let crateByKey = new Map();      // title|artist -> the audio file you own, so a playlist knows what is mixable
let setList = [];                // what you actually loaded onto a deck, in order
let historyByKey = new Map();
let recording = null, recorderReady = false;
let rafId = 0, fullscreen = false, lastHud = 0, lastPaletteKey = "";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const frac = (v) => v - Math.floor(v);
const fmtTime = (s, tenths = false) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), sec = s - m * 60;
  return tenths ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(sec)).padStart(2, "0")}`;
};

function camelotColor(code) {
  const n = parseInt(code, 10);
  if (!n) return "var(--faint)";
  return d3.hsl(((n - 1) * 30 + 10) % 360, 0.75, code.endsWith("A") ? 0.5 : 0.62).formatHex();
}

// ---------- audio graph ----------

function audio() {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: "interactive" });
  masterGain = ctx.createGain();
  masterGain.gain.value = masterVolume;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -15;
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);
  Object.values(decks).forEach((d) => d.connect());
  applyCrossfader();
  return ctx;
}

function biquad(type, frequency, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  if (q) f.Q.value = q;
  return f;
}

function applyCrossfader() {
  if (!ctx) return;
  const t = ctx.currentTime;
  decks.A.xf.gain.setTargetAtTime(Math.cos((xfade * Math.PI) / 2), t, 0.01);
  decks.B.xf.gain.setTargetAtTime(Math.sin((xfade * Math.PI) / 2), t, 0.01);
}

const trackStore = () => store.get("dj-tracks", {});
function saveTrack(deck) {
  if (!deck.meta) return;
  const all = trackStore();
  all[deck.meta.cacheKey] = {
    bpm: deck.analysis?.bpm, firstBeat: deck.analysis?.firstBeat, key: deck.analysis?.key, camelot: deck.analysis?.camelot,
    cue: deck.cue, hot: deck.hot, at: Date.now(),
  };
  const keys = Object.keys(all);
  if (keys.length > 500) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 500).forEach((k) => delete all[k]);
  store.set("dj-tracks", all);
}

// ---------- deck ----------

class Deck {
  constructor(id) {
    Object.assign(this, {
      id, color: DECK_COLORS[id], buffer: null, meta: null, analysis: null, token: 0, loading: false,
      rate: 1, range: 0.08, nudge: 0, pos: 0, playing: false, source: null, sourceGain: null, startedAt: 0, startPos: 0, scale: 1,
      cue: 0, hot: [null, null, null, null], loop: null,
      keylock: store.get("dj-keylock", true), stretched: null, stretching: false, stretchTimer: 0,
      eq: { high: 0, mid: 0, low: 0 }, filter: 0, volume: 0.9, overviewCache: null, melodyCache: null,
    });
    this.worker = new Worker("djworker.js");
    this.jobs = new Map();
    this.jobId = 0;
    this.worker.onmessage = (e) => {
      const job = this.jobs.get(e.data.id);
      if (!job) return;
      this.jobs.delete(e.data.id);
      e.data.ok ? job.resolve(e.data.result) : job.reject(new Error(e.data.error));
    };
  }

  run(type, payload, transfer) {
    const id = ++this.jobId;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, ...payload }, transfer);
    });
  }

  connect() {
    this.input = ctx.createGain();
    this.low = biquad("lowshelf", 220);
    this.mid = biquad("peaking", 1000, 0.8);
    this.high = biquad("highshelf", 3500);
    this.filterNode = biquad("lowpass", 22000, 0.7);
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.meterData = new Float32Array(512);
    this.input.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.filterNode);
    this.filterNode.connect(this.fader);
    this.fader.connect(this.xf);
    this.xf.connect(masterGain);
    this.fader.connect(this.meter);
    this.fader.gain.value = this.volume;
    this.applyEq();
    this.applyFilter();
  }

  get duration() { return this.buffer?.duration ?? 0; }
  get bpm() { return this.analysis ? this.analysis.bpm * this.rate : 0; }
  effRate() { return this.rate * (1 + this.nudge); }
  beatLen() { return 60 / this.analysis.bpm; }
  beatIndex(p) { return (p - this.analysis.firstBeat) / this.beatLen(); }
  snap(p, round = Math.round) { return this.analysis.firstBeat + round(this.beatIndex(p)) * this.beatLen(); }

  position() {
    if (!this.playing || !ctx) return this.pos;
    let p = this.startPos + (ctx.currentTime - this.startedAt) * this.effRate();
    if (this.loop && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % (this.loop.end - this.loop.start));
    return Math.min(p, this.duration);
  }

  // Re-anchor the position clock before anything that changes how it advances.
  retime() {
    this.pos = this.position();
    this.startPos = this.pos;
    this.startedAt = ctx ? ctx.currentTime : 0;
  }

  startSource() {
    const useStretch = this.keylock && this.stretched && Math.abs(this.stretched.ratio - this.rate) < 0.04;
    const buffer = useStretch ? this.stretched.buffer : this.buffer;
    this.scale = useStretch ? this.stretched.ratio : 1;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = this.effRate() / this.scale;
    if (this.loop) Object.assign(src, { loop: true, loopStart: this.loop.start / this.scale, loopEnd: this.loop.end / this.scale });
    src.connect(gain);
    gain.connect(this.input);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.008);
    src.start(t, clamp(this.pos, 0, this.duration - 0.01) / this.scale);
    src.onended = () => {
      if (this.source !== src) return;
      this.playing = false;
      this.pos = this.duration;
      this.source = null;
      this.render();
    };
    this.fadeOut();
    Object.assign(this, { source: src, sourceGain: gain, startedAt: t, startPos: this.pos });
  }

  fadeOut() {
    const { source, sourceGain } = this;
    if (!source) return;
    source.onended = null;
    const t = ctx.currentTime;
    sourceGain.gain.cancelScheduledValues(t);
    sourceGain.gain.setValueAtTime(sourceGain.gain.value, t);
    sourceGain.gain.linearRampToValueAtTime(0, t + 0.008);
    source.stop(t + 0.012);
    this.source = null;
  }

  async load(item) {
    audio();
    const token = ++this.token;
    if (this.playing) this.fadeOut();
    Object.assign(this, {
      playing: false, loading: true, meta: item, buffer: null, analysis: null, stretched: null, loop: null,
      pos: 0, cue: 0, rate: 1, nudge: 0, hot: [null, null, null, null], overviewCache: null, melodyCache: null,
    });
    this.render();
    try {
      const bytes = item.file
        ? await item.file.arrayBuffer()
        : await fetch(`/api/crate/file?id=${encodeURIComponent(item.id)}`).then((r) => {
          if (!r.ok) throw new Error(`the server couldn't read the file (${r.status})`);
          return r.arrayBuffer();
        });
      const buffer = await ctx.decodeAudioData(bytes);
      if (token !== this.token) return;
      this.buffer = buffer;
      noteSet(item);
      item.duration ??= buffer.duration;
      const saved = trackStore()[item.cacheKey];
      if (saved?.hot) this.hot = saved.hot;
      this.render();

      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
      }
      const analysis = await this.run("analyze", { mono, sampleRate: buffer.sampleRate }, [mono.buffer]);
      if (token !== this.token) return;
      if (saved?.bpm) Object.assign(analysis, { bpm: saved.bpm, firstBeat: saved.firstBeat ?? analysis.firstBeat });
      this.analysis = analysis;
      this.cue = saved?.cue ?? analysis.firstBeat;
      if (!this.playing) this.pos = this.cue;
      saveTrack(this);
      renderCrate();
    } catch (e) {
      if (token !== this.token) return;
      const reason = e.name === "EncodingError" ? "this format can't be decoded here (it may be DRM-protected)" : e.message;
      toast(`Couldn't load “${item.title}”: ${reason}`, { error: true });
      this.meta = null;
      this.buffer = null;
    } finally {
      if (token === this.token) {
        this.loading = false;
        this.render();
      }
    }
  }

  togglePlay() {
    if (!this.buffer) return;
    audio().resume();
    if (this.playing) {
      this.pos = this.position();
      this.playing = false;
      this.fadeOut();
    } else {
      if (this.pos >= this.duration - 0.05) this.pos = 0;
      const other = decks[this.id === "A" ? "B" : "A"];
      if (this.synced && other.playing && this.analysis && other.analysis) this.pos = this.alignedPosition(other); // stay in phase after a paused sync
      this.playing = true;
      this.startSource();
    }
    this.render();
  }

  seek(p) {
    if (!this.buffer) return;
    this.pos = clamp(p, 0, this.duration - 0.01);
    if (this.loop && (this.pos < this.loop.start || this.pos >= this.loop.end)) this.loop = null;
    if (this.playing) this.startSource();
    this.render();
  }

  pressCue() {
    if (!this.buffer) return;
    if (this.playing) {
      this.togglePlay();
      this.seek(this.cue);
    } else {
      this.cue = this.analysis ? this.snap(this.pos) : this.pos;
      this.pos = this.cue;
      saveTrack(this);
      this.render();
    }
  }

  hotCue(i, clear) {
    if (!this.buffer) return;
    if (clear) this.hot[i] = null;
    else if (this.hot[i] == null) this.hot[i] = this.analysis ? this.snap(this.position()) : this.position();
    else this.seek(this.hot[i]);
    saveTrack(this);
    this.render();
  }

  setRate(rate) {
    if (ctx && this.playing) this.retime();
    this.rate = rate;
    if (this.source) this.source.playbackRate.value = this.effRate() / this.scale;
    this.scheduleStretch();
    this.render();
  }

  setNudge(amount) {
    if (ctx && this.playing) this.retime();
    this.nudge = amount;
    if (this.source) this.source.playbackRate.value = this.effRate() / this.scale;
  }

  // With key lock on, render a pitch-preserving copy at the new tempo once the fader settles.
  scheduleStretch() {
    clearTimeout(this.stretchTimer);
    if (!this.buffer) return;
    if (!this.keylock || Math.abs(this.rate - 1) < 0.002) {
      const wasStretched = this.scale !== 1;
      this.stretched = null;
      if (this.playing && wasStretched) this.restart();
      return;
    }
    if (this.stretched && Math.abs(this.stretched.ratio - this.rate) < 0.0005) return;
    this.stretchTimer = setTimeout(async () => {
      const ratio = this.rate, token = this.token, buffer = this.buffer;
      this.stretching = true;
      this.render();
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
      try {
        const { channels: out } = await this.run("stretch", { channels, ratio }, channels.map((c) => c.buffer));
        if (token !== this.token || Math.abs(ratio - this.rate) > 0.0005 || !this.keylock) return;
        const stretched = ctx.createBuffer(out.length, out[0].length, buffer.sampleRate);
        out.forEach((c, i) => stretched.copyToChannel(c, i));
        this.stretched = { ratio, buffer: stretched };
        if (this.playing) this.restart();
      } catch (e) {
        toast(`Key lock failed: ${e.message}`, { error: true });
      } finally {
        if (token === this.token && Math.abs(ratio - this.rate) < 0.0005) {
          this.stretching = false;
          this.render();
        }
      }
    }, 450);
  }

  restart() {
    this.pos = this.position();
    this.startSource();
  }

  toggleKeylock() {
    this.keylock = !this.keylock;
    store.set("dj-keylock", this.keylock);
    this.stretching = false;
    this.scheduleStretch();
    if (!this.keylock && this.playing && this.scale !== 1) this.restart();
    this.render();
  }

  sync() {
    const other = decks[this.id === "A" ? "B" : "A"];
    if (!this.analysis || !other.analysis) return toast("Load a track on both decks first, then sync.");
    let target = other.bpm / this.analysis.bpm;
    target = [1, 2, 0.5].map((f) => target * f).sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1))[0];
    if (Math.abs(target - 1) > 0.16) return toast(`Tempos are too far apart to sync (${this.analysis.bpm.toFixed(1)} vs ${other.bpm.toFixed(1)} BPM)`);
    if (Math.abs(target - 1) > this.range) this.range = 0.16;
    this.setRate(target);
    this.synced = true;
    this.seek(this.alignedPosition(other));
  }

  // Nearest position whose beat phase matches the other deck right now.
  alignedPosition(other) {
    const p = this.position();
    let delta = frac(other.beatIndex(other.position())) - frac(this.beatIndex(p));
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    return clamp(p + delta * this.beatLen(), 0, this.duration - 0.01);
  }

  toggleLoop(beats) {
    if (!this.analysis) return;
    if (this.loop?.beats === beats) return this.exitLoop();
    if (this.playing) this.retime();
    const p = this.pos;
    const start = this.loop ? this.loop.start : this.snap(p, Math.floor);
    const end = start + beats * this.beatLen();
    if (end > this.duration) return toast("Not enough track left for that loop");
    this.loop = { start, end, beats };
    if (this.playing) {
      if (p >= end) this.seek(start);
      else if (this.source) Object.assign(this.source, { loopStart: start / this.scale, loopEnd: end / this.scale, loop: true });
    }
    this.render();
  }

  exitLoop() {
    if (this.playing) this.retime();
    this.loop = null;
    if (this.source) this.source.loop = false;
    this.render();
  }

  fixBpm(factor) {
    if (!this.analysis) return;
    this.analysis.bpm *= factor;
    saveTrack(this);
    this.render();
    renderCrate();
  }

  applyEq() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const band of ["low", "mid", "high"]) {
      const v = this.eq[band];
      this[band].gain.setTargetAtTime(v <= -0.99 ? -40 : v < 0 ? v * 26 : v * 6, t, 0.01);
    }
  }

  applyFilter() {
    if (!ctx) return;
    const v = this.filter, f = this.filterNode, t = ctx.currentTime;
    if (v < -0.02) {
      f.type = "lowpass";
      f.Q.value = 1.1;
      f.frequency.setTargetAtTime(20000 * Math.pow(0.005, -v), t, 0.015);
    } else if (v > 0.02) {
      f.type = "highpass";
      f.Q.value = 1.1;
      f.frequency.setTargetAtTime(20 * Math.pow(300, v), t, 0.015);
    } else {
      f.type = "lowpass";
      f.Q.value = 0.7;
      f.frequency.setTargetAtTime(22000, t, 0.015);
    }
  }

  // ---------- deck UI ----------

  render() {
    const el = $(`#deck-${this.id}`), q = (f) => $(`[data-f="${f}"]`, el);
    const m = this.meta, a = this.analysis;
    q("title").textContent = m ? m.title : "Drop a track here";
    q("artist").textContent = m ? m.artist || "Unknown artist" : "or load one from the crate below";
    q("bpm").textContent = a ? this.bpm.toFixed(1) : "—";
    const key = q("key");
    key.hidden = !a;
    if (a) {
      key.textContent = a.camelot;
      key.title = a.key;
      key.style.background = camelotColor(a.camelot);
    }
    q("orig").textContent = a ? `${a.key} · ${a.bpm.toFixed(1)} original${this.rate !== 1 ? ` · ${this.rate > 1 ? "+" : ""}${((this.rate - 1) * 100).toFixed(1)}%` : ""}` : "";
    const hist = m && historyByKey.get(trackKey(m.title, m.artist));
    q("history").innerHTML = hist ? `<span class="swatch" style="background:${vibeColor(hist.v)}"></span>${fmtInt(hist.p)} Spotify plays` : "";
    q("status").textContent = this.loading ? (this.buffer ? "Analyzing…" : "Loading…") : this.stretching ? "Key lock: stretching…" : "";

    $("[data-act=play]", el).textContent = this.playing ? "❚❚" : "▶";
    $("[data-act=play]", el).classList.toggle("on", this.playing);
    $("[data-act=keylock]", el).setAttribute("aria-pressed", String(this.keylock));
    $("[data-act=range]", el).textContent = `±${Math.round(this.range * 100)}%`;
    el.querySelectorAll("[data-hot]").forEach((b) => b.classList.toggle("set", this.hot[+b.dataset.hot] != null));
    el.querySelectorAll("[data-loop]").forEach((b) => b.classList.toggle("on", this.loop?.beats === +b.dataset.loop));
    const tempo = q("tempo");
    if (document.activeElement !== tempo) tempo.value = String(clamp((this.rate - 1) / this.range, -1, 1));
    el.classList.toggle("empty", !this.buffer);
    el.classList.toggle("playing", this.playing);
  }

  drawOverview(now) {
    const canvas = $(`#deck-${this.id} [data-f="overview"]`);
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (!W) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; this.overviewCache = null; }
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, W, H);
    if (!this.analysis) {
      if (this.loading) {
        g.fillStyle = this.color;
        g.globalAlpha = 0.25 + 0.2 * Math.sin(now / 200);
        g.fillRect(0, H / 2 - 1, W, 2);
        g.globalAlpha = 1;
      }
      return;
    }
    if (!this.overviewCache) {
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      drawBands(off.getContext("2d"), this.analysis.overview, W, H, (x) => Math.floor((x / W) * this.analysis.overview.peak.length), this.color);
      this.overviewCache = off;
    }
    g.drawImage(this.overviewCache, 0, 0);
    const X = (t) => (t / this.duration) * W;
    const p = this.position();
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, X(p), H);
    if (this.loop) {
      g.fillStyle = "rgba(255,210,80,0.3)";
      g.fillRect(X(this.loop.start), 0, Math.max(2, X(this.loop.end) - X(this.loop.start)), H);
    }
    g.fillStyle = "#ffb03a";
    g.fillRect(X(this.cue) - dpr, 0, 2 * dpr, H);
    this.hot.forEach((t, i) => {
      if (t == null) return;
      g.fillStyle = ["#ff4f8b", "#35d0c0", "#8b7bff", "#6fdc5c"][i];
      g.beginPath();
      g.moveTo(X(t) - 5 * dpr, 0);
      g.lineTo(X(t) + 5 * dpr, 0);
      g.lineTo(X(t), 7 * dpr);
      g.fill();
    });
    g.fillStyle = "#fff";
    g.fillRect(X(p) - dpr, 0, 2 * dpr, H);
    this.drawMelody();
  }

  // The tune as a line: high notes near the top, gaps where nothing is pitched.
  drawMelody() {
    const canvas = $(`#deck-${this.id} [data-f="melody"]`);
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (!W) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; this.melodyCache = null; }
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, W, H);
    const midi = this.analysis?.melody?.midi;
    if (!midi?.length) return;

    if (!this.melodyCache) {
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      drawMelodyLine(off.getContext("2d"), midi, W, H, dpr, this.color);
      this.melodyCache = off;
    }
    g.drawImage(this.melodyCache, 0, 0);
    const x = (this.position() / this.duration) * W;
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(0, 0, x, H);                      // what you have played dims, so the shape ahead stands out
    g.fillStyle = "#fff";
    g.fillRect(x - dpr, 0, 2 * dpr, H);
  }
}

// Scaled to the notes the track actually uses, so a bassline and a topline both fill the strip.
function drawMelodyLine(g, midi, W, H, dpr, color) {
  let lo = Infinity, hi = -Infinity;
  for (const v of midi) if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || hi - lo < 1) return;
  const pad = 3 * dpr;
  const Y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);

  // One column per pixel: the median of the frames landing on it, so the line stays readable when zoomed out.
  const column = new Float32Array(W).fill(NaN);
  const per = midi.length / W;
  const bucket = [];
  for (let x = 0; x < W; x++) {
    bucket.length = 0;
    for (let i = Math.floor(x * per); i < Math.min(midi.length, Math.ceil((x + 1) * per)); i++) {
      if (!Number.isNaN(midi[i])) bucket.push(midi[i]);
    }
    if (bucket.length) {
      bucket.sort((a, b) => a - b);
      column[x] = bucket[bucket.length >> 1];
    }
  }

  // A soft wash under the line gives the rises and falls some weight.
  const fill = g.createLinearGradient(0, 0, 0, H);
  fill.addColorStop(0, `${d3.color(color).copy({ opacity: 0.35 })}`);
  fill.addColorStop(1, `${d3.color(color).copy({ opacity: 0.02 })}`);
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      g.beginPath();
      g.moveTo(run[0][0], H);
      for (const [x, y] of run) g.lineTo(x, y);
      g.lineTo(run[run.length - 1][0], H);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.beginPath();
      g.moveTo(run[0][0], run[0][1]);
      for (const [x, y] of run) g.lineTo(x, y);
      g.strokeStyle = color;
      g.lineWidth = 1.6 * dpr;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.shadowColor = color;
      g.shadowBlur = 6 * dpr;
      g.stroke();
      g.shadowBlur = 0;
    }
    run = [];
  };
  for (let x = 0; x < W; x++) {
    if (Number.isNaN(column[x])) flush();
    else run.push([x, Y(column[x])]);
  }
  flush();
}

// Colored waveform: amplitude from the peak, color from the balance of low / mid / high energy.
function drawBands(g, bands, W, H, indexAt, lowColor) {
  const low = d3.rgb(lowColor), mid = d3.rgb("#ffb03a"), high = d3.rgb("#ffffff");
  for (let x = 0; x < W; x++) {
    const i = indexAt(x);
    if (i < 0 || i >= bands.peak.length) continue;
    const l = bands.low[i], m = bands.mid[i], h = bands.high[i], sum = l + m + h || 1;
    const r = (l * low.r + m * mid.r + h * high.r) / sum, gg = (l * low.g + m * mid.g + h * high.g) / sum, b = (l * low.b + m * mid.b + h * high.b) / sum;
    const amp = bands.peak[i] * H * 0.48;
    g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
    g.fillRect(x, H / 2 - amp, 1, amp * 2);
  }
}

// Both decks' waveforms scrolling past a shared playhead, beat grids aligned when synced.
function drawDualWave(canvas, now) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, W, H);
  const lane = H / 2, windowSeconds = 8;
  ["A", "B"].forEach((id, row) => {
    const d = decks[id], top = row * lane;
    g.save();
    g.translate(0, top);
    g.fillStyle = "rgba(255,255,255,0.03)";
    g.fillRect(0, 0, W, lane);
    if (d.analysis) {
      const p = d.position(), secPerPx = (windowSeconds * d.effRate()) / W, det = d.analysis.detail, rate = d.analysis.detailRate;
      if (d.loop) {
        const x0 = W / 2 + (d.loop.start - p) / secPerPx, x1 = W / 2 + (d.loop.end - p) / secPerPx;
        g.fillStyle = "rgba(255,210,80,0.16)";
        g.fillRect(x0, 0, x1 - x0, lane);
      }
      drawBands(g, det, W, lane, (x) => Math.floor((p + (x - W / 2) * secPerPx) * rate), d.color);
      const bl = d.beatLen(), first = Math.ceil(d.beatIndex(p - (W / 2) * secPerPx));
      for (let k = first; ; k++) {
        const t = d.analysis.firstBeat + k * bl, x = W / 2 + (t - p) / secPerPx;
        if (x > W) break;
        const bar = ((k % 4) + 4) % 4 === 0;
        g.fillStyle = bar ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
        g.fillRect(x, 0, bar ? 2 * dpr : dpr, bar ? lane : lane * 0.18);
      }
      // phase: four cells showing where in the bar this deck is
      const beat = ((Math.floor(d.beatIndex(p)) % 4) + 4) % 4;
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i === beat && d.playing ? d.color : "rgba(255,255,255,0.18)";
        g.fillRect(8 * dpr + i * 14 * dpr, lane - 10 * dpr, 11 * dpr, 4 * dpr);
      }
      g.font = `600 ${11 * dpr}px Inter, system-ui, sans-serif`;
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.fillText(`${id} · ${d.bpm.toFixed(1)} BPM`, 8 * dpr, 16 * dpr);
    } else {
      g.font = `${11 * dpr}px Inter, system-ui, sans-serif`;
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillText(d.loading ? `${id} · loading…` : `${id} · empty`, 8 * dpr, 16 * dpr);
    }
    g.restore();
  });
  g.fillStyle = "#fff";
  g.fillRect(W / 2 - dpr, 0, 2 * dpr, H);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(0, lane - dpr / 2, W, dpr);
}

// ---------- crate ----------

function crateItems() {
  const saved = trackStore();
  const q = crateQuery.trim().toLowerCase();
  const matches = (t) => !q || `${t.title} ${t.artist} ${t.album ?? ""}`.toLowerCase().includes(q);
  if (crateSource === "spotify") {
    return (playlist?.tracks ?? []).filter(matches).map((t) => {
      const owned = ownedFile(t);
      // BPM and key come from the file you own, analysed the last time it was on a deck.
      return { ...t, owned, cacheKey: owned?.cacheKey, id: owned?.id, saved: owned && saved[owned.cacheKey] };
    });
  }
  return (crateSource === "folder" ? crate.tracks : dropped)
    .filter(matches)
    .map((t) => ({ ...t, saved: saved[t.cacheKey] }));
}

function emptyCrateNote() {
  if (crateSource === "folder") return crate.loaded ? "No audio files match." : "";
  if (crateSource === "dropped") return "";
  if (playlistError && playlistError !== "connect") return "";
  return playlist && playlist.tracks ? "Nothing in this playlist matches." : "";
}

// ---------- Spotify playlists ----------

const CAMELOT = /^(\d{1,2})([AB])$/;

// Harmonic mixing, the usual Camelot wheel rules: same key, its relative major or minor,
// or one step around the wheel.
function mixesWith(a, b) {
  const x = CAMELOT.exec(a || ""), y = CAMELOT.exec(b || "");
  if (!x || !y) return false;
  const [n, m] = [+x[1], +y[1]];
  if (n === m) return true;                                  // same number: same key or its relative
  return x[2] === y[2] && (m === (n % 12) + 1 || n === (m % 12) + 1);
}

function ownedFile(track) {
  return crateByKey.get(trackKey(track.title, track.artist));
}

async function openPlaylists() {
  playlistError = "";
  if (!Spotify.configured()) {
    playlistError = "Add a Spotify Client ID in the ⚙ panel first.";
  } else if (!Spotify.connected()) {
    playlistError = "connect";
  } else if (!playlists) {
    try {
      playlists = await Spotify.listPlaylists();
    } catch (e) {
      playlists = null;
      playlistError = e.message;
    }
  }
  fillPlaylistPicker();
  renderCrate();
  if (playlists?.length && !playlist) choosePlaylist(playlists[0].id);
}

function fillPlaylistPicker() {
  const sel = $("#crate-playlist");
  sel.hidden = crateSource !== "spotify" || !playlists?.length;
  if (sel.hidden) return;
  sel.innerHTML = playlists.map((p) =>
    `<option value="${escapeHtml(p.id)}"${p.id === playlist?.id ? " selected" : ""}>${escapeHtml(p.name)} (${fmtInt(p.count)})</option>`).join("");
}

async function choosePlaylist(id) {
  const meta = playlists?.find((p) => p.id === id);
  if (!meta) return;
  playlist = { id, name: meta.name, tracks: null };
  playlistError = "";
  renderCrate();
  try {
    playlist.tracks = await Spotify.playlistTracks(id);
  } catch (e) {
    playlist.tracks = [];
    playlistError = e.message;
  }
  fillPlaylistPicker();
  renderCrate();
}

// Spotify's audio is protected, so a playlist track you don't own as a file can still be
// auditioned through the desktop app — it just can't go on a deck.
async function preview(uri) {
  try {
    await postJSON("/api/play", { uris: [uri] });
  } catch (e) {
    toast(e.message === "Failed to fetch" ? "Can't reach the local server." : e.message, { error: true });
  }
}

// ---------- the set you actually played ----------

function noteSet(item) {
  const last = setList[setList.length - 1];
  if (last && last.cacheKey === item.cacheKey) return;        // reloading the same track is not a new entry
  const hist = historyByKey.get(trackKey(item.title, item.artist));
  setList.push({
    cacheKey: item.cacheKey, title: item.title, artist: item.artist,
    uri: item.spotifyUri || hist?.u?.[0] || null,
  });
  $("#set-save").hidden = setList.length < 2;
}

async function saveSet() {
  const uris = setList.map((t) => t.uri).filter(Boolean);
  const missing = setList.length - uris.length;
  if (!uris.length) return toast("None of the tracks you played could be matched to Spotify.", { error: true });
  if (!Spotify.configured()) return toast("Add a Spotify Client ID in the ⚙ panel to save a set.", { error: true });
  if (!Spotify.connected()) return Spotify.login({ type: "set" });
  const button = $("#set-save");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const name = `DJ set · ${new Date().toLocaleDateString()}`;
    const playlistSaved = await Spotify.savePlaylist(name, `${uris.length} tracks, in the order I played them.`, uris);
    toast(`Saved “${escapeHtml(name)}”${missing ? ` (${missing} not on Spotify)` : ""}. <a href="${escapeHtml(playlistSaved.url)}" target="_blank" rel="noopener">Open it</a>`, { html: true });
    playlists = null;                                          // the new one should show up in the picker
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    button.disabled = false;
    button.textContent = "Save set to Spotify";
  }
}

function renderCrate() {
  const body = $("#crate-body");
  if (!body) return;
  const items = crateItems();
  $("#dropped-count").textContent = dropped.length ? `(${dropped.length})` : "";
  const dirNote = $("#crate-dir");
  if (crateSource === "folder") {
    dirNote.textContent = !crate.loaded ? "Scanning your music folder…"
      : crate.exists === false ? `Music folder not found: ${crate.dir}. Set "music_dir" in config.json or start the server with --music-dir.`
      : `${fmtInt(crate.tracks.length)} audio files in ${crate.dir}${crate.truncated ? " (first 10,000)" : ""}`;
  } else if (crateSource === "dropped") {
    dirNote.textContent = dropped.length ? "Files you dropped this session (not saved when you reload)." : "Drop audio files onto a deck or anywhere in this crate.";
  } else {
    dirNote.innerHTML = playlistNote();
  }
  $("#crate-col-6").textContent = crateSource === "spotify" ? "Mix" : "Spotify plays";
  fillPlaylistPicker();
  const shown = items.slice(0, 500);
  let lastKey = null;                      // the Camelot key of the previous track you own, for the mix hint
  body.innerHTML = shown.map((t) => {
    const hist = historyByKey.get(trackKey(t.title, t.artist));
    const bpm = t.saved?.bpm ? t.saved.bpm.toFixed(1) : "—";
    const key = t.saved?.camelot
      ? `<span class="key-badge" style="background:${camelotColor(t.saved.camelot)}" title="${escapeHtml(t.saved.key)}">${t.saved.camelot}</span>`
      : "—";
    if (crateSource !== "spotify") {
      return `
    <tr draggable="true" data-key="${escapeHtml(t.cacheKey)}">
      <td class="c-title">${escapeHtml(t.title)}</td>
      <td class="c-artist">${escapeHtml(t.artist || "—")}</td>
      <td class="num">${t.duration ? fmtTime(t.duration) : "—"}</td>
      <td class="num">${bpm}</td>
      <td>${key}</td>
      <td>${hist ? `<span class="swatch" style="background:${vibeColor(hist.v)}"></span>${fmtInt(hist.p)}` : "—"}</td>
      <td class="load"><button class="load-btn a" data-load="A">A</button><button class="load-btn b" data-load="B">B</button></td>
    </tr>`;
    }
    // A playlist row: mixable only if you own the audio, since Spotify's own stream can't go on a deck.
    const mix = t.saved?.camelot
      ? (lastKey === null ? "" : mixesWith(lastKey, t.saved.camelot)
        ? `<span class="mix-yes" title="Mixes with ${escapeHtml(lastKey)} — same key, its relative, or one step round the wheel">mixes</span>`
        : `<span class="mix-no" title="A key jump from ${escapeHtml(lastKey)}">jump</span>`)
      : "";
    if (t.saved?.camelot) lastKey = t.saved.camelot;
    return `
    <tr${t.owned ? ' draggable="true"' : ' class="not-owned"'} data-key="${escapeHtml(t.cacheKey || "")}" data-uri="${escapeHtml(t.uri)}">
      <td class="c-title">${escapeHtml(t.title)}</td>
      <td class="c-artist">${escapeHtml(t.artist || "—")}</td>
      <td class="num">${t.duration ? fmtTime(t.duration) : "—"}</td>
      <td class="num">${t.owned ? bpm : ""}</td>
      <td>${t.owned ? key : ""}</td>
      <td>${t.owned ? mix : '<span class="mix-missing">not in your folder</span>'}</td>
      <td class="load">${t.owned ? '<button class="load-btn a" data-load="A">A</button><button class="load-btn b" data-load="B">B</button>' : ""}<button class="load-btn preview" data-preview="1" title="Play it through the Spotify desktop app">▶</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="empty-row">${emptyCrateNote()}</td></tr>`;
  if (items.length > shown.length) body.insertAdjacentHTML("beforeend", `<tr><td colspan="7" class="empty-row">Showing 500 of ${fmtInt(items.length)}. Search to narrow it down.</td></tr>`);
}

function playlistNote() {
  if (playlistError === "connect") return 'Connect to Spotify to see your playlists. <button class="link-btn" id="crate-connect">Connect</button>';
  if (playlistError) return escapeHtml(playlistError);
  if (!playlist) return "Loading your playlists…";
  if (!playlist.tracks) return `Loading ${escapeHtml(playlist.name)}…`;
  const owned = playlist.tracks.filter(ownedFile).length;
  return `${fmtInt(owned)} of ${fmtInt(playlist.tracks.length)} tracks are in your music folder and can go on a deck. `
    + "The rest play through the Spotify desktop app — its audio is protected, so it can't be mixed. "
    + "BPM and key come from your own files, filled in once a track has been on a deck.";
}

function rowItem(row) {
  const item = row.dataset.key && findItem(row.dataset.key);
  if (!item) return null;
  return row.dataset.uri ? { ...item, spotifyUri: row.dataset.uri } : item;
}

function findItem(cacheKey) {
  return crate.tracks.find((t) => t.cacheKey === cacheKey) ?? dropped.find((t) => t.cacheKey === cacheKey);
}

// ?deckA=neon&deckB=glass loads tracks from the crate by name (or id); ?sync=B beat-matches after loading
async function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  const loading = [];
  for (const id of ["A", "B"]) {
    const wanted = params.get(`deck${id}`);
    if (!wanted) continue;
    const needle = wanted.toLowerCase();
    const track = crate.tracks.find((t) => t.id === wanted)
      ?? crate.tracks.find((t) => `${t.title} ${t.artist}`.toLowerCase().includes(needle));
    if (track) loading.push(decks[id].load(track));
    else toast(`No track matching “${wanted}” in the crate`, { error: true });
  }
  if (!loading.length) return;
  await Promise.all(loading);
  const sync = params.get("sync")?.toUpperCase();
  if (decks[sync]) decks[sync].sync();
  // demo helpers: start the decks and open the light show without touching the controls
  if (params.get("play") === "1") {
    audio();
    await ctx.resume().catch(() => {});
    Object.values(decks).forEach((d) => { if (d.buffer && !d.playing) d.togglePlay(); });
  }
  if (params.get("lightshow") === "1") openFullscreen();
}

async function loadCrate(refresh = false) {
  crate.loaded = false;
  renderCrate();
  try {
    const data = await (await fetch(`/api/crate${refresh ? "?refresh=1" : ""}`)).json();
    crate = { ...data, loaded: true, tracks: data.tracks.map((t) => ({ ...t, cacheKey: `crate:${t.id}` })) };
    crateByKey = new Map(crate.tracks.map((t) => [trackKey(t.title, t.artist), t]));
  } catch {
    crate = { tracks: [], dir: "your music folder", loaded: true, exists: false };
  }
  renderCrate();
  loadFromUrl();
}

function addFiles(files) {
  const added = [];
  for (const file of files) {
    if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|aiff?|flac|ogg|opus)$/i.test(file.name)) continue;
    const cacheKey = `file:${file.name}:${file.size}`;
    let item = dropped.find((d) => d.cacheKey === cacheKey);
    if (!item) {
      const stem = file.name.replace(/\.[^.]+$/, "");
      const [artist, title] = stem.includes(" - ") ? [stem.slice(0, stem.indexOf(" - ")), stem.slice(stem.indexOf(" - ") + 3)] : ["", stem];
      item = { file, cacheKey, title, artist, duration: null };
      dropped.push(item);
    }
    added.push(item);
  }
  if (!added.length && files.length) toast("Those don't look like audio files", { error: true });
  renderCrate();
  return added;
}

// ---------- recording ----------

async function toggleRecord() {
  audio();
  await ctx.resume();
  const button = $("#dj-rec");
  if (recording) {
    const { node, chunks, frames } = recording;
    recording = null;
    masterGain.disconnect(node);
    node.port.postMessage("stop");
    node.port.onmessage = null;
    button.classList.remove("on");
    button.textContent = "● Record";
    $("#dj-rec-time").textContent = "";
    if (!frames) return;
    const blob = wavBlob(chunks, frames, ctx.sampleRate);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `music-graph-mix-${stamp}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    toast(`Saved your mix (${fmtTime(frames / ctx.sampleRate)}) to Downloads`);
    return;
  }
  if (!recorderReady) {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: "application/javascript" })));
    recorderReady = true;
  }
  const node = new AudioWorkletNode(ctx, "dj-recorder", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit" });
  recording = { node, chunks: [], frames: 0, started: performance.now() };
  node.port.onmessage = (e) => {
    if (!recording) return;
    recording.chunks.push(e.data);
    recording.frames += e.data.length / 2;
    if (recording.frames / ctx.sampleRate > MAX_RECORD_SECONDS) {
      toast("Recording stopped at 90 minutes");
      toggleRecord();
    }
  };
  masterGain.connect(node);
  button.classList.add("on");
  button.textContent = "■ Stop & save";
}

function wavBlob(chunks, frames, sampleRate) {
  const header = new DataView(new ArrayBuffer(44));
  const dataBytes = frames * 4;
  const str = (o, s) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  header.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 2, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 4, true);
  header.setUint16(32, 4, true);
  header.setUint16(34, 16, true);
  str(36, "data");
  header.setUint32(40, dataBytes, true);
  return new Blob([header, ...chunks], { type: "audio/wav" });
}

// ---------- full-screen light show ----------

function dominantDeck() {
  const a = decks.A, b = decks.B;
  const wa = a.playing ? Math.cos((xfade * Math.PI) / 2) : 0, wb = b.playing ? Math.sin((xfade * Math.PI) / 2) : 0;
  if (!wa && !wb) return a.meta ? (b.meta && xfade > 0.5 ? b : a) : b;
  return wb > wa ? b : a;
}

function lightShowInfo() {
  const main = dominantDeck(), other = main === decks.A ? decks.B : decks.A;
  const color = (d) => {
    const hist = d.meta && historyByKey.get(trackKey(d.meta.title, d.meta.artist));
    const c = d3.rgb(hist && hist.v >= 0 ? vibeColor(hist.v) : d.color);
    return [c.r / 255, c.g / 255, c.b / 255];
  };
  const line = (d) => (d.meta ? `${d.id}: ${d.meta.title}${d.analysis ? ` · ${d.bpm.toFixed(1)} BPM` : ""}` : `${d.id}: empty`);
  return {
    title: main.meta?.title ?? "DJ mode",
    subtitle: `${line(decks.A)}  ⇄  ${line(decks.B)}`,
    palette: [color(main), color(other), [0.55, 0.48, 1], [1, 0.69, 0.23]],
  };
}

function openFullscreen() {
  audio();
  fullscreen = true;
  const info = lightShowInfo();
  lastPaletteKey = JSON.stringify(info.palette);
  requestAnimationFrame(() => $("#np")?.focus({ preventScroll: true }));   // so arrow keys land here
  NowPlaying.openExternal({
    analyser, ctx, ...info,
    progress: () => { const d = dominantDeck(); return d.duration ? d.position() / d.duration : 0; },
    onClose: () => { fullscreen = false; },
  });
  loop();
}

// ---------- frame loop ----------

function loop() {
  cancelAnimationFrame(rafId);
  const tick = (now) => {
    const visible = state.view === "dj";
    if (!visible && !fullscreen) return;
    for (const d of Object.values(decks)) {
      if (visible) {
        d.drawOverview(now);
        const el = $(`#deck-${d.id}`), p = d.position();
        $(`[data-f="elapsed"]`, el).textContent = fmtTime(p, true);
        $(`[data-f="remaining"]`, el).textContent = `-${fmtTime((d.duration - p) / d.effRate())}`;
        let level = 0;
        if (d.meter) {
          d.meter.getFloatTimeDomainData(d.meterData);
          for (const v of d.meterData) level = Math.max(level, Math.abs(v));
        }
        $(`[data-f="meter"]`, el).style.height = `${Math.min(100, level * 110)}%`;
      }
      if (d.playing && d.position() >= d.duration - 0.02 && !d.loop) d.render();
    }
    if (visible) drawDualWave($("#dj-wave"), now);
    if (fullscreen) {
      drawDualWave($("#dj-wave-full"), now);
      if (now - lastHud > 400) {
        lastHud = now;
        const info = lightShowInfo();
        const key = JSON.stringify(info.palette);
        NowPlaying.updateExternal({ title: info.title, subtitle: info.subtitle, palette: key !== lastPaletteKey ? info.palette : null });
        lastPaletteKey = key;
        document.querySelectorAll("#np-dj [data-djact=play]").forEach((b) => {
          b.textContent = `${decks[b.dataset.deck].playing ? "❚❚" : "▶"} ${b.dataset.deck}`;
        });
      }
    }
    if (recording && ctx) $("#dj-rec-time").textContent = fmtTime(recording.frames / ctx.sampleRate);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

// ---------- markup + events ----------

function deckMarkup(id) {
  return `
  <section class="deck" id="deck-${id}" data-deck="${id}" style="--deck:${DECK_COLORS[id]}">
    <header class="deck-head">
      <span class="deck-letter">${id}</span>
      <div class="deck-title"><strong data-f="title"></strong><span data-f="artist"></span></div>
      <div class="deck-bpm"><strong data-f="bpm">—</strong><span>BPM</span></div>
    </header>
    <div class="deck-tags">
      <span class="key-badge" data-f="key" hidden></span><span data-f="orig"></span><span data-f="history"></span><span class="deck-status" data-f="status"></span>
    </div>
    <canvas class="deck-overview" data-f="overview" title="Click to jump"></canvas>
    <canvas class="deck-melody" data-f="melody" title="The tune's rises and falls, highest note to lowest"></canvas>
    <div class="deck-time"><span data-f="elapsed">0:00.0</span><span data-f="remaining">-0:00</span></div>
    <div class="deck-transport">
      <button class="pad" data-act="cue" title="Cue: set when paused, return when playing">CUE</button>
      <button class="pad play" data-act="play" title="Play / pause (${id === "A" ? "A" : "L"})">▶</button>
      <button class="pad" data-act="sync" title="Match tempo and beats to the other deck (${id === "A" ? "S" : "K"})">SYNC</button>
      <button class="pad toggle" data-act="keylock" aria-pressed="true" title="Key lock: keep the pitch when changing tempo">KEY</button>
    </div>
    <div class="deck-row"><span class="row-label">Hot cues</span>${[0, 1, 2, 3].map((i) => `<button class="mini-pad hot hot-${i}" data-hot="${i}" title="Set / jump. Right-click to clear">${i + 1}</button>`).join("")}</div>
    <div class="deck-row"><span class="row-label">Loop</span>${LOOPS.map((b) => `<button class="mini-pad" data-loop="${b}" title="${b}-beat loop">${b}</button>`).join("")}</div>
    <div class="deck-tempo">
      <button class="mini-pad" data-act="nudge-down" title="Hold to slow down briefly">−</button>
      <input type="range" data-f="tempo" min="-1" max="1" step="0.001" value="0" aria-label="Tempo" title="Tempo (double-click to reset)">
      <button class="mini-pad" data-act="nudge-up" title="Hold to speed up briefly">+</button>
      <button class="mini-pad wide" data-act="range" title="Tempo range">±8%</button>
      <button class="mini-pad" data-act="half" title="Halve detected BPM">÷2</button>
      <button class="mini-pad" data-act="double" title="Double detected BPM">×2</button>
    </div>
    <div class="deck-mixer">
      ${["high", "mid", "low"].map((b) => `<label class="knob"><input type="range" class="vertical" data-eq="${b}" min="-1" max="1" step="0.01" value="0" title="Double-click to reset"><span>${b === "high" ? "HI" : b.toUpperCase()}</span></label>`).join("")}
      <label class="knob filter"><input type="range" class="vertical" data-f="filter" min="-1" max="1" step="0.01" value="0" title="Down: low-pass · Up: high-pass. Double-click to reset"><span>FILTER</span></label>
      <label class="knob fader"><input type="range" class="vertical" data-f="volume" min="0" max="1" step="0.01" value="0.9"><span>VOL</span></label>
      <div class="meter" aria-hidden="true"><span data-f="meter"></span></div>
    </div>
  </section>`;
}

function wireDeck(deck) {
  const el = $(`#deck-${deck.id}`);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    audio();
    if (b.dataset.hot) return deck.hotCue(+b.dataset.hot, e.shiftKey);
    if (b.dataset.loop) return deck.toggleLoop(+b.dataset.loop);
    ({
      play: () => deck.togglePlay(),
      cue: () => deck.pressCue(),
      sync: () => deck.sync(),
      keylock: () => deck.toggleKeylock(),
      range: () => { deck.range = deck.range === 0.08 ? 0.16 : 0.08; deck.setRate(clamp(deck.rate, 1 - deck.range, 1 + deck.range)); },
      half: () => deck.fixBpm(0.5),
      double: () => deck.fixBpm(2),
    })[b.dataset.act]?.();
  });
  el.addEventListener("contextmenu", (e) => {
    const b = e.target.closest("[data-hot]");
    if (!b) return;
    e.preventDefault();
    deck.hotCue(+b.dataset.hot, true);
  });
  for (const [act, amount] of [["nudge-down", -0.04], ["nudge-up", 0.04]]) {
    const b = $(`[data-act="${act}"]`, el);
    b.addEventListener("pointerdown", () => deck.setNudge(amount));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => deck.nudge && deck.setNudge(0));
  }
  const tempo = $(`[data-f="tempo"]`, el);
  tempo.addEventListener("input", () => { deck.synced = false; deck.setRate(1 + +tempo.value * deck.range); });
  tempo.addEventListener("dblclick", () => { tempo.value = "0"; deck.setRate(1); });
  el.querySelectorAll("[data-eq]").forEach((input) => {
    input.addEventListener("input", () => { deck.eq[input.dataset.eq] = +input.value; deck.applyEq(); });
    input.addEventListener("dblclick", () => { input.value = "0"; deck.eq[input.dataset.eq] = 0; deck.applyEq(); });
  });
  const filter = $(`[data-f="filter"]`, el);
  filter.addEventListener("input", () => { deck.filter = +filter.value; deck.applyFilter(); });
  filter.addEventListener("dblclick", () => { filter.value = "0"; deck.filter = 0; deck.applyFilter(); });
  const volume = $(`[data-f="volume"]`, el);
  volume.addEventListener("input", () => { deck.volume = +volume.value; if (deck.fader) deck.fader.gain.setTargetAtTime(deck.volume, ctx.currentTime, 0.01); });
  $(`[data-f="overview"]`, el).addEventListener("click", (e) => {
    if (!deck.buffer) return;
    const r = e.currentTarget.getBoundingClientRect();
    deck.seek(((e.clientX - r.left) / r.width) * deck.duration);
  });

  // drop files or crate rows onto a deck
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop"); });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop");
    const key = e.dataTransfer.getData("text/x-crate-key");
    if (key) return findItem(key) && deck.load(findItem(key));
    const items = addFiles(e.dataTransfer.files);
    if (items[0]) deck.load(items[0]);
  });
}

function setCrossfader(v) {
  xfade = clamp(v, 0, 1);
  $("#dj-xfade").value = String(xfade);
  $("#dj-xfade-full").value = String(xfade);
  applyCrossfader();
}

function wireGlobal() {
  $("#dj-xfade").addEventListener("input", (e) => setCrossfader(+e.target.value));
  $("#dj-xfade-full").addEventListener("input", (e) => setCrossfader(+e.target.value));
  for (const el of [$("#dj-xfade"), $("#dj-xfade-full")]) el.addEventListener("dblclick", () => setCrossfader(0.5));
  $("#dj-master").addEventListener("input", (e) => {
    masterVolume = +e.target.value;
    if (masterGain) masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.01);
  });
  $("#dj-rec").addEventListener("click", () => toggleRecord().catch((e) => toast(`Recording failed: ${e.message}`, { error: true })));
  $("#dj-full").addEventListener("click", openFullscreen);
  $("#np-dj").addEventListener("click", (e) => {
    const b = e.target.closest("[data-djact]");
    if (!b) return;
    const deck = decks[b.dataset.deck];
    b.dataset.djact === "play" ? deck.togglePlay() : deck.sync();
  });

  $("#crate-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    crateSource = b.dataset.src;
    $("#crate-tabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderCrate();
    if (crateSource === "spotify") openPlaylists();
  });
  $("#crate-playlist").addEventListener("change", (e) => choosePlaylist(e.target.value));
  $("#set-save").addEventListener("click", saveSet);
  $("#crate-dir").addEventListener("click", (e) => {
    if (e.target.id === "crate-connect") Spotify.login({ type: "playlists" });
  });
  $("#crate-search").addEventListener("input", (e) => { crateQuery = e.target.value; renderCrate(); });
  $("#crate-refresh").addEventListener("click", () => loadCrate(true));
  $("#crate-files").addEventListener("change", (e) => {
    if (addFiles(e.target.files).length) {
      crateSource = "dropped";
      $("#crate-tabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.src === "dropped")));
      renderCrate();
    }
    e.target.value = "";
  });
  const body = $("#crate-body");
  body.addEventListener("click", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    if (e.target.closest("[data-preview]")) return preview(row.dataset.uri);
    const b = e.target.closest("[data-load]");
    if (!b) return;
    const item = rowItem(row);
    if (item) decks[b.dataset.load].load(item);
  });
  body.addEventListener("dblclick", (e) => {
    const row = e.target.closest("tr[data-key]");
    const item = row && rowItem(row);
    if (item) (decks.A.buffer && !decks.B.buffer ? decks.B : decks.A.playing ? decks.B : decks.A).load(item);
  });
  body.addEventListener("dragstart", (e) => {
    const row = e.target.closest("tr[data-key]");
    if (row) e.dataTransfer.setData("text/x-crate-key", row.dataset.key);
  });
  const crateEl = $(".crate");
  crateEl.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); crateEl.classList.add("drop"); } });
  crateEl.addEventListener("dragleave", (e) => { if (!crateEl.contains(e.relatedTarget)) crateEl.classList.remove("drop"); });
  crateEl.addEventListener("drop", (e) => {
    e.preventDefault();
    crateEl.classList.remove("drop");
    if (addFiles(e.dataTransfer.files).length) {
      crateSource = "dropped";
      $("#crate-tabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.src === "dropped")));
      renderCrate();
    }
  });
  // keep stray file drops from navigating away from the page
  window.addEventListener("dragover", (e) => { if (state.view === "dj") e.preventDefault(); });
  window.addEventListener("drop", (e) => { if (state.view === "dj") e.preventDefault(); });

  // on window + capture, so the keys work wherever focus happens to be
  window.addEventListener("keydown", (e) => {
    if ((state.view !== "dj" && !fullscreen) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.("input[type=search], input[type=text], textarea, select")) return;
    const actions = {
      a: () => decks.A.togglePlay(), l: () => decks.B.togglePlay(),
      s: () => decks.A.sync(), k: () => decks.B.sync(),
      ArrowLeft: () => setCrossfader(xfade - 0.05), ArrowRight: () => setCrossfader(xfade + 0.05),
    };
    const fn = actions[e.key?.length === 1 ? e.key.toLowerCase() : e.key] ?? actions[e.code];
    if (!fn) return;
    e.preventDefault();
    audio();
    fn();
  }, true);
}

export { decks }; // read-only handle for debugging from the console

// Coming back from a Spotify login that was started here.
export function resume(action) {
  crateSource = "spotify";
  $("#crate-tabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.src === "spotify")));
  openPlaylists();
  if (action.type === "set") toast("Connected. Play a few tracks and save the set when you're done.");
}

export function init(a) {
  api = a;
  state = a.state;
  historyByKey = new Map(state.history.tracks.map((t) => [t.k, t]));
  $("#dj-decks-a").innerHTML = deckMarkup("A");
  $("#dj-decks-b").innerHTML = deckMarkup("B");
  decks.A = new Deck("A");
  decks.B = new Deck("B");
  Object.values(decks).forEach((d) => { wireDeck(d); d.render(); });
  wireGlobal();
  NowPlaying.setAutoOpenBlocker(() => decks.A.playing || decks.B.playing);
}

export function show() {
  if (!crate.loaded && !crate.loading) {
    crate.loading = true;
    loadCrate();
  }
  loop();
}
