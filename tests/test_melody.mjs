// Checks the melody detector against signals whose pitch is known by construction:
// steady notes, a rising glide, an octave leap, silence and noise.
//
//     node tests/test_melody.mjs .

import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const code = fs.readFileSync(path.join(root, "djworker.js"), "utf8");
const { melody } = new Function("self", `${code}\nreturn { melody };`)({});

const SR = 48000;
let ok = true;

function check(label, got, want, tol = 0) {
  const good = tol ? Math.abs(got - want) <= tol : got === want;
  ok &&= good;
  console.log(`${good ? "ok  " : "FAIL"} ${label}: ${typeof got === "number" ? got.toFixed(2) : got}`
    + (good ? "" : `  (wanted ${want}${tol ? ` ±${tol}` : ""})`));
}

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

// A sawtooth, so there are harmonics to confuse a naive detector the way real instruments do.
function tone(seconds, hzAt, gain = 0.3) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const hz = typeof hzAt === "function" ? hzAt(i / SR) : hzAt;
    phase += hz / SR;
    if (phase >= 1) phase -= 1;
    out[i] = gain * (2 * phase - 1);
  }
  return out;
}

function join(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const voiced = (m) => [...m].filter((v) => !Number.isNaN(v));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

// --- a steady note is read as that note ---
for (const note of [45, 57, 69, 81]) {                       // A2, A3, A4, A5
  const { midi } = melody(tone(4, midiToHz(note)), SR);
  check(`a steady ${note === 69 ? "A4" : `MIDI ${note}`} reads as itself`, median(voiced(midi)), note, 0.5);
}

// --- a glide rises, and the line follows it ---
{
  const sweep = tone(6, (t) => midiToHz(48 + (t / 6) * 24));  // C3 up two octaves
  const { midi } = melody(sweep, SR);
  const v = voiced(midi);
  const firstQuarter = median(v.slice(0, Math.floor(v.length / 4)));
  const lastQuarter = median(v.slice(-Math.floor(v.length / 4)));
  check("a glide starts low", firstQuarter, 51, 2.5);
  check("a glide ends high", lastQuarter, 69, 2.5);
  check("it rises the whole way", lastQuarter - firstQuarter > 14, true);
  let backwards = 0;
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1] - 1.5) backwards++;
  check("without jumping back down", backwards / v.length < 0.05, true);
}

// --- an octave leap is kept, not smoothed away ---
{
  const { midi } = melody(join(tone(3, midiToHz(50)), tone(3, midiToHz(62))), SR);
  const v = voiced(midi);
  check("the note before a leap", median(v.slice(0, Math.floor(v.length * 0.4))), 50, 0.6);
  check("the note after it", median(v.slice(-Math.floor(v.length * 0.4))), 62, 0.6);
}

// --- what has no pitch leaves a gap ---
{
  const { midi } = melody(new Float32Array(SR * 3), SR);
  check("silence is all gaps", voiced(midi).length, 0);
}
{
  const noise = new Float32Array(SR * 3).map(() => (Math.random() * 2 - 1) * 0.3);
  const { midi } = melody(noise, SR);
  check("noise is mostly gaps", voiced(midi).length / midi.length < 0.35, true);
}

// --- the output is the right shape to draw ---
{
  const { midi, rate } = melody(tone(10, 220), SR);
  check("a 10s track gives a drawable number of points", midi.length > 300 && midi.length < 2000, true);
  check("the rate matches the points", Math.abs(midi.length / rate - 10) < 0.6, true);
}

// --- the live detector in the light show, which works off the analyser's byte waveform ---
const npSrc = fs.readFileSync(path.join(root, "nowplaying.js"), "utf8");
function lift(src, name, extra = "") {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found`);
  let depth = 0, i = src.indexOf("{", at);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return new Function(`${extra}\n${src.slice(at, i + 1)}\nreturn ${name};`)();
}
const detectPitch = lift(npSrc, "detectPitch", npSrc.match(/const pitchBuf = .*;/)[0]);

// What an AnalyserNode hands over: 8-bit samples centred on 128.
function bytes(seconds, hz, sr = 48000, gain = 0.4) {
  const n = 2048;
  const out = new Uint8Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += hz / sr;
    if (phase >= 1) phase -= 1;
    out[i] = Math.max(0, Math.min(255, Math.round(128 + gain * 127 * (2 * phase - 1))));
  }
  return out;
}

for (const note of [45, 57, 69]) {
  check(`live: MIDI ${note} reads back`, detectPitch(bytes(1, midiToHz(note)), 48000), note, 1.0);
}
check("live: silence gives no note", Number.isNaN(detectPitch(new Uint8Array(2048).fill(128), 48000)), true);
{
  const noise = new Uint8Array(2048).map(() => 128 + Math.round((Math.random() * 2 - 1) * 50));
  const got = detectPitch(noise, 48000);
  check("live: noise gives no note", Number.isNaN(got), true);
}
check("live: a quiet signal is ignored", Number.isNaN(detectPitch(bytes(1, 220, 48000, 0.002), 48000)), true);

console.log(ok ? "PASS" : "FAILED");
process.exit(ok ? 0 : 1);
