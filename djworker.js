// Web Worker for the DJ decks: tempo, beat grid, key and waveform analysis, plus
// pitch-preserving time-stretch (WSOLA) so beat-matched tracks keep their key.

self.onmessage = (e) => {
  const { type, id } = e.data;
  try {
    if (type === "analyze") {
      const result = analyze(e.data.mono, e.data.sampleRate);
      const transfer = Object.values(result.overview).concat(Object.values(result.detail)).map((a) => a.buffer);
      self.postMessage({ id, ok: true, result }, transfer);
    } else if (type === "stretch") {
      const channels = stretch(e.data.channels, e.data.ratio);
      self.postMessage({ id, ok: true, result: { channels } }, channels.map((c) => c.buffer));
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};

// ---------- analysis ----------

const DETAIL_RATE = 150; // waveform columns per second for the scrolling view
const OVERVIEW_BINS = 1200;

function analyze(mono, sampleRate) {
  const factor = Math.max(1, Math.round(sampleRate / 11025));
  const sr = sampleRate / factor;
  const x = new Float32Array(Math.floor(mono.length / factor));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += mono[i * factor + j];
    x[i] = s / factor;
  }
  const low = onePole(x, sr, 150);
  const lowMid = onePole(x, sr, 2000);

  const tempo = detectTempo(x, low, sr);
  const key = detectKey(x, sr);
  return {
    duration: mono.length / sampleRate,
    bpm: tempo.bpm,
    firstBeat: tempo.firstBeat,
    confidence: tempo.confidence,
    key: key.name,
    camelot: key.camelot,
    overview: bands(x, low, lowMid, Math.ceil(x.length / OVERVIEW_BINS)),
    detail: bands(x, low, lowMid, Math.max(1, Math.round(sr / DETAIL_RATE))),
    detailRate: sr / Math.max(1, Math.round(sr / DETAIL_RATE)),
  };
}

function onePole(x, sr, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  const y = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc = (1 - a) * x[i] + a * acc;
    y[i] = acc;
  }
  return y;
}

// Per-column peak plus low / mid / high energy, used to draw colored waveforms.
function bands(x, low, lowMid, size) {
  const n = Math.ceil(x.length / size);
  const peak = new Float32Array(n), lo = new Float32Array(n), mid = new Float32Array(n), hi = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let p = 0, l = 0, m = 0, h = 0;
    const end = Math.min(x.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = x[i];
      p = Math.max(p, Math.abs(v));
      l += low[i] * low[i];
      m += (lowMid[i] - low[i]) ** 2;
      h += (v - lowMid[i]) ** 2;
    }
    const count = Math.max(1, end - b * size);
    peak[b] = p;
    lo[b] = Math.sqrt(l / count);
    mid[b] = Math.sqrt(m / count);
    hi[b] = Math.sqrt(h / count);
  }
  const norm = (arr) => {
    let max = 1e-9;
    for (const v of arr) max = Math.max(max, v);
    for (let i = 0; i < arr.length; i++) arr[i] /= max;
  };
  [peak, lo, mid, hi].forEach(norm);
  return { peak, low: lo, mid, high: hi };
}

function detectTempo(x, low, sr) {
  const hop = 128;
  const frames = Math.floor(x.length / hop);
  const er = sr / hop; // onset envelope rate (~86 Hz)
  const onset = new Float32Array(frames);
  let prevFull = 0, prevLow = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0, el = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      e += x[i] * x[i];
      el += low[i] * low[i];
    }
    const full = Math.log1p(1000 * e), lo = Math.log1p(1000 * el);
    onset[f] = 0.4 * Math.max(0, full - prevFull) + 0.6 * Math.max(0, lo - prevLow);
    prevFull = full;
    prevLow = lo;
  }
  // subtract a moving average so sustained loudness doesn't look like beats
  const w = 16, cleaned = new Float32Array(frames);
  let run = 0;
  for (let f = 0; f < frames; f++) {
    run += onset[f] - (f >= w ? onset[f - w] : 0);
    cleaned[f] = Math.max(0, onset[f] - run / Math.min(f + 1, w));
  }

  const minLag = Math.floor((60 * er) / 200), maxLag = Math.ceil((60 * er) / 60);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag >> 1; lag <= Math.min(maxLag * 2 + 1, frames - 1); lag++) {
    let s = 0;
    for (let t = 0; t + lag < frames; t++) s += cleaned[t] * cleaned[t + lag];
    ac[lag] = s / (frames - lag);
  }
  let bestLag = minLag, bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * er) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 122) / 0.7) ** 2);
    const score = (ac[lag] + 0.5 * (ac[lag * 2] || 0) + 0.25 * (ac[Math.round(lag / 2)] || 0)) * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  // refine: comb-filter search around the coarse tempo, scoring the best phase for each period
  const combScore = (period) => {
    let best = -1, phase = 0;
    for (let ph = 0; ph < period; ph += 0.5) {
      let s = 0;
      for (let t = ph; t < frames - 1; t += period) {
        const i = Math.floor(t), f = t - i;
        s += cleaned[i] * (1 - f) + cleaned[i + 1] * f;
      }
      if (s > best) { best = s; phase = ph; }
    }
    return { score: best, phase };
  };
  const coarse = (60 * er) / bestLag;
  let bpm = coarse, top = { score: -1, phase: 0 };
  for (let cand = coarse * 0.97; cand <= coarse * 1.03; cand += 0.02) {
    const r = combScore((60 * er) / cand);
    if (r.score > top.score) { top = r; bpm = cand; }
  }
  while (bpm < 78) bpm *= 2;
  while (bpm >= 160) bpm /= 2;
  if (Math.abs(bpm - Math.round(bpm)) < 0.15) bpm = Math.round(bpm);

  const period = (60 * er) / bpm;
  const phase = combScore(period).phase;
  const beatSeconds = 60 / bpm;
  const firstBeat = ((phase / er) % beatSeconds + beatSeconds) % beatSeconds;

  let mean = 0;
  for (const v of cleaned) mean += v;
  mean /= frames || 1;
  return { bpm, firstBeat, confidence: Math.min(1, top.score / Math.max(1e-9, (mean * frames) / period) / 4) };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function detectKey(x, sr) {
  const N = 4096;
  const chroma = new Float64Array(12);
  const re = new Float64Array(N), im = new Float64Array(N);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const binPc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f < 60 || f > 2000) continue;
    binPc[k] = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
  }
  for (let start = 0; start + N <= x.length; start += N / 2) {
    for (let i = 0; i < N; i++) { re[i] = x[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) if (binPc[k] >= 0) chroma[binPc[k]] += Math.sqrt(Math.hypot(re[k], im[k]));
  }
  let best = { r: -2, pc: 0, minor: false };
  for (let pc = 0; pc < 12; pc++) {
    for (const [profile, minor] of [[MAJOR, false], [MINOR, true]]) {
      const r = pearson(chroma, (i) => profile[(i - pc + 12) % 12]);
      if (r > best.r) best = { r, pc, minor };
    }
  }
  return {
    name: `${NAMES[best.pc]} ${best.minor ? "minor" : "major"}`,
    camelot: `${(best.minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[best.pc]}${best.minor ? "A" : "B"}`,
  };
}

function pearson(a, bAt) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += bAt(i); }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma, y = bAt(i) - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db || 1);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ---------- time-stretch ----------

// WSOLA: overlap-add windowed frames, each taken from near its ideal input position at the
// offset that best continues the previous frame. ratio > 1 plays faster (shorter output).
function stretch(channels, ratio) {
  const N = 2048, Hs = N / 2, search = 512, step = 8, stride = 16;
  const n = channels[0].length;
  const outLen = Math.floor(n / ratio);
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const outs = channels.map(() => new Float32Array(outLen + N));
  const weight = new Float32Array(outLen + N);

  const corr = (a, b, s) => {
    let sum = 0;
    for (let i = 0; i < N; i += s) sum += mono[a + i] * mono[b + i];
    return sum;
  };

  let prev = -1;
  for (let outPos = 0; outPos < outLen; outPos += Hs) {
    const target = Math.min(n - N - 1, Math.round(outPos * ratio));
    if (target < 0) break;
    let best = target;
    const natural = prev + Hs;
    if (prev >= 0 && natural + N < n) {
      const lo = Math.max(0, target - search), hi = Math.min(n - N - 1, target + search);
      let bestScore = -Infinity;
      for (let cand = lo; cand <= hi; cand += step) {
        const s = corr(natural, cand, stride);
        if (s > bestScore) { bestScore = s; best = cand; }
      }
      const center = best;
      for (let cand = Math.max(lo, center - step + 1); cand <= Math.min(hi, center + step - 1); cand++) {
        const s = corr(natural, cand, 4);
        if (s > bestScore) { bestScore = s; best = cand; }
      }
    }
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c], dst = outs[c];
      for (let i = 0; i < N; i++) dst[outPos + i] += src[best + i] * win[i];
    }
    for (let i = 0; i < N; i++) weight[outPos + i] += win[i];
    prev = best;
  }
  return outs.map((o) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = weight[i] > 1e-3 ? o[i] / weight[i] : 0;
    return out;
  });
}
