#!/usr/bin/env python3
"""
Generate one short sound per Skype emoticon.

Why this exists: classic Skype shipped ~40 EVENT sounds (message, ring,
login) and never had per-emoticon audio, so there is no authentic archive
to draw 105 sounds from. These are synthesized from scratch — no sampled
material, nothing anyone else owns — which is also what lets them ship
from a public repo.

Design: every emoticon is assigned a semantic ARCHETYPE (a family that
shares a timbre and gesture — `sparkle` for the cheerful ones, `sad` for
the downcast ones, `clink` for drinks, and so on) plus a deterministic
pitch offset derived from its key. So the family reads instantly, no two
emoticons sound identical, and re-running this produces byte-identical
output.

The nine emoticons with a real Skype event-sound counterpart (skype, call,
phone, hi, sleepy, wait, talktothehand, mail, handshake) are skipped by
default — those keep the genuine article. Pass --all to synthesize them too.

Usage:
    python3 scripts/gen-skype-sounds.py --out /tmp/skype-sounds
    python3 scripts/gen-skype-sounds.py --out /tmp/skype-sounds --all

Requires: numpy, ffmpeg (for mp3 encode).
"""
from __future__ import annotations

import argparse
import hashlib
import math
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / "src" / "lib" / "skypeEmojis.ts"

# Emoticons that keep their authentic Skype event sound.
AUTHENTIC = {"skype", "call", "phone", "hi", "sleepy", "wait",
             "talktothehand", "mail", "handshake"}

# Major pentatonic — any pitch offset lands on a consonant note, so the
# per-emoticon variation can never produce a sour interval.
PENT = [0, 2, 4, 7, 9]


def semitone(n: float) -> float:
    """Frequency of a semitone offset from A4=440."""
    return 440.0 * (2.0 ** (n / 12.0))


def env(n: int, attack: float, decay: float, sustain: float = 0.0,
        release: float = 0.25) -> np.ndarray:
    """ADSR-ish envelope. Zero at both ends so nothing clicks."""
    a = max(1, int(n * attack))
    d = max(1, int(n * decay))
    r = max(1, int(n * release))
    s = max(0, n - a - d - r)
    out = np.concatenate([
        np.linspace(0.0, 1.0, a) ** 0.6,
        np.linspace(1.0, sustain if s or r else 0.0, d),
        np.full(s, sustain),
        np.linspace(sustain if s else 0.0, 0.0, r) ** 1.4,
    ])
    return np.resize(out, n)


def tone(freq: float, dur: float, kind: str = "sine", detune: float = 0.0,
         vibrato: float = 0.0) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = freq * (1.0 + vibrato * np.sin(2 * np.pi * 5.5 * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    if kind == "sine":
        w = np.sin(phase)
    elif kind == "tri":
        w = 2.0 / np.pi * np.arcsin(np.sin(phase))
    elif kind == "saw":
        w = 2.0 * ((phase / (2 * np.pi)) % 1.0) - 1.0
    elif kind == "square":
        w = np.sign(np.sin(phase))
    elif kind == "fm":  # bell-ish
        w = np.sin(phase + 2.5 * np.sin(phase * 2.01) * np.exp(-4 * t))
    else:
        raise ValueError(kind)
    if detune:
        w = 0.5 * w + 0.5 * tone(freq * (1 + detune), dur, kind)
    return w


def sweep(f0: float, f1: float, dur: float, kind: str = "sine") -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = np.geomspace(max(f0, 1.0), max(f1, 1.0), n)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) if kind == "sine" else 2.0 * ((phase / (2 * np.pi)) % 1.0) - 1.0


def noise(dur: float, seed: int) -> np.ndarray:
    # abs(): callers seed from a pitch offset, which is negative below A4.
    rng = np.random.default_rng(abs(int(seed)) + 1)
    return rng.standard_normal(int(SR * dur))


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """One-pole lowpass — enough to take the fizz off synthesized noise."""
    a = math.exp(-2.0 * math.pi * cutoff / SR)
    out = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        out[i] = acc
    return out


def place(canvas: np.ndarray, part: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = int(SR * at)
    j = min(len(canvas), i + len(part))
    if j > i:
        canvas[i:j] += part[: j - i] * gain


def blank(dur: float) -> np.ndarray:
    return np.zeros(int(SR * dur))


# ── archetypes ───────────────────────────────────────────────────────────
# Each returns a mono float array. `k` is the emoticon's pitch offset.

def a_sparkle(k: int) -> np.ndarray:
    out = blank(0.62)
    for i, step in enumerate([0, 4, 7, 12]):
        f = semitone(k + step + 12)
        d = 0.30
        place(out, tone(f, d, "tri") * env(int(SR * d), 0.01, 0.3), 0.055 * i, 0.55)
    return out


def a_laugh(k: int) -> np.ndarray:
    out = blank(0.72)
    for i in range(4):
        f = semitone(k + 12 + (2 if i % 2 else 0))
        d = 0.13
        place(out, tone(f, d, "tri", vibrato=0.05) * env(int(SR * d), 0.02, 0.4),
              0.13 * i, 0.62 - 0.09 * i)
    return out


def a_warm(k: int) -> np.ndarray:
    out = blank(0.85)
    for step in (0, 4, 7):
        d = 0.8
        place(out, tone(semitone(k + step), d, "sine", detune=0.004, vibrato=0.02)
              * env(int(SR * d), 0.18, 0.35, 0.35, 0.4), 0.0, 0.4)
    return out


def a_sad(k: int) -> np.ndarray:
    out = blank(0.8)
    for i, step in enumerate([3, 0, -2]):
        d = 0.42
        place(out, tone(semitone(k + step), d, "sine", detune=0.006)
              * env(int(SR * d), 0.05, 0.5), 0.14 * i, 0.55 - 0.1 * i)
    return out


def a_harsh(k: int) -> np.ndarray:
    out = blank(0.55)
    d = 0.5
    base = tone(semitone(k - 12), d, "saw", detune=0.02)
    base = np.tanh(base * 3.2)  # drive
    place(out, base * env(int(SR * d), 0.01, 0.35), 0.0, 0.5)
    place(out, lowpass(noise(0.18, k + 7), 1400) * env(int(SR * 0.18), 0.01, 0.5), 0.0, 0.25)
    return out


def a_blip(k: int) -> np.ndarray:
    out = blank(0.4)
    d = 0.26
    place(out, sweep(semitone(k + 7), semitone(k + 16), d) * env(int(SR * d), 0.03, 0.4),
          0.0, 0.6)
    return out


def a_clink(k: int) -> np.ndarray:
    out = blank(0.7)
    for i, mult in enumerate([1.0, 2.76, 5.4]):  # inharmonic → glassy
        d = 0.6 - 0.12 * i
        place(out, tone(semitone(k + 19) * mult / 2, d, "sine")
              * env(int(SR * d), 0.002, 0.6), 0.0, 0.34 / (i + 1))
    place(out, noise(0.03, k) * env(int(SR * 0.03), 0.001, 0.8), 0.0, 0.16)
    return out


def a_ring(k: int) -> np.ndarray:
    out = blank(0.85)
    for i in range(2):
        for step in (0, 5):
            d = 0.26
            place(out, tone(semitone(k + 12 + step), d, "sine")
                  * env(int(SR * d), 0.02, 0.35, 0.3, 0.3), 0.42 * i, 0.35)
    return out


def a_mech(k: int) -> np.ndarray:
    out = blank(0.55)
    for i in range(3):
        place(out, lowpass(noise(0.035, k + i), 2600) * env(int(SR * 0.035), 0.001, 0.7),
              0.085 * i, 0.5)
    d = 0.34
    place(out, tone(semitone(k - 5), d, "square") * env(int(SR * d), 0.02, 0.5), 0.1, 0.16)
    return out


def a_animal(k: int) -> np.ndarray:
    out = blank(0.6)
    d = 0.42
    body = sweep(semitone(k + 10), semitone(k + 4), d)
    body = body * (1 + 0.35 * np.sin(2 * np.pi * 24 * np.arange(len(body)) / SR))  # bleat
    place(out, body * env(int(SR * d), 0.04, 0.4), 0.0, 0.5)
    return out


def a_fanfare(k: int) -> np.ndarray:
    out = blank(0.9)
    for i, step in enumerate([0, 4, 7]):
        d = 0.5
        place(out, tone(semitone(k + step), d, "saw", detune=0.008)
              * env(int(SR * d), 0.02, 0.3, 0.28, 0.4), 0.075 * i, 0.3)
    d = 0.55
    place(out, tone(semitone(k + 12), d, "saw", detune=0.01)
          * env(int(SR * d), 0.03, 0.3, 0.25, 0.45), 0.22, 0.34)
    return out


def a_zap(k: int) -> np.ndarray:
    out = blank(0.45)
    d = 0.3
    place(out, lowpass(noise(d, k), 5200) * np.geomspace(1.0, 0.02, int(SR * d))
          * env(int(SR * d), 0.005, 0.5), 0.0, 0.55)
    place(out, sweep(semitone(k + 26), semitone(k + 2), 0.26) * env(int(SR * 0.26), 0.005, 0.5),
          0.0, 0.3)
    return out


def a_wobble(k: int) -> np.ndarray:
    out = blank(0.75)
    d = 0.62
    n = int(SR * d)
    t = np.arange(n) / SR
    f = semitone(k + 8) * np.exp(-1.15 * t)  # comic slide down
    phase = 2 * np.pi * np.cumsum(f) / SR
    w = np.sin(phase + 0.6 * np.sin(2 * np.pi * 7 * t))
    place(out, w * env(n, 0.02, 0.4, 0.2, 0.4), 0.0, 0.55)
    return out


def a_beat(k: int) -> np.ndarray:
    out = blank(0.8)
    for i in range(4):
        thump = lowpass(noise(0.09, k + i), 220) + tone(semitone(k - 17), 0.09, "sine")
        place(out, thump * env(int(SR * 0.09), 0.002, 0.6), 0.165 * i, 0.5)
        if i % 2:
            place(out, lowpass(noise(0.04, k + 9 + i), 7000) * env(int(SR * 0.04), 0.001, 0.7),
                  0.165 * i, 0.2)
    return out


def a_neutral(k: int) -> np.ndarray:
    out = blank(0.5)
    for i, step in enumerate([0, 5]):
        d = 0.3
        place(out, tone(semitone(k + 12 + step), d, "sine") * env(int(SR * d), 0.02, 0.4),
              0.11 * i, 0.5)
    return out


ARCHETYPES = {
    "sparkle": a_sparkle, "laugh": a_laugh, "warm": a_warm, "sad": a_sad,
    "harsh": a_harsh, "blip": a_blip, "clink": a_clink, "ring": a_ring,
    "mech": a_mech, "animal": a_animal, "fanfare": a_fanfare, "zap": a_zap,
    "wobble": a_wobble, "beat": a_beat, "neutral": a_neutral,
}

# Semantic assignment. Anything unlisted falls back to `neutral`.
ASSIGN = {
    "sparkle": ["smile", "happy", "star", "sunshine", "flower", "idea", "cool",
                "wink", "blushing", "cake", "fingerscrossed", "whew", "nerd"],
    "laugh": ["bigsmile", "giggle", "rofl", "tongueout", "smirk", "evilgrin", "lalala"],
    "warm": ["heart", "inlove", "kiss", "hug", "angel", "mmm"],
    "sad": ["sadsmile", "crying", "worried", "brokenheart", "emo", "dull", "envy",
            "waiting", "tumbleweed"],
    "harsh": ["angry", "devil", "swear", "punch", "wtf", "fubar", "mooning", "finger",
              "headbang"],
    "blip": ["thinking", "wondering", "speechless", "surprised", "lipssealed", "tmi",
             "no", "shake"],
    "clink": ["beer", "drink", "coffee", "pizza", "poolparty", "cash"],
    "ring": ["talking", "movie", "time"],
    "mech": ["bike", "bug", "wfh", "makeup", "smoking", "rain"],
    "animal": ["cat", "dog", "sheep", "heidy", "oliver", "toivo"],
    "fanfare": ["captain", "muscle", "highfive", "party", "clapping", "shielddeflect",
                "nickfury", "bucky", "blackwidow", "dancing", "music", "bartlett"],
    "zap": ["ninja", "bandit"],
    "wobble": ["doh", "facepalm", "drunk", "puking", "yawning", "sweating"],
    "beat": ["nod", "bow", "yes", "handshake"],
}


def archetype_for(key: str) -> str:
    for name, keys in ASSIGN.items():
        if key in keys:
            return name
    return "neutral"


def family_slots(all_keys: list[str]) -> dict[str, int]:
    """Position of each emoticon within its archetype family.

    Pitch is assigned from this position, NOT from a hash of the key: with
    only 15 usable pentatonic slots a hash collides constantly, and two
    emoticons in one family that draw the same slot render byte-identical
    audio. Walking the slots in order guarantees every member of a family
    sounds different from every other."""
    seen: dict[str, int] = {}
    slots: dict[str, int] = {}
    for key in all_keys:
        fam = archetype_for(key)
        slots[key] = seen.get(fam, 0)
        seen[fam] = slots[key] + 1
    return slots


def pitch_for(slot: int) -> int:
    """Pentatonic degree + octave for a family slot. 15 distinct pitches
    before it wraps; the wrap adds an octave so it still doesn't repeat."""
    deg = PENT[slot % len(PENT)]
    octave = ((slot // len(PENT)) % 3) - 1
    return deg + 12 * octave + (12 if slot >= 15 else 0)


def normalize(x: np.ndarray, peak_db: float = -3.0) -> np.ndarray:
    x = np.tanh(x * 1.05)  # soft limit before scaling
    m = float(np.max(np.abs(x))) or 1.0
    return x * (10 ** (peak_db / 20.0)) / m


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = np.clip(x, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def load_keys() -> list[str]:
    src = CATALOG.read_text(encoding="utf-8")
    return re.findall(r"\{ key: '([a-z0-9]+)'", src)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output directory for .mp3 files")
    ap.add_argument("--all", action="store_true",
                    help="also synthesize the emoticons that have authentic Skype audio")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / "_wav"
    tmp.mkdir(exist_ok=True)

    keys = load_keys()
    if not keys:
        print("no emoticons found in catalog", file=sys.stderr)
        return 1

    slots = family_slots(keys)
    made = 0
    for key in keys:
        if key in AUTHENTIC and not args.all:
            continue
        arch = archetype_for(key)
        audio = normalize(ARCHETYPES[arch](pitch_for(slots[key])))
        wav = tmp / f"{key}.wav"
        write_wav(wav, audio)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
             "-codec:a", "libmp3lame", "-b:a", "96k", "-ar", "44100", "-ac", "1",
             str(out_dir / f"{key}.mp3")],
            check=True,
        )
        wav.unlink()
        made += 1
        print(f"{key:16s} {arch}")

    tmp.rmdir()
    print(f"\n{made} sounds → {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
