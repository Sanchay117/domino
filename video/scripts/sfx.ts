// Sound design, synthesized from scratch (no samples, nothing to license):
//   public/sfx/tock-N.wav  a domino striking the next one (modal synthesis), five pitches
//   public/sfx/key.wav     a soft keyboard click
//   public/sfx/whoosh.wav  band-passed noise sweep for transitions
//   public/sfx/hit.wav     a low, soft impact for the title
//   public/sfx/pop.wav     a short tonal blip for UI elements appearing
//   public/music/bed.wav   an ambient A-minor pad under the whole video
// Deterministic: a seeded PRNG drives all noise.

import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { BEAT, TEASER } from "../src/teaserPlan.ts";

const SR = 48000;
const TAU = Math.PI * 2;

let seed = 0x2f6e2b1;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

function wav(path: string, left: Float32Array, right = left) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  const s = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(s(left[i]), 44 + i * 4);
    buf.writeInt16LE(s(right[i]), 46 + i * 4);
  }
  writeFileSync(new URL(`../public/${path}`, import.meta.url), buf);
  console.log(`${path}  ${(n / SR).toFixed(2)} s`);
}

function normalize(x: Float32Array, peak: number) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Chamberlin state-variable filter; returns the band-pass (or low-pass) output for a time-varying cutoff. */
function svf(input: Float32Array, cutoff: (i: number) => number, q: number, mode: "bp" | "lp" | "hp") {
  const out = new Float32Array(input.length);
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const fc = 2 * Math.sin((Math.PI * Math.min(cutoff(i), SR / 6)) / SR);
    low += fc * band;
    const high = input[i] - low - q * band;
    band += fc * high;
    out[i] = mode === "bp" ? band : mode === "lp" ? low : high;
  }
  return out;
}

// --- one-shots ---------------------------------------------------------------------------------

function tock(scale: number) {
  const n = Math.floor(SR * 0.16);
  const x = new Float32Array(n);
  const modes = [
    [1180, 0.045, 1],
    [2290, 0.026, 0.55],
    [3410, 0.016, 0.3],
    [5200, 0.008, 0.18],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [fr, d, a] of modes) v += a * Math.exp(-t / d) * Math.sin(TAU * fr * scale * t);
    v += 0.6 * rand() * Math.exp(-t / 0.0025);
    x[i] = v * Math.min(1, t / 0.0004);
  }
  return normalize(svf(x, () => 7000, 0.7, "lp"), 0.9);
}

function key() {
  const n = Math.floor(SR * 0.05);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = (0.5 * Math.sin(TAU * 3100 * t) * Math.exp(-t / 0.006) + rand() * Math.exp(-t / 0.0018)) * Math.min(1, t / 0.0003);
  }
  return normalize(svf(x, () => 2600, 0.9, "hp"), 0.8);
}

function whoosh() {
  const dur = 0.9;
  const n = Math.floor(SR * dur);
  const noise = Float32Array.from({ length: n }, () => rand());
  const bp = svf(noise, (i) => 350 + 2600 * Math.sin((Math.PI * i) / n) ** 2, 0.6, "bp");
  for (let i = 0; i < n; i++) bp[i] *= Math.sin((Math.PI * i) / n) ** 2;
  return normalize(bp, 0.8);
}

function hit() {
  const n = Math.floor(SR * 1.8);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (TAU * (46 + 50 * Math.exp(-t / 0.06))) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t / 0.45) * Math.min(1, t / 0.002) + 0.12 * rand() * Math.exp(-t / 0.08);
  }
  return normalize(svf(x, () => 900, 0.8, "lp"), 0.9);
}

function pop() {
  const n = Math.floor(SR * 0.12);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (TAU * (880 + 500 * Math.exp(-t / 0.01))) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t / 0.03) * Math.min(1, t / 0.001);
  }
  return normalize(x, 0.7);
}

// --- music bed ---------------------------------------------------------------------------------

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
// A minor, slow: Am · Fmaj7 · C · G(add6), eight seconds each.
const CHORDS = [
  [45, 57, 60, 64, 69],
  [41, 53, 57, 64, 69],
  [48, 55, 60, 64, 67],
  [43, 55, 59, 62, 64],
];
const BAR = 8;

/** The pad. Chord `b` starts at `offset + b × bar` seconds and is CHORDS[(b + first) % 4]. */
function bed(seconds: number, bar = BAR, offset = 0, first = 0) {
  const n = Math.floor(SR * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const voices: { f: number; start: number; dur: number; pan: number; amp: number }[] = [];
  for (let b = 0; offset + b * bar < seconds + bar; b++) {
    const chord = CHORDS[(b + first) % CHORDS.length];
    const swell = Math.min(1.5, bar * 0.2);
    for (const [k, m] of chord.entries()) {
      for (const det of [-0.06, 0, 0.06]) {
        voices.push({ f: hz(m + det), start: offset + b * bar - swell, dur: bar + 2 * swell, pan: (k / (chord.length - 1) - 0.5) * 0.7 + det * 2, amp: k === 0 ? 0.5 : 0.28 });
      }
    }
  }
  for (const v of voices) {
    const i0 = Math.max(0, Math.floor(v.start * SR));
    const i1 = Math.min(n, Math.floor((v.start + v.dur) * SR));
    const gl = Math.cos(((v.pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((v.pan + 1) * Math.PI) / 4);
    const phase0 = Math.abs(rand()) * TAU;
    for (let i = i0; i < i1; i++) {
      const t = i / SR - v.start;
      // Slow swell in and out.
      const env = Math.sin((Math.PI * Math.min(1, Math.max(0, t / v.dur))) ** 1) ** 2;
      const p = TAU * v.f * t + phase0;
      // Soft, mostly-odd harmonics: a warm, hollow pad.
      const s = Math.sin(p) + 0.32 * Math.sin(2 * p) + 0.22 * Math.sin(3 * p) + 0.08 * Math.sin(5 * p);
      const x = s * env * v.amp;
      L[i] += x * gl;
      R[i] += x * gr;
    }
  }
  // Breathing low-pass, then a small Schroeder reverb for space.
  const lfo = (i: number) => 1400 + 700 * Math.sin((TAU * i) / SR / 23);
  const lp = (x: Float32Array) => svf(x, lfo, 1.1, "lp");
  const [l2, r2] = [reverb(lp(L), 0), reverb(lp(R), 1)];
  // Fade in and out.
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = Math.min(1, t / 2.5) * Math.min(1, (seconds - t) / 3);
    l2[i] *= g;
    r2[i] *= g;
  }
  const peak = 0.5 / Math.max(...[l2, r2].map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  for (let i = 0; i < n; i++) {
    l2[i] *= peak;
    r2[i] *= peak;
  }
  return [l2, r2] as const;
}

function reverb(x: Float32Array, ch: number) {
  const spread = ch * 23;
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: d + spread, buf: new Float32Array(d + spread), i: 0 }));
  const alls = [225, 556].map((d) => ({ d: d + spread, buf: new Float32Array(d + spread), i: 0 }));
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let wet = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.buf[c.i] = x[n] + y * 0.84;
      c.i = (c.i + 1) % c.d;
      wet += y;
    }
    wet /= combs.length;
    for (const a of alls) {
      const y = a.buf[a.i];
      const v = wet + y * -0.5;
      a.buf[a.i] = v;
      a.i = (a.i + 1) % a.d;
      wet = y - v * -0.5;
    }
    out[n] = 0.65 * x[n] + 0.55 * wet;
  }
  return out;
}

// --- teaser track: the pad plus drums and bass on the shared beat grid --------------------------

function kick(): Float32Array {
  const n = Math.floor(SR * 0.4);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (TAU * (48 + 110 * Math.exp(-t / 0.035))) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t / 0.22) + 0.25 * rand() * Math.exp(-t / 0.003);
  }
  return x;
}

function snare(): Float32Array {
  const n = Math.floor(SR * 0.25);
  const noise = Float32Array.from({ length: n }, () => rand());
  const body = svf(noise, () => 1900, 0.9, "bp");
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    body[i] = 1.6 * body[i] * Math.exp(-t / 0.09) + 0.5 * Math.sin(TAU * 190 * t) * Math.exp(-t / 0.05);
  }
  return body;
}

function hat(): Float32Array {
  const n = Math.floor(SR * 0.06);
  const noise = Float32Array.from({ length: n }, () => rand());
  const hp = svf(noise, () => 7500, 0.8, "hp");
  for (let i = 0; i < n; i++) hp[i] *= Math.exp(-i / SR / 0.018);
  return hp;
}

function crash(): Float32Array {
  const n = Math.floor(SR * 1.6);
  const noise = Float32Array.from({ length: n }, () => rand());
  const hp = svf(noise, () => 5000, 0.7, "hp");
  for (let i = 0; i < n; i++) hp[i] *= Math.exp(-i / SR / 0.45);
  return hp;
}

function riser(seconds: number): Float32Array {
  const n = Math.floor(SR * seconds);
  const noise = Float32Array.from({ length: n }, () => rand());
  const bp = svf(noise, (i) => 300 + 6000 * (i / n) ** 2, 0.5, "bp");
  for (let i = 0; i < n; i++) bp[i] *= (i / n) ** 2;
  return bp;
}

function add(dst: Float32Array, src: Float32Array, at: number, gain: number) {
  const i0 = Math.floor(at * SR);
  for (let i = 0; i < src.length && i0 + i < dst.length; i++) dst[i0 + i] += src[i] * gain;
}

function teaserTrack() {
  const { seconds, drop, end } = TEASER;
  // Chords change every two bars, landing on A minor at the drop.
  const [padL, padR] = bed(seconds, 4 * BEAT * 2, drop - 8 * BEAT, CHORDS.length - 1);
  const n = padL.length;
  const drums = new Float32Array(n);
  const bass = new Float32Array(n);
  const k = kick();
  const s = snare();
  const h = hat();
  const kicks: number[] = [];
  for (let t = drop; t < end - 1e-6; t += BEAT) {
    const beat = Math.round((t - drop) / BEAT);
    // A one-beat breath before the end card.
    if (t >= end - BEAT) break;
    add(drums, k, t, 0.95);
    kicks.push(t);
    if (beat % 2 === 1) add(drums, s, t, 0.5);
    add(drums, h, t + BEAT / 2, beat % 4 === 3 ? 0.3 : 0.2);
  }
  // Plucked bass on eighth notes: the root of the current chord, plus a sub an octave down.
  for (let t = drop; t < end - BEAT - 1e-6; t += BEAT / 2) {
    const chord = CHORDS[Math.floor((t - drop) / (8 * BEAT)) % CHORDS.length];
    const f0 = hz(chord[0]);
    const len = Math.floor(SR * 0.22);
    const i0 = Math.floor(t * SR);
    for (let i = 0; i < len && i0 + i < n; i++) {
      const tt = i / SR;
      const p = TAU * f0 * tt;
      const v = (Math.sin(p) + 0.45 * Math.sin(2 * p) + 0.2 * Math.sin(3 * p) + 0.6 * Math.sin(p / 2)) * Math.exp(-tt / 0.12) * Math.min(1, tt / 0.004);
      bass[i0 + i] += v * 0.32;
    }
  }
  const bassLp = svf(bass, () => 700, 1.0, "lp");
  // Impacts on the drop and on the end card, with a riser into the drop.
  const impact = new Float32Array(n);
  add(impact, riser(1.5), drop - 1.5, 0.5);
  for (const t of [drop, end]) {
    add(impact, hit(), t, 0.8);
    add(impact, crash(), t, 0.35);
    add(impact, k, t, 1);
  }
  // Sidechain: the pad and bass duck under every kick.
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let next = 0;
  let last = -10;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (next < kicks.length && kicks[next] <= t) last = kicks[next++];
    const duck = 1 - 0.55 * Math.exp(-(t - last) / 0.13);
    const music = (padL[i] * 0.8 + bassLp[i]) * duck;
    const musicR = (padR[i] * 0.8 + bassLp[i]) * duck;
    L[i] = music + drums[i] * 0.6 + impact[i] * 0.6;
    R[i] = musicR + drums[i] * 0.6 + impact[i] * 0.6;
  }
  const peak = 0.9 / Math.max(...[L, R].map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  for (let i = 0; i < n; i++) {
    L[i] *= peak;
    R[i] *= peak;
  }
  return [L, R] as const;
}

mkdirSync(new URL("../public/sfx", import.meta.url), { recursive: true });
mkdirSync(new URL("../public/music", import.meta.url), { recursive: true });
[0.86, 0.93, 1, 1.07, 1.15].forEach((k, i) => wav(`sfx/tock-${i + 1}.wav`, tock(k)));
wav("sfx/key.wav", key());
wav("sfx/whoosh.wav", whoosh());
wav("sfx/hit.wav", hit());
wav("sfx/pop.wav", pop());
const total = JSON.parse(readFileSync(new URL("../src/generated/timing.json", import.meta.url), "utf8")).total as number;
const [l, r] = bed(total);
wav("music/bed.wav", l, r);
const [tl, tr] = teaserTrack();
wav("music/teaser.wav", tl, tr);
