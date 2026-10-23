// Staged solvent-liquidation rules from docs.strikefinance.org/perpetuals/liquidations.

import { ceilToStep, clamp, floorToStep, releasedMaintenance } from "./math.ts";
import type { Tier } from "./types.ts";

export const MAX_ATTEMPTS = 5;
export const BASE_NOTIONAL = 5000;

/** Attempts 1–4 are risk-scaled partials; attempt 5 requests the whole remaining position. */
export function attemptSize(absSize: number, ratio: number, mark: number, attempt: number, step: number): number {
  if (attempt >= MAX_ATTEMPTS) return absSize;
  const progress = clamp(ratio - 1, 0, 1);
  const fraction = 0.2 + 0.8 * progress;
  const desired = Math.min(absSize, BASE_NOTIONAL / mark + absSize * fraction);
  // Exact full reductions use the complete remaining size so no dust is left behind.
  if (desired >= absSize) return absSize;
  return floorToStep(desired, step);
}

/** Neutral Price = Mark − D × ReleasedMM / (Q × R). */
export function neutralPrice(tiers: Tier[], signedSize: number, q: number, mark: number, ratio: number): number {
  const dir = Math.sign(signedSize);
  const released = releasedMaintenance(tiers, Math.abs(signedSize), q, mark);
  return mark - (dir * released) / (q * ratio);
}

/** Commission-adjusted, tick-aligned IOC limit: long sells at NP/(1−c) rounded up, short buys at NP/(1+c) rounded down. */
export function iocLimit(neutral: number, dir: number, takerRate: number, tick: number): number {
  return dir > 0 ? ceilToStep(neutral / (1 - takerRate), tick) : floorToStep(neutral / (1 + takerRate), tick);
}

/** Adaptive liquidation fee for one fill: min(rate × notional, retention × max(0, surplus − commission)), floored. */
export function adaptiveLiquidationFee(
  fillPrice: number,
  fillSize: number,
  dir: number,
  neutral: number,
  commission: number,
  feeRate: number,
  retention: number,
): number {
  const gross = Math.max(0, fillSize * dir * (fillPrice - neutral));
  const net = Math.max(0, gross - commission);
  const fee = Math.min(feeRate * fillPrice * fillSize, retention * net);
  return Math.floor(fee * 1e8) / 1e8;
}
