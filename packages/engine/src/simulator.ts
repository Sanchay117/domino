// Tick-by-tick replay of Strike's mark-price liquidation cycle under an index shock.
//
// Every simulated second is one accepted mark-price batch: the index moves, market makers re-quote,
// the mark is recomputed from the book, and the staged liquidation engine runs exactly as documented —
// deterministic queue, risk-scaled partial IOCs at the neutral-price bound, attempt 5 full close,
// then the Insurance Fund or Type 1 ADL backstop.

import { SimBook, type Fill, type TaggedFill } from "./book.ts";
import { adaptiveLiquidationFee, attemptSize, iocLimit, MAX_ATTEMPTS, neutralPrice } from "./liquidation.ts";
import { clamp, crossProfile, isolatedProfile, liqAndBankruptcy, positionState, type Profile, type PositionState } from "./math.ts";
import { basisSample, BASIS_SAMPLES, markPrice, pushBasis } from "./prices.ts";
import type { Account, Market, Position, Snapshot } from "./types.ts";

export type Shape = "linear" | "crash" | "wick";

export interface Scenario {
  name: string;
  /** Fractional index move per symbol at the extreme (−0.12 = −12%). Unlisted symbols stay flat. */
  shocks: Record<string, number>;
  /** Seconds to reach the extreme. */
  rampSec: number;
  /** Seconds simulated after the ramp, so staged attempts can play out. */
  holdSec: number;
  shape: Shape;
}

export interface SimParams {
  /** Levels within this distance of mid are market-maker quotes that re-peg to the index. */
  pegBand: number;
  /** Fraction of consumed market-maker liquidity restored each second. */
  refillPerSec: number;
  /** Fraction of quotes market makers pull at a 10%+ move (linear below that). */
  withdrawal: number;
  /** Taker commission used for liquidation IOCs. */
  takerRate: number;
  /** Insurance Fund balance available to absorb backstop transfers (USD). */
  insuranceFund: number;
  /** The fund rejects transfers that would take its equity below (1 − x) × starting balance. */
  ifMaxDrawdown: number;
  /** The fund rejects transfers that would make its |net notional| in one symbol exceed x × starting balance. */
  ifNotionalMultiple: number;
  /** "strike": median(P1, P2, P3) mark from the simulated book. "index": mark tracks the index (no local feedback). */
  markModel: "strike" | "index";
  /** Record the top of the simulated book every tick for these symbols (for visualisation). */
  recordBooks?: string[];
  /** Extra limit orders resting in the book from t0, e.g. a liquidity strategy being evaluated. */
  resting?: RestingOrder[];
}

export interface RestingOrder {
  symbol: string;
  side: "bid" | "ask";
  price: number;
  size: number;
  /** Groups fills in `SimResult.restingFills`; defaults to "resting". */
  tag?: string;
}

export interface RestingFill extends TaggedFill {
  t: number;
  symbol: string;
}

export const DEFAULT_PARAMS: SimParams = {
  pegBand: 0.02,
  refillPerSec: 0.04,
  withdrawal: 0.5,
  takerRate: 0.0005,
  insuranceFund: 150_000,
  ifMaxDrawdown: 0.5,
  ifNotionalMultiple: 1,
  markModel: "strike",
};

export type EventKind = "liquidation" | "no_fill" | "insurance" | "adl" | "uncovered";

export interface SimEvent {
  t: number;
  kind: EventKind;
  symbol: string;
  accountKey: string;
  address: string;
  positionId: number;
  side: "long" | "short";
  /** Base size liquidated / transferred / deleveraged in this event. */
  size: number;
  /** Size the IOC asked for (liquidation and no_fill events). */
  requested?: number;
  price: number;
  notional: number;
  /** The IOC's limit price (liquidation and no_fill events). */
  limit?: number;
  attempt?: number;
  /** Why the position reached the backstop. */
  reason?: "final_attempt" | "bankrupt";
  /** ADL rank (1 = first deleveraged). */
  rank?: number;
}

export interface SymbolFrame {
  index: number;
  mark: number;
  bid: number;
  ask: number;
  bidDepth: number;
  askDepth: number;
}

export interface Frame {
  t: number;
  symbols: Record<string, SymbolFrame>;
  liquidated: number;
  insurance: number;
  adl: number;
  /** Top 120 levels per side, only for `params.recordBooks` symbols. */
  books?: Record<string, { bids: [number, number][]; asks: [number, number][] }>;
}

export interface PositionFate {
  positionId: number;
  accountKey: string;
  address: string;
  symbol: string;
  side: "long" | "short";
  initialSize: number;
  finalSize: number;
  liquidated: number;
  backstopped: number;
  deleveraged: number;
  firstHitT: number | null;
}

export interface SimTotals {
  liquidatedNotional: number;
  insuranceNotional: number;
  adlNotional: number;
  uncoveredNotional: number;
  noFillAttempts: number;
  iocAttempts: number;
  accountsHit: number;
  positionsHit: number;
  positionsClosed: number;
  liquidationFees: number;
  insurancePnl: number;
  maxMarkGap: { symbol: string; pct: number };
}

export interface SimResult {
  scenario: Scenario;
  params: SimParams;
  frames: Frame[];
  events: SimEvent[];
  fates: PositionFate[];
  totals: SimTotals;
  /** Margin profiles that were already liquidatable or bankrupt in the snapshot (excluded from the replay). */
  preDistressed: string[];
  /** Fills of `params.resting` orders, in time order. */
  restingFills: RestingFill[];
}

interface FundPosition {
  size: number;
  entry: number;
}

function shapeAt(shape: Shape, t: number, ramp: number, hold: number): number {
  const u = clamp(t / ramp, 0, 1);
  if (shape === "linear") return u;
  if (shape === "crash") return 1 - (1 - u) ** 3;
  // wick: reach the extreme, then retrace 60% of the move over the hold window
  if (t <= ramp) return 1 - (1 - u) ** 2;
  return 1 - 0.6 * clamp((t - ramp) / Math.max(1, hold), 0, 1);
}

function cloneAccounts(accounts: Account[]): Account[] {
  return accounts.map((a) => ({ ...a, positions: a.positions.map((p) => ({ ...p })) }));
}

export class Simulator {
  readonly snap: Snapshot;
  readonly scenario: Scenario;
  readonly params: SimParams;
  readonly accounts: Account[];
  readonly symbols: string[];

  t = 0;
  marks: Record<string, number> = {};
  index: Record<string, number> = {};
  private books: Record<string, SimBook> = {};
  private basis: Record<string, number[]> = {};
  /** Per-symbol (served mark − modelled mark) / index at t0, so the replay starts exactly at Strike's live mark. */
  private calibration: Record<string, number> = {};
  private last: Record<string, number> = {};
  private filledThisTick = new Set<string>();
  private attempts = new Map<string, number>();
  private fund: { start: number; balance: number; positions: Record<string, FundPosition> };
  private fates = new Map<number, PositionFate>();
  readonly events: SimEvent[] = [];
  readonly frames: Frame[] = [];
  readonly restingFills: RestingFill[] = [];
  private totals = { liquidated: 0, insurance: 0, adl: 0, uncovered: 0, noFill: 0, ioc: 0, fees: 0 };
  private maxGap = { symbol: "", pct: 0 };
  /** Profiles already liquidatable or bankrupt in the snapshot; frozen so results reflect only the shock. */
  readonly preDistressed = new Set<string>();

  constructor(snap: Snapshot, scenario: Scenario, params: Partial<SimParams> = {}) {
    this.snap = snap;
    this.scenario = scenario;
    this.params = { ...DEFAULT_PARAMS, insuranceFund: snap.slpEquity || DEFAULT_PARAMS.insuranceFund, takerRate: snap.takerRate, ...params };
    this.accounts = cloneAccounts(snap.accounts);
    const active = new Set<string>(Object.keys(scenario.shocks));
    for (const a of this.accounts) for (const p of a.positions) active.add(p.symbol);
    this.symbols = [...active].filter((s) => snap.markets[s]).sort();
    for (const s of this.symbols) {
      const m = snap.markets[s];
      const book = snap.books[s] ?? { bids: [], asks: [] };
      const resting = (this.params.resting ?? [])
        .filter((r) => r.symbol === s && r.size > 0 && r.price > 0)
        .map((r) => ({ side: r.side, price: r.price, qty: r.size, tag: r.tag ?? "resting" }));
      this.books[s] = new SimBook(book, m.index, this.params.pegBand, resting);
      this.index[s] = m.index;
      this.marks[s] = m.mark;
      this.last[s] = m.last || m.mark;
      const sample = basisSample(book.bids, book.asks, m.index, m.impactNotional);
      this.basis[s] = Array(BASIS_SAMPLES).fill(sample);
      const bestBid = book.bids[0]?.[0] ?? 0;
      const bestAsk = book.asks[0]?.[0] ?? 0;
      const last0 = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : m.index;
      const model0 = markPrice({ index: m.index, fundingRate: m.fundingRate, hourRemaining: this.hourRemaining(s), basis: this.basis[s], bestBid, bestAsk, last: last0 }).mark;
      this.calibration[s] = (m.mark - model0) / m.index;
    }
    for (const a of this.accounts)
      for (const p of a.positions)
        this.fates.set(p.id, {
          positionId: p.id,
          accountKey: a.key,
          address: a.address,
          symbol: p.symbol,
          side: p.size > 0 ? "long" : "short",
          initialSize: Math.abs(p.size),
          finalSize: Math.abs(p.size),
          liquidated: 0,
          backstopped: 0,
          deleveraged: 0,
          firstHitT: null,
        });
    this.fund = { start: this.params.insuranceFund, balance: this.params.insuranceFund, positions: {} };
    for (const p of this.allProfiles()) if (p.level === "liquidate" || p.level === "bankrupt") this.preDistressed.add(p.key);
    this.recordFrame();
  }

  private market(s: string): Market {
    return this.snap.markets[s];
  }

  private hourRemaining(s: string): number {
    const m = this.market(s);
    const now = this.snap.fetchedAt + this.t * 1000;
    if (!m.nextFundingTime) return 0.5;
    const ms = (((m.nextFundingTime - now) % 3_600_000) + 3_600_000) % 3_600_000;
    return ms / 3_600_000;
  }

  /** Advance one second: move the index, re-quote, recompute marks, run the liquidation cycle. */
  step(): void {
    this.t++;
    const { rampSec, holdSec, shape, shocks } = this.scenario;
    const f = shapeAt(shape, this.t, rampSec, holdSec);
    for (const s of this.symbols) {
      const m = this.market(s);
      const X = m.index * (1 + (shocks[s] ?? 0) * f);
      this.index[s] = X;
      const book = this.books[s];
      book.update(X, Math.abs(X / m.index - 1), this.params.withdrawal, this.params.refillPerSec);
      const bids = book.levels("bids");
      const asks = book.levels("asks");
      pushBasis(this.basis[s], basisSample(bids, asks, X, m.impactNotional));
      const bestBid = bids[0]?.[0] ?? 0;
      const bestAsk = asks[0]?.[0] ?? 0;
      // Without a liquidation print this second, organic flow trades around the touch.
      if (!this.filledThisTick.has(s)) this.last[s] = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : X;
      const hr = this.hourRemaining(s);
      this.marks[s] =
        this.params.markModel === "index"
          ? X * (m.mark / m.index)
          : markPrice({ index: X, fundingRate: m.fundingRate, hourRemaining: hr, basis: this.basis[s], bestBid, bestAsk, last: this.last[s] }).mark + this.calibration[s] * X;
      // Dislocation of mark vs index beyond the premium the market started with.
      const gap = this.marks[s] / X - m.mark / m.index;
      if (Math.abs(gap) > Math.abs(this.maxGap.pct)) this.maxGap = { symbol: s, pct: gap };
    }
    this.filledThisTick.clear();
    this.cycle();
    if (this.params.resting?.length)
      for (const s of this.symbols) for (const f of this.books[s].drainTaggedFills()) this.restingFills.push({ ...f, t: this.t, symbol: s });
    this.recordFrame();
  }

  run(): SimResult {
    const ticks = this.scenario.rampSec + this.scenario.holdSec;
    while (this.t < ticks) this.step();
    return this.result();
  }

  // ---- liquidation cycle -------------------------------------------------------------------

  private profileOf(account: Account, pos: Position): Profile | null {
    if (pos.mode === "cross") return crossProfile(account, this.marks, this.snap.markets);
    if (pos.size === 0) return null;
    return isolatedProfile(account, pos, this.marks[pos.symbol], this.market(pos.symbol));
  }

  private allProfiles(): Profile[] {
    const out: Profile[] = [];
    for (const a of this.accounts) {
      const cp = crossProfile(a, this.marks, this.snap.markets);
      if (cp) out.push(cp);
      for (const p of a.positions) if (p.mode === "isolated" && p.size !== 0) out.push(isolatedProfile(a, p, this.marks[p.symbol], this.market(p.symbol)));
    }
    return out;
  }

  private cycle(): void {
    const profiles = this.allProfiles().filter((p) => !this.preDistressed.has(p.key));
    const candidates: { account: Account; pos: Position; distance: number; mm: number }[] = [];
    const bankrupt: Profile[] = [];
    for (const p of profiles) {
      if (p.level === "liquidate") for (const st of p.states) candidates.push({ account: p.account, pos: st.pos, distance: st.mmr / p.ratio, mm: st.mm });
      else if (p.level === "bankrupt") bankrupt.push(p);
    }
    // Distance ascending, position MM descending, position id ascending.
    candidates.sort((a, b) => a.distance - b.distance || b.mm - a.mm || a.pos.id - b.pos.id);

    const advanced = new Set<string>();
    for (const c of candidates) {
      if (c.pos.size === 0) continue;
      const prof = this.profileOf(c.account, c.pos);
      if (!prof || prof.level !== "liquidate") continue; // recovered, or now bankrupt (next batch)
      const st = prof.states.find((s) => s.pos.id === c.pos.id);
      if (!st) continue;
      let attempt = this.attempts.get(prof.key) ?? 0;
      if (!advanced.has(prof.key)) {
        attempt += 1;
        this.attempts.set(prof.key, attempt);
        advanced.add(prof.key);
      }
      this.solventAttempt(c.account, prof, st, Math.max(1, attempt));
    }

    for (const p of bankrupt) {
      const states = [...p.states].sort((a, b) => b.mm - a.mm || a.pos.id - b.pos.id);
      for (const st0 of states) {
        if (st0.pos.size === 0) continue;
        const prof = this.profileOf(p.account, st0.pos);
        if (!prof || prof.level !== "bankrupt") continue; // recovered or solvent: deferred
        const st = prof.states.find((s) => s.pos.id === st0.pos.id)!;
        const { bankruptcy } = liqAndBankruptcy(st, prof);
        const price = bankruptcy > 0 ? bankruptcy : st.mark;
        this.backstop(p.account, st.pos, Math.abs(st.pos.size), price, "bankrupt");
      }
    }

    for (const key of [...this.attempts.keys()]) {
      const prof = profiles.find((p) => p.key === key);
      if (!prof) {
        this.attempts.delete(key);
        continue;
      }
      const fresh = this.profileOf(prof.account, prof.states[0].pos);
      if (!fresh || (fresh.level !== "liquidate" && fresh.level !== "bankrupt")) this.attempts.delete(key);
    }
  }

  private solventAttempt(account: Account, prof: Profile, st: PositionState, attempt: number): void {
    const pos = st.pos;
    const m = this.market(pos.symbol);
    const dir = Math.sign(pos.size);
    const S = Math.abs(pos.size);
    const mark = st.mark;
    const q = attemptSize(S, prof.ratio, mark, attempt, m.step);
    if (q <= 0) return;
    const np = neutralPrice(m.tiers, pos.size, q, mark, prof.ratio);
    const limit = iocLimit(np, dir, this.params.takerRate, m.tick);
    if (!(limit > 0)) return; // no account-protective limit: attempt not consumed
    const fills = this.books[pos.symbol].take(dir > 0 ? "bids" : "asks", limit, q);
    this.totals.ioc++;
    const filled = this.applyFills(account, pos, fills, np, m);
    const fate = this.fates.get(pos.id)!;
    if (fate.firstHitT === null) fate.firstHitT = this.t;
    if (filled.qty > 0) {
      fate.liquidated += filled.qty;
      this.totals.liquidated += filled.notional;
      this.last[pos.symbol] = fills[fills.length - 1].price;
      this.filledThisTick.add(pos.symbol);
    } else this.totals.noFill++;
    this.events.push({
      t: this.t,
      kind: filled.qty > 0 ? "liquidation" : "no_fill",
      symbol: pos.symbol,
      accountKey: account.key,
      address: account.address,
      positionId: pos.id,
      side: dir > 0 ? "long" : "short",
      size: filled.qty,
      requested: q,
      price: filled.qty > 0 ? filled.notional / filled.qty : limit,
      notional: filled.notional,
      limit,
      attempt,
    });

    if (attempt >= MAX_ATTEMPTS && pos.size !== 0) {
      const fresh = this.profileOf(account, pos);
      if (fresh && (fresh.level === "liquidate" || fresh.level === "bankrupt")) this.backstop(account, pos, Math.abs(pos.size), limit, "final_attempt");
    }
  }

  private applyFills(account: Account, pos: Position, fills: Fill[], np: number, m: Market): { qty: number; notional: number } {
    const dir = Math.sign(pos.size);
    let qty = 0;
    let notional = 0;
    for (const f of fills) {
      const commission = f.price * f.qty * this.params.takerRate;
      const fee = adaptiveLiquidationFee(f.price, f.qty, dir, np, commission, m.liqFeeRate, m.liqRetention);
      this.totals.fees += fee;
      this.close(account, pos, f.qty, f.price, commission + fee);
      qty += f.qty;
      notional += f.price * f.qty;
    }
    return { qty, notional };
  }

  /** Close `qty` of a position at `price`, settling realized PnL and fees into the right balance. */
  private close(account: Account, pos: Position, qty: number, price: number, fees: number): void {
    const dir = Math.sign(pos.size);
    const S = Math.abs(pos.size);
    const realized = (price - pos.entry) * qty * dir;
    if (pos.mode === "cross") account.crossBalance += realized - fees;
    else {
      pos.isoBalance += realized - fees;
      // Isolated reserve is released in proportion to the closed size.
      const release = qty >= S - 1e-12 ? pos.isoBalance : pos.isoBalance * (qty / S);
      if (release > 0) {
        pos.isoBalance -= release;
        account.crossBalance += release;
      }
    }
    pos.size = qty >= S - 1e-12 ? 0 : pos.size - dir * qty;
    const fate = this.fates.get(pos.id);
    if (fate) fate.finalSize = Math.abs(pos.size);
  }

  private fundUpnl(): number {
    let u = 0;
    for (const [s, fp] of Object.entries(this.fund.positions)) u += (this.marks[s] - fp.entry) * fp.size;
    return u;
  }

  private backstop(account: Account, pos: Position, qty: number, price: number, reason: "final_attempt" | "bankrupt"): void {
    const s = pos.symbol;
    const dir = Math.sign(pos.size);
    const mark = this.marks[s];
    const fate = this.fates.get(pos.id)!;
    if (fate.firstHitT === null) fate.firstHitT = this.t;
    this.close(account, pos, qty, price, 0);
    fate.backstopped += qty;

    const fp = this.fund.positions[s] ?? { size: 0, entry: 0 };
    const transferPnl = (mark - price) * dir * qty;
    const equityAfter = this.fund.balance + this.fundUpnl() + transferPnl;
    const sizeAfter = fp.size + dir * qty;
    const accepts =
      this.fund.start > 0 &&
      equityAfter >= this.fund.start * (1 - this.params.ifMaxDrawdown) &&
      Math.abs(sizeAfter) * mark <= this.fund.start * this.params.ifNotionalMultiple;

    const base = { t: this.t, symbol: s, side: (dir > 0 ? "long" : "short") as "long" | "short", reason };
    if (accepts) {
      this.addFundPosition(s, dir * qty, price);
      this.totals.insurance += qty * price;
      this.events.push({ ...base, kind: "insurance", accountKey: account.key, address: account.address, positionId: pos.id, size: qty, price, notional: qty * price });
      return;
    }
    this.adl(s, dir, qty, price, reason);
  }

  private addFundPosition(s: string, signed: number, price: number): void {
    const fp = (this.fund.positions[s] ??= { size: 0, entry: 0 });
    if (fp.size === 0 || Math.sign(fp.size) === Math.sign(signed)) {
      const total = Math.abs(fp.size) + Math.abs(signed);
      fp.entry = (Math.abs(fp.size) * fp.entry + Math.abs(signed) * price) / total;
      fp.size += signed;
    } else {
      const closing = Math.min(Math.abs(fp.size), Math.abs(signed));
      this.fund.balance += (price - fp.entry) * closing * Math.sign(fp.size);
      fp.size += signed;
      if (Math.abs(fp.size) < 1e-12) fp.size = 0;
      else if (Math.sign(fp.size) === Math.sign(signed)) fp.entry = price;
    }
  }

  /** Type 1 ADL: reduce profitable opposite-side positions, ranked by profit % × effective leverage. */
  private adl(s: string, dir: number, qty: number, price: number, reason: "final_attempt" | "bankrupt"): void {
    const ranked: { account: Account; pos: Position; score: number }[] = [];
    for (const a of this.accounts) {
      for (const p of a.positions) {
        if (p.symbol !== s || p.size === 0 || Math.sign(p.size) !== -dir) continue;
        if (this.preDistressed.has(p.mode === "cross" ? `${a.key}:cross` : `${a.key}:iso:${p.id}`)) continue;
        const st = positionState(p, this.marks[s], this.market(s));
        if (st.upnl <= 0) continue;
        const prof = this.profileOf(a, p);
        const mb = prof ? Math.max(prof.marginBalance, 1e-9) : 1e-9;
        ranked.push({ account: a, pos: p, score: (st.upnl / (Math.abs(p.size) * p.entry)) * (st.notional / mb) });
      }
    }
    ranked.sort((a, b) => b.score - a.score || a.pos.id - b.pos.id);
    let remaining = qty;
    let rank = 0;
    for (const r of ranked) {
      if (remaining <= 1e-12) break;
      rank++;
      const take = Math.min(Math.abs(r.pos.size), remaining);
      const side: "long" | "short" = r.pos.size > 0 ? "long" : "short";
      this.close(r.account, r.pos, take, price, 0);
      const fate = this.fates.get(r.pos.id)!;
      fate.deleveraged += take;
      if (fate.firstHitT === null) fate.firstHitT = this.t;
      remaining -= take;
      this.totals.adl += take * price;
      this.events.push({ t: this.t, kind: "adl", symbol: s, accountKey: r.account.key, address: r.account.address, positionId: r.pos.id, side, size: take, price, notional: take * price, rank, reason });
    }
    if (remaining > 1e-12) {
      this.totals.uncovered += remaining * price;
      this.events.push({ t: this.t, kind: "uncovered", symbol: s, accountKey: "", address: "", positionId: 0, side: dir > 0 ? "long" : "short", size: remaining, price, notional: remaining * price, reason });
    }
  }

  // ---- reporting ---------------------------------------------------------------------------

  private recordFrame(): void {
    const symbols: Record<string, SymbolFrame> = {};
    for (const s of this.symbols) {
      const b = this.books[s];
      const ref = this.index[s];
      symbols[s] = { index: ref, mark: this.marks[s], bid: b.best("bids"), ask: b.best("asks"), bidDepth: b.depthWithin("bids", ref, 0.05), askDepth: b.depthWithin("asks", ref, 0.05) };
    }
    const frame: Frame = { t: this.t, symbols, liquidated: this.totals.liquidated, insurance: this.totals.insurance, adl: this.totals.adl };
    if (this.params.recordBooks?.length) {
      frame.books = {};
      for (const s of this.params.recordBooks) {
        const b = this.books[s];
        if (b) frame.books[s] = { bids: b.levels("bids").slice(0, 120), asks: b.levels("asks").slice(0, 120) };
      }
    }
    this.frames.push(frame);
  }

  result(): SimResult {
    const fates = [...this.fates.values()];
    const hit = fates.filter((f) => f.firstHitT !== null);
    return {
      scenario: this.scenario,
      params: this.params,
      frames: this.frames,
      events: this.events,
      fates,
      preDistressed: [...this.preDistressed],
      restingFills: this.restingFills,
      totals: {
        liquidatedNotional: this.totals.liquidated,
        insuranceNotional: this.totals.insurance,
        adlNotional: this.totals.adl,
        uncoveredNotional: this.totals.uncovered,
        noFillAttempts: this.totals.noFill,
        iocAttempts: this.totals.ioc,
        accountsHit: new Set(hit.map((f) => f.accountKey)).size,
        positionsHit: hit.length,
        positionsClosed: hit.filter((f) => f.finalSize === 0).length,
        liquidationFees: this.totals.fees,
        insurancePnl: this.fund.balance - this.fund.start + this.fundUpnl(),
        maxMarkGap: this.maxGap,
      },
    };
  }
}

export function simulate(snap: Snapshot, scenario: Scenario, params: Partial<SimParams> = {}): SimResult {
  return new Simulator(snap, scenario, params).run();
}
