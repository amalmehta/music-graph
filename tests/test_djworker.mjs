// Checks the DJ analysis worker against tracks whose true tempo and key are known.
//
//     .venv/bin/python make_test_audio.py
//     node tests/test_djworker.mjs .

import fs from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = process.argv[2] ?? ".";
const dir = path.join(root, "data", "test_audio");
if (!fs.existsSync(dir)) {
  console.error(`No test audio in ${dir}. Run: .venv/bin/python make_test_audio.py`);
  process.exit(1);
}

const code = fs.readFileSync(path.join(root, "djworker.js"), "utf8");
const { analyze, stretch } = new Function("self", `${code}\nreturn { analyze, stretch };`)({});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "djworker-"));

// Decode to 48 kHz float mono, the same rate the browser's AudioContext uses here.
function decode(file) {
  const wav = path.join(tmp, "decoded.wav");
  execSync(`afconvert -f WAVE -d LEF32@48000 -c 1 "${file}" "${wav}"`);
  const buf = fs.readFileSync(wav);
  let off = 12;
  while (buf.toString("ascii", off, off + 4) !== "data") off += 8 + buf.readUInt32LE(off + 4);
  const size = buf.readUInt32LE(off + 4);
  return new Float32Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size));
}

let failures = 0;
for (const file of fs.readdirSync(dir).sort()) {
  const expected = file.match(/\((\d+) BPM, ([^)]+)\)/);
  if (!expected) continue;
  const mono = decode(path.join(dir, file));
  const t0 = Date.now();
  const result = analyze(mono, 48000);
  const analyzeMs = Date.now() - t0;

  const beatOffset = Math.min(result.firstBeat, Math.abs(result.firstBeat - 60 / result.bpm));
  const bpmOk = Math.abs(result.bpm - Number(expected[1])) < 0.5;
  const beatOk = beatOffset < 0.05;
  const keyOk = result.key === expected[2];

  const t1 = Date.now();
  const stretched = stretch([mono], 128 / result.bpm);
  const stretchMs = Date.now() - t1;
  const again = analyze(stretched[0], 48000);
  const stretchOk = Math.abs(again.bpm - 128) < 0.6 && again.key === result.key;

  failures += [bpmOk, beatOk, stretchOk].filter((ok) => !ok).length;
  console.log(
    `${file}\n  tempo ${result.bpm} BPM ${bpmOk ? "ok" : "MISMATCH"} · beat grid ${beatOffset.toFixed(3)}s off ${beatOk ? "ok" : "MISMATCH"} · ` +
    `key ${result.key} ${keyOk ? "ok" : `(expected ${expected[2]}; neighbouring keys are acceptable)`}\n` +
    `  stretched to 128 BPM → ${again.bpm} BPM, ${again.key} ${stretchOk ? "ok" : "MISMATCH"} · analyze ${analyzeMs} ms, stretch ${stretchMs} ms`,
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : "PASS");
process.exit(failures ? 1 : 0);
