// A simulated order book that evolves while the index moves.
//
// Levels near the touch are treated as market-maker quotes: they re-peg to the index every tick,
// get pulled as the move deepens, and refill over time once consumed. Deeper levels are resting
// limit orders at fixed prices; arbitrageurs take any of them the index moves through.

import type { Book, Level } from "./types.ts";

interface SimLevel {
  pegged: boolean;
  /** Price relative to the starting index (pegged levels). */
  rel: number;
  /** Absolute price (static levels). */
  abs: number;
  qty: number;
  orig: number;
  /** Set on orders injected through `SimParams.resting`, so their fills can be attributed. */
  tag?: string;
}

export interface Fill {
  price: number;
  qty: number;
}

/** A user limit order added to the book at t0 (always static: it does not re-peg). */
export interface RestingLevel {
  side: "bid" | "ask";
  price: number;
  qty: number;
  tag: string;
}

export interface TaggedFill {
  tag: string;
  side: "bid" | "ask";
  price: number;
  qty: number;
  /** Who took it: a liquidation IOC, or arbitrage once the index moved through the price. */
  by: "liquidation" | "arb";
}

export class SimBook {
  private bids: SimLevel[];
  private asks: SimLevel[];
  private index: number;
  private tagged: TaggedFill[] = [];

  constructor(book: Book, index0: number, pegBand: number, resting: RestingLevel[] = []) {
    const mid = book.bids.length && book.asks.length ? (book.bids[0][0] + book.asks[0][0]) / 2 : index0;
    const mk = ([p, q]: Level): SimLevel => ({ pegged: Math.abs(p / mid - 1) <= pegBand, rel: p / index0, abs: p, qty: q, orig: q });
    this.bids = book.bids.map(mk);
    this.asks = book.asks.map(mk);
    for (const r of resting) {
      const l: SimLevel = { pegged: false, rel: r.price / index0, abs: r.price, qty: r.qty, orig: r.qty, tag: r.tag };
      (r.side === "bid" ? this.bids : this.asks).push(l);
    }
    this.index = index0;
  }

  /** Fills of tagged (injected) orders since the last call. */
  drainTaggedFills(): TaggedFill[] {
    const out = this.tagged;
    this.tagged = [];
    return out;
  }

  private record(l: SimLevel, side: "bid" | "ask", price: number, qty: number, by: TaggedFill["by"]): void {
    if (l.tag !== undefined && qty > 1e-12) this.tagged.push({ tag: l.tag, side, price, qty, by });
  }

  private priceOf(l: SimLevel): number {
    return l.pegged ? l.rel * this.index : l.abs;
  }

  /**
   * Move to a new index. `stress` is |index/index0 − 1|; quotes are pulled by up to `withdrawal`
   * at a 10% move and refill toward that target at `refillPerSec`. Returns arbitraged notional.
   */
  update(index: number, stress: number, withdrawal: number, refillPerSec: number): number {
    this.index = index;
    const cap = 1 - withdrawal * Math.min(1, stress / 0.1);
    let arbitraged = 0;
    for (const l of this.bids) {
      if (l.pegged) {
        const target = l.orig * cap;
        l.qty = l.qty > target ? target : l.qty + (target - l.qty) * refillPerSec;
      } else if (l.qty > 0 && l.abs > index) {
        arbitraged += l.abs * l.qty;
        this.record(l, "bid", l.abs, l.qty, "arb");
        l.qty = 0;
      }
    }
    for (const l of this.asks) {
      if (l.pegged) {
        const target = l.orig * cap;
        l.qty = l.qty > target ? target : l.qty + (target - l.qty) * refillPerSec;
      } else if (l.qty > 0 && l.abs < index) {
        arbitraged += l.abs * l.qty;
        this.record(l, "ask", l.abs, l.qty, "arb");
        l.qty = 0;
      }
    }
    return arbitraged;
  }

  private sorted(side: "bids" | "asks"): { l: SimLevel; p: number }[] {
    const rows = (side === "bids" ? this.bids : this.asks).filter((l) => l.qty > 1e-12).map((l) => ({ l, p: this.priceOf(l) }));
    rows.sort(side === "bids" ? (a, b) => b.p - a.p : (a, b) => a.p - b.p);
    return rows;
  }

  levels(side: "bids" | "asks"): Level[] {
    return this.sorted(side).map(({ l, p }) => [p, l.qty]);
  }

  best(side: "bids" | "asks"): number {
    let best = 0;
    for (const l of side === "bids" ? this.bids : this.asks) {
      if (l.qty <= 1e-12) continue;
      const p = this.priceOf(l);
      if (best === 0 || (side === "bids" ? p > best : p < best)) best = p;
    }
    return best;
  }

  /** USD depth on one side within `pct` of `ref`. */
  depthWithin(side: "bids" | "asks", ref: number, pct: number): number {
    let usd = 0;
    for (const l of side === "bids" ? this.bids : this.asks) {
      if (l.qty <= 1e-12) continue;
      const p = this.priceOf(l);
      if (side === "bids" ? p >= ref * (1 - pct) : p <= ref * (1 + pct)) usd += p * l.qty;
    }
    return usd;
  }

  /** Take liquidity like an IOC: sells hit bids ≥ limit, buys lift asks ≤ limit. */
  take(side: "bids" | "asks", limit: number, qty: number): Fill[] {
    const fills: Fill[] = [];
    let remaining = qty;
    for (const { l, p } of this.sorted(side)) {
      if (remaining <= 1e-12) break;
      if (side === "bids" ? p < limit - 1e-12 : p > limit + 1e-12) break;
      const q = Math.min(l.qty, remaining);
      this.record(l, side === "bids" ? "bid" : "ask", p, q, "liquidation");
      l.qty -= q;
      remaining -= q;
      fills.push({ price: p, qty: q });
    }
    return fills;
  }
}
