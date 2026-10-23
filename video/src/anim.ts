import { Easing, interpolate, spring } from "remotion";
import { FPS } from "./theme";

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const f = (seconds: number) => Math.round(seconds * FPS);

/** 0 → 1 over `dur` seconds starting at `start` seconds. */
export const ramp = (frame: number, start: number, dur = 0.4, easing = Easing.out(Easing.cubic)) =>
  interpolate(frame, [f(start), f(start) + Math.max(1, f(dur))], [0, 1], { ...CLAMP, easing });

/** Spring that starts at `start` seconds. */
export const pop = (frame: number, start: number, damping = 14) => spring({ frame: frame - f(start), fps: FPS, config: { damping, mass: 0.6 } });

export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export const usdShort = (x: number) => {
  const a = Math.abs(x);
  const s = x < 0 ? "−$" : "$";
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${a.toFixed(0)}`;
};
