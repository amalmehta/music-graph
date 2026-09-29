#!/usr/bin/env python3
"""Synthesize short dance loops with known tempo and key, for testing the DJ decks.

    .venv/bin/python make_test_audio.py

Writes data/test_audio/*.wav (plus an .m4a copy via macOS afconvert). The file
names carry the true BPM and key so the decks' detection can be checked.
"""
import subprocess
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "test_audio"
SR = 44100
rng = np.random.default_rng(3)

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octave + 1) - 69) / 12)


def saw(freq, n, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-detune, 0.0, detune):
        f = freq * (1 + d)
        out += 2 * ((t * f) % 1.0) - 1
    return out / 3


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # fine for short one-off renders
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def render(bpm, root, minor, progression, seconds=96):
    beat = 60 / bpm
    n = int(seconds * SR)
    left, right = np.zeros(n), np.zeros(n)
    beats = int(seconds / beat)

    kick_len = int(0.28 * SR)
    t = np.arange(kick_len) / SR
    kick = np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-t * 30)) / SR) * np.exp(-t * 9)
    hat_len = int(0.05 * SR)
    hat = np.diff(rng.standard_normal(hat_len + 1)) * np.exp(-np.arange(hat_len) / SR * 90) * 0.25

    scale = [0, 2, 3, 5, 7, 8, 10] if minor else [0, 2, 4, 5, 7, 9, 11]
    root_pc = NOTE[root]
    for b in range(beats):
        s = int(b * beat * SR)
        e = min(n, s + kick_len)
        left[s:e] += kick[: e - s] * 0.9
        right[s:e] += kick[: e - s] * 0.9
        h = int((b + 0.5) * beat * SR)
        e = min(n, h + hat_len)
        if h < n:
            left[h:e] += hat[: e - h] * 0.8
            right[h:e] += hat[: e - h]

    bar = 4 * beat
    for k in range(int(seconds / bar)):
        degree = progression[k % len(progression)]
        chord_root = root_pc + scale[degree]
        third = root_pc + scale[(degree + 2) % 7] + (12 if degree + 2 >= 7 else 0)
        fifth = root_pc + scale[(degree + 4) % 7] + (12 if degree + 4 >= 7 else 0)
        s = int(k * bar * SR)
        stab_n = int(beat * 0.9 * SR)
        for off in (0.5, 1.5, 2.5, 3.5):  # offbeat chord stabs
            p = s + int(off * beat * SR)
            if p + stab_n > n:
                continue
            env = np.exp(-np.arange(stab_n) / SR * 7)
            chord = sum(saw(440 * 2 ** ((pc + 48 - 69) / 12), stab_n, 0.004) for pc in (chord_root, third, fifth))
            chord = lowpass(chord * env, 2200) * 0.16
            left[p:p + stab_n] += chord
            right[p:p + stab_n] += chord * 0.9
        bass_n = int(beat * 0.45 * SR)
        for i in range(8):  # rolling eighth-note bass
            p = s + int((i * 0.5 + 0.25) * beat * SR)
            if p + bass_n > n:
                continue
            f = 440 * 2 ** ((chord_root + 36 - 69) / 12)
            env = np.exp(-np.arange(bass_n) / SR * 6)
            tone = lowpass(saw(f, bass_n) * env, 500) * 0.35
            left[p:p + bass_n] += tone
            right[p:p + bass_n] += tone

    stereo = np.stack([left, right], axis=1)
    fade = int(0.02 * SR)
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return stereo / np.max(np.abs(stereo)) * 0.89


def write_wav(path, stereo):
    pcm = (stereo * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tracks = [
        ("Test Audio - Neon Pulse (124 BPM, A minor)", 124, "A", True, [0, 5, 2, 6]),
        ("Test Audio - Glass Horizon (128 BPM, E minor)", 128, "E", True, [0, 3, 5, 4]),
        ("Test Audio - Golden Hour (120 BPM, F major)", 120, "F", False, [0, 4, 5, 3]),
    ]
    for name, bpm, root, minor, prog in tracks:
        path = OUT / f"{name}.wav"
        write_wav(path, render(bpm, root, minor, prog))
        print(f"wrote {path.relative_to(ROOT)}")
    m4a = OUT / f"{tracks[2][0]}.m4a"
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", str(OUT / f"{tracks[2][0]}.wav"), str(m4a)], check=False)
    if m4a.exists():
        (OUT / f"{tracks[2][0]}.wav").unlink()
        print(f"converted to {m4a.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
