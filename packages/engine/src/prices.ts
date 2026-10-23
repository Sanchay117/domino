// Impact prices and mark price, following docs.strikefinance.org/perpetuals/prices.

import { clamp, median3 } from "./math.ts";
import type { Level } from "./types.ts";

export const IMPACT_LEVELS = 50;
export const BASIS_SAMPLES = 60;
export const MARK_DEVIATION = 0.05;

/**
 * Quantity-weighted execution price for `notional` walked from the top of one book side
 * (top 50 levels only). Returns 0 when the side cannot fill the notional.
 */
export function impactPrice(side: Level[], notional: number): number {
  let spent = 0;
  let qty = 0;
  const n = Math.min(side.length, IMPACT_LEVELS);
  for (let i = 0; i < n; i++) {
    const [p, q] = side[i];
    if (p <= 0 || q <= 0) continue;
    const levelNotional = p * q;
    if (spent + levelNotional >= notional) {
      qty += (notional - spent) / p;
      return notional / qty;
    }
    spent += levelNotional;
    qty += q;
  }
  return 0;
}

/** Impact price with Strike's protection: invalid or outside 80–120% of the reference falls back to it. */
export function protectedImpact(ip: number, reference: number): number {
  if (ip <= 0 || ip < 0.8 * reference || ip > 1.2 * reference) return reference;
  return ip;
}

export interface MarkInputs {
  index: number;
  /** Most recently settled hourly funding rate. */
  fundingRate: number;
  /** Fraction of the funding hour still remaining, 0..1. */
  hourRemaining: number;
  /** Rolling basis samples (impact mid − index), newest last. */
  basis: number[];
  bestBid: number;
  bestAsk: number;
  last: number;
}

export interface MarkResult {
  mark: number;
  p1: number;
  p2: number;
  p3: number;
  usedFallback: boolean;
}

/** Mark = median(P1 funding-adjusted index, P2 index + average basis, P3 local price), with the 5% fallback to P2. */
export function markPrice(m: MarkInputs): MarkResult {
  const X = m.index;
  const p1 = X * (1 + m.fundingRate * m.hourRemaining);
  const avgBasis = m.basis.length ? m.basis.reduce((s, b) => s + b, 0) / m.basis.length : 0;
  const p2 = X + avgBasis;
  let bid = m.bestBid;
  let ask = m.bestAsk;
  const last = m.last > 0 ? m.last : X;
  if (!(ask > 0)) ask = Math.max(bid > 0 ? bid : 0, last);
  if (!(bid > 0)) bid = 0;
  const p3 = median3(bid, ask, last);
  const candidate = median3(p1, p2, p3);
  if (Math.abs(candidate - X) > MARK_DEVIATION * X) return { mark: p2, p1, p2, p3, usedFallback: true };
  return { mark: candidate, p1, p2, p3, usedFallback: false };
}

/** One basis sample from the current book, as collected on book updates. */
export function basisSample(bids: Level[], asks: Level[], index: number, impactNotional: number): number {
  const ib = protectedImpact(impactPrice(bids, impactNotional), index);
  const ia = protectedImpact(impactPrice(asks, impactNotional), index);
  return (ib + ia) / 2 - index;
}

export function pushBasis(samples: number[], sample: number): void {
  samples.push(sample);
  if (samples.length > BASIS_SAMPLES) samples.shift();
}

export { clamp };
