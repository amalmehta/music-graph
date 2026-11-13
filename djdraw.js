// Pure drawing helpers for the DJ decks: no audio state, no DOM lookups, just
// pixels from numbers. Kept apart from dj.js so they can be read and tested alone.

export function camelotColor(code) {
  const n = parseInt(code, 10);
  if (!n) return "var(--faint)";
  return d3.hsl(((n - 1) * 30 + 10) % 360, 0.75, code.endsWith("A") ? 0.5 : 0.62).formatHex();
}

export function drawMelodyLine(g, midi, W, H, dpr, color) {
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

export function drawBands(g, bands, W, H, indexAt, lowColor) {
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
