// Position and margin-profile math, mirroring Strike's documented backend formulas
// (docs.strikefinance.org/perpetuals/liquidations, strike-calculations skill).

import type { Account, Market, Position, RawMarginTier, Tier } from "./types.ts";

export function normalizeTiers(raw: RawMarginTier[]): Tier[] {
  const tiers: Tier[] = [];
  for (let i = 0; i < raw.length; i++) {
    const mmr = Number(raw[i].maintenance_margin_rate);
    // The engine ignores supplied maintenance amounts and derives them for tier continuity.
    const ma = i === 0 ? 0 : tiers[i - 1].ma + tiers[i - 1].maxNotional * (mmr - tiers[i - 1].mmr);
    tiers.push({ maxNotional: Number(raw[i].max_notional), maxLeverage: raw[i].max_leverage, mmr, ma });
  }
  return tiers;
}

/** First tier with notional ≤ max_notional; the last tier above the schedule. */
export function tierIndex(tiers: Tier[], notional: number): number {
  for (let i = 0; i < tiers.length; i++) if (notional <= tiers[i].maxNotional) return i;
  return tiers.length - 1;
}

export function maintenanceMargin(tiers: Tier[], notional: number): number {
  if (notional <= 0) return 0;
  const t = tiers[tierIndex(tiers, notional)];
  return notional * t.mmr - t.ma;
}

export interface PositionState {
  pos: Position;
  mark: number;
  notional: number;
  upnl: number;
  mm: number;
  mmr: number;
  ma: number;
}

export function positionState(pos: Position, mark: number, market: Market): PositionState {
  const notional = Math.abs(pos.size) * mark;
  const t = market.tiers[tierIndex(market.tiers, notional)];
  return {
    pos,
    mark,
    notional,
    upnl: (mark - pos.entry) * pos.size,
    mm: notional > 0 ? notional * t.mmr - t.ma : 0,
    mmr: t.mmr,
    ma: t.ma,
  };
}

export type RiskLevel = "none" | "margin_call" | "reduce_only" | "liquidate" | "bankrupt";

/** A margin profile: the whole cross book of an account, or one isolated position. */
export interface Profile {
  key: string;
  mode: "cross" | "isolated";
  account: Account;
  /** Base balance W. */
  base: number;
  upnl: number;
  mm: number;
  states: PositionState[];
  marginBalance: number;
  /** MM / MB; Infinity when bankrupt. */
  ratio: number;
  level: RiskLevel;
}

export function classify(base: number, upnl: number, mm: number): { mb: number; ratio: number; level: RiskLevel } {
  const mb = base + upnl;
  if (mm === 0) return { mb, ratio: 0, level: "none" };
  // The docs also list "base balance ≤ 0", but mainnet keeps accounts with a negative base balance and a
  // positive margin balance open (they appear in live positions with normal liquidation prices), so only
  // a nonpositive margin balance is treated as bankrupt here.
  if (mb <= 0) return { mb, ratio: Infinity, level: "bankrupt" };
  const ratio = mm / mb;
  const level: RiskLevel = ratio >= 1 ? "liquidate" : ratio >= 0.9 ? "reduce_only" : ratio >= 0.7 ? "margin_call" : "none";
  return { mb, ratio, level };
}

export function crossProfile(account: Account, marks: Record<string, number>, markets: Record<string, Market>): Profile | null {
  const states = account.positions
    .filter((p) => p.mode === "cross" && p.size !== 0)
    .map((p) => positionState(p, marks[p.symbol], markets[p.symbol]));
  if (states.length === 0) return null;
  const upnl = states.reduce((s, x) => s + x.upnl, 0);
  const mm = states.reduce((s, x) => s + x.mm, 0);
  const c = classify(account.crossBalance, upnl, mm);
  return { key: account.key + ":cross", mode: "cross", account, base: account.crossBalance, upnl, mm, states, marginBalance: c.mb, ratio: c.ratio, level: c.level };
}

export function isolatedProfile(account: Account, pos: Position, mark: number, market: Market): Profile {
  const st = positionState(pos, mark, market);
  const c = classify(pos.isoBalance, st.upnl, st.mm);
  return { key: `${account.key}:iso:${pos.id}`, mode: "isolated", account, base: pos.isoBalance, upnl: st.upnl, mm: st.mm, states: [st], marginBalance: c.mb, ratio: c.ratio, level: c.level };
}

export function allProfiles(accounts: Account[], marks: Record<string, number>, markets: Record<string, Market>): Profile[] {
  const out: Profile[] = [];
  for (const a of accounts) {
    const cp = crossProfile(a, marks, markets);
    if (cp) out.push(cp);
    for (const p of a.positions) if (p.mode === "isolated" && p.size !== 0) out.push(isolatedProfile(a, p, marks[p.symbol], markets[p.symbol]));
  }
  return out;
}

/** Liquidation and bankruptcy price of one position inside its profile (unrounded; ≤ 0 → 0). */
export function liqAndBankruptcy(st: PositionState, profile: Profile): { liq: number; bankruptcy: number } {
  const size = st.pos.size;
  if (size === 0) return { liq: 0, bankruptcy: 0 };
  const others = profile.states.length > 1;
  const TU = others ? profile.upnl - st.upnl : 0;
  const TM = others ? profile.mm - st.mm : 0;
  const dir = Math.sign(size);
  const bankruptcy = st.pos.entry - (profile.base + TU) / size;
  const liq = (st.pos.entry - (profile.base + TU - TM + st.ma) / size) / (1 - dir * st.mmr);
  return { liq: liq > 0 ? liq : 0, bankruptcy: bankruptcy > 0 ? bankruptcy : 0 };
}

/** Maintenance margin released by reducing |size| by q, using the full tier schedule. */
export function releasedMaintenance(tiers: Tier[], absSize: number, q: number, mark: number): number {
  return maintenanceMargin(tiers, absSize * mark) - maintenanceMargin(tiers, Math.max(0, absSize - q) * mark);
}

export const floorToStep = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
export const ceilToStep = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;

export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** `x` as a decimal string with exactly as many decimals as `step` (Strike's size and price fields are strings). */
export function stepString(x: number, step: number): string {
  const s = step.toString();
  const decimals = s.includes("e-") ? Number(s.split("e-")[1]) + (s.split("e-")[0].split(".")[1]?.length ?? 0) : (s.split(".")[1]?.length ?? 0);
  return x.toFixed(decimals);
}
