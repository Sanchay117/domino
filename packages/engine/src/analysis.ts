// Read-only risk analytics on a snapshot, plus scenario builders and search helpers on top of the simulator.

import { allProfiles, ceilToStep, liqAndBankruptcy, positionState, type Profile, type PositionState, type RiskLevel } from "./math.ts";
import { simulate, type Scenario, type Shape, type SimParams, type SimResult } from "./simulator.ts";
import type { Account, Position, Snapshot } from "./types.ts";

export interface PositionRisk {
  pos: Position;
  account: Account;
  profile: Profile;
  state: PositionState;
  side: "long" | "short";
  notional: number;
  upnl: number;
  liq: number;
  bankruptcy: number;
  /** Signed fractional mark move to liquidation (−0.08 = mark must fall 8%); null when there is none. */
  liqDistance: number | null;
  ratio: number;
  level: RiskLevel;
}

export function currentMarks(snap: Snapshot): Record<string, number> {
  return Object.fromEntries(Object.values(snap.markets).map((m) => [m.symbol, m.mark]));
}

export function positionRisks(snap: Snapshot, marks = currentMarks(snap)): PositionRisk[] {
  const out: PositionRisk[] = [];
  for (const prof of allProfiles(snap.accounts, marks, snap.markets)) {
    for (const st of prof.states) {
      const { liq, bankruptcy } = liqAndBankruptcy(st, prof);
      out.push({
        pos: st.pos,
        account: prof.account,
        profile: prof,
        state: st,
        side: st.pos.size > 0 ? "long" : "short",
        notional: st.notional,
        upnl: st.upnl,
        liq,
        bankruptcy,
        liqDistance: liq > 0 ? liq / st.mark - 1 : null,
        ratio: prof.ratio,
        level: prof.level,
      });
    }
  }
  return out;
}

/** How closely the engine reproduces Strike's own served liquidation prices (at the marks they were served with). */
export function validateAgainstServed(snap: Snapshot, tolerance = 0.001): { matched: number; total: number; worst: number } {
  const marks: Record<string, number> = {};
  for (const a of snap.accounts) for (const p of a.positions) marks[p.symbol] = p.servedMark || snap.markets[p.symbol].mark;
  let matched = 0;
  let total = 0;
  let worst = 0;
  for (const r of positionRisks(snap, marks)) {
    total++;
    const served = r.pos.servedLiq;
    const err = served === 0 && r.liq === 0 ? 0 : Math.abs(r.liq - served) / Math.max(Math.abs(served), 1e-12);
    worst = Math.max(worst, err);
    if (err <= tolerance) matched++;
  }
  return { matched, total, worst };
}

export interface MarketRisk {
  symbol: string;
  name: string;
  category: string;
  mark: number;
  index: number;
  fundingRate: number;
  beta: number;
  positions: number;
  accounts: number;
  longUsd: number;
  shortUsd: number;
  /** Nearest long liquidation as a signed move (negative), and nearest short liquidation (positive). */
  nearestLong: number | null;
  nearestShort: number | null;
  longLiqUsd10: number;
  shortLiqUsd10: number;
  bidDepth10: number;
  askDepth10: number;
}

export function marketRisks(snap: Snapshot & { betas?: Record<string, number> }, risks = positionRisks(snap)): MarketRisk[] {
  const rows = new Map<string, MarketRisk>();
  const accts = new Map<string, Set<string>>();
  for (const m of Object.values(snap.markets)) {
    const book = snap.books[m.symbol] ?? { bids: [], asks: [] };
    const within = (side: "bids" | "asks") =>
      book[side].reduce((s, [p, q]) => s + (side === "bids" ? (p >= m.mark * 0.9 ? p * q : 0) : p <= m.mark * 1.1 ? p * q : 0), 0);
    rows.set(m.symbol, {
      symbol: m.symbol,
      name: m.name,
      category: m.category,
      mark: m.mark,
      index: m.index,
      fundingRate: m.fundingRate,
      beta: snap.betas?.[m.symbol] ?? 1,
      positions: 0,
      accounts: 0,
      longUsd: 0,
      shortUsd: 0,
      nearestLong: null,
      nearestShort: null,
      longLiqUsd10: 0,
      shortLiqUsd10: 0,
      bidDepth10: within("bids"),
      askDepth10: within("asks"),
    });
    accts.set(m.symbol, new Set());
  }
  for (const r of risks) {
    const row = rows.get(r.pos.symbol);
    if (!row) continue;
    row.positions++;
    accts.get(r.pos.symbol)!.add(r.account.key);
    if (r.side === "long") row.longUsd += r.notional;
    else row.shortUsd += r.notional;
    const d = r.liqDistance;
    if (d === null) continue;
    if (r.side === "long") {
      if (row.nearestLong === null || d > row.nearestLong) row.nearestLong = d;
      if (d >= -0.1) row.longLiqUsd10 += r.notional;
    } else {
      if (row.nearestShort === null || d < row.nearestShort) row.nearestShort = d;
      if (d <= 0.1) row.shortLiqUsd10 += r.notional;
    }
  }
  for (const [s, set] of accts) rows.get(s)!.accounts = set.size;
  return [...rows.values()];
}

export interface LadderBin {
  lo: number;
  hi: number;
  mid: number;
  longLiq: number;
  shortLiq: number;
  bids: number;
  asks: number;
}

/** Liquidation notional and resting depth bucketed by price around the mark (± range). */
export function liquidationLadder(snap: Snapshot, symbol: string, range = 0.25, bins = 50, risks = positionRisks(snap)): LadderBin[] {
  const m = snap.markets[symbol];
  const lo = m.mark * (1 - range);
  const hi = m.mark * (1 + range);
  const w = (hi - lo) / bins;
  const out: LadderBin[] = Array.from({ length: bins }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, mid: lo + (i + 0.5) * w, longLiq: 0, shortLiq: 0, bids: 0, asks: 0 }));
  const at = (p: number) => Math.floor((p - lo) / w);
  for (const r of risks) {
    if (r.pos.symbol !== symbol || r.liq <= 0) continue;
    const i = at(r.liq);
    if (i < 0 || i >= bins) continue;
    if (r.side === "long") out[i].longLiq += Math.abs(r.pos.size) * r.liq;
    else out[i].shortLiq += Math.abs(r.pos.size) * r.liq;
  }
  const book = snap.books[symbol] ?? { bids: [], asks: [] };
  for (const [p, q] of book.bids) {
    const i = at(p);
    if (i >= 0 && i < bins) out[i].bids += p * q;
  }
  for (const [p, q] of book.asks) {
    const i = at(p);
    if (i >= 0 && i < bins) out[i].asks += p * q;
  }
  return out;
}

export interface ScenarioOptions {
  rampSec?: number;
  holdSec?: number;
  shape?: Shape;
  name?: string;
}

/** Shock one market only. */
export const DEFAULT_RAMP_SEC = 180;
export const DEFAULT_HOLD_SEC = 60;

export function singleScenario(symbol: string, shock: number, o: ScenarioOptions = {}): Scenario {
  return {
    name: o.name ?? `${symbol} ${(shock * 100).toFixed(1)}%`,
    shocks: { [symbol]: shock },
    rampSec: o.rampSec ?? DEFAULT_RAMP_SEC,
    holdSec: o.holdSec ?? DEFAULT_HOLD_SEC,
    shape: o.shape ?? "crash",
  };
}

/**
 * Shock a leader market and move every other market by its beta relative to the leader
 * (betas estimated from Strike's own hourly candles).
 */
export function correlatedScenario(snap: Snapshot & { betas?: Record<string, number> }, shock: number, leader = "BTC-USD", o: ScenarioOptions = {}): Scenario {
  const betas = snap.betas ?? {};
  const bl = betas[leader] ?? 1;
  const shocks: Record<string, number> = {};
  for (const s of Object.keys(snap.markets)) {
    if (s === leader) {
      shocks[s] = shock;
      continue;
    }
    if (Math.abs(bl) < 0.2) continue;
    const rel = Math.max(0, Math.min(3, (betas[s] ?? 0) / bl));
    const v = Math.max(-0.95, shock * rel);
    if (Math.abs(v) > 1e-4) shocks[s] = v;
  }
  return {
    name: o.name ?? `${leader} ${(shock * 100).toFixed(1)}% (correlated)`,
    shocks,
    rampSec: o.rampSec ?? DEFAULT_RAMP_SEC,
    holdSec: o.holdSec ?? DEFAULT_HOLD_SEC,
    shape: o.shape ?? "crash",
  };
}

/** Profiles whose margin balance is already ≤ 0, or already past maintenance, in the snapshot itself. */
export function distressedAtSnapshot(snap: Snapshot, risks = positionRisks(snap)): PositionRisk[] {
  return risks.filter((r) => r.level === "bankrupt" || r.level === "liquidate");
}

export interface CurvePoint {
  shock: number;
  result: SimResult["totals"];
}

export function stressCurve(snap: Snapshot, make: (shock: number) => Scenario, shocks: number[], params: Partial<SimParams> = {}): CurvePoint[] {
  return shocks.map((shock) => ({ shock, result: simulate(snap, make(shock), params).totals }));
}

function hitBy(snap: Snapshot, positionId: number, scenario: Scenario, params: Partial<SimParams>): boolean {
  const r = simulate(snap, scenario, params);
  return r.fates.some((f) => f.positionId === positionId && f.firstHitT !== null);
}

/**
 * Smallest adverse move (as a positive fraction) at which the cascade simulation first touches the
 * position — liquidation attempt, backstop or ADL. Null when it survives `maxShock`.
 */
export function survivalShock(snap: Snapshot, positionId: number, make: (signedShock: number) => Scenario, params: Partial<SimParams> = {}, maxShock = 0.6): number | null {
  const pos = snap.accounts.flatMap((a) => a.positions).find((p) => p.id === positionId);
  if (!pos) return null;
  const adverse = pos.size > 0 ? -1 : 1;
  if (!hitBy(snap, positionId, make(adverse * maxShock), params)) return null;
  let lo = 0;
  let hi = maxShock;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (hitBy(snap, positionId, make(adverse * mid), params)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Copy of the snapshot with one position reduced by `fraction`, closed at the current mark (taker fee charged). */
export function withReducedPosition(snap: Snapshot, positionId: number, fraction: number): Snapshot {
  const accounts = snap.accounts.map((a) => {
    const idx = a.positions.findIndex((p) => p.id === positionId);
    if (idx < 0) return a;
    const p = a.positions[idx];
    const m = snap.markets[p.symbol];
    const q = Math.abs(p.size) * fraction;
    const realized = (m.mark - p.entry) * q * Math.sign(p.size) - m.mark * q * snap.takerRate;
    const np = { ...p, size: p.size * (1 - fraction) };
    let crossBalance = a.crossBalance;
    if (p.mode === "cross") crossBalance += realized;
    else {
      const iso = p.isoBalance + realized;
      np.isoBalance = iso * (1 - fraction);
      crossBalance += iso * fraction;
    }
    const positions = a.positions.slice();
    positions[idx] = np;
    return { ...a, crossBalance, positions };
  });
  return { ...snap, accounts };
}

export interface DeriskPlan {
  positionId: number;
  symbol: string;
  side: "long" | "short";
  currentSize: number;
  reduceSize: number;
  reduceFraction: number;
  targetShock: number;
  survivesWithoutAction: boolean;
}

/** Minimal reduce-only size so the position survives a cascade of `targetShock` (positive fraction). */
export function deriskPlan(snap: Snapshot, positionId: number, make: (signedShock: number) => Scenario, targetShock: number, params: Partial<SimParams> = {}): DeriskPlan | null {
  const pos = snap.accounts.flatMap((a) => a.positions).find((p) => p.id === positionId);
  if (!pos) return null;
  const m = snap.markets[pos.symbol];
  const adverse = pos.size > 0 ? -1 : 1;
  const scenario = make(adverse * targetShock);
  const base = { positionId, symbol: pos.symbol, side: (pos.size > 0 ? "long" : "short") as "long" | "short", currentSize: Math.abs(pos.size), targetShock };
  if (!hitBy(snap, positionId, scenario, params)) return { ...base, reduceSize: 0, reduceFraction: 0, survivesWithoutAction: true };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (hitBy(withReducedPosition(snap, positionId, mid), positionId, scenario, params)) lo = mid;
    else hi = mid;
  }
  const reduceSize = Math.min(Math.abs(pos.size), ceilToStep(Math.abs(pos.size) * hi, m.step));
  return { ...base, reduceSize, reduceFraction: reduceSize / Math.abs(pos.size), survivesWithoutAction: false };
}

export interface AdlEntry {
  rank: number;
  pos: Position;
  account: Account;
  upnl: number;
  pnlPct: number;
  effLeverage: number;
  score: number;
}

/**
 * Who is first in line for Type 1 ADL on one side of a market: profitable positions ranked by
 * profit % × effective leverage. These absorb the other side's losses when the backstop is full.
 */
export function adlQueue(snap: Snapshot, symbol: string, side: "long" | "short", risks = positionRisks(snap)): AdlEntry[] {
  const rows = risks
    .filter((r) => r.pos.symbol === symbol && r.side === side && r.upnl > 0)
    .map((r) => {
      const pnlPct = r.upnl / (Math.abs(r.pos.size) * r.pos.entry);
      const effLeverage = r.notional / Math.max(r.profile.marginBalance, 1e-9);
      return { pos: r.pos, account: r.account, upnl: r.upnl, pnlPct, effLeverage, score: pnlPct * effLeverage, rank: 0 };
    })
    .sort((a, b) => b.score - a.score || a.pos.id - b.pos.id);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function findPositions(snap: Snapshot, query: string): Position[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return snap.accounts.filter((a) => a.address.toLowerCase() === q || a.accountId.toLowerCase() === q || a.vaultId.toLowerCase() === q).flatMap((a) => a.positions);
}

export { positionState };
