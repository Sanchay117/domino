#!/usr/bin/env node
// Domino MCP server: lets an AI agent stress-test Strike Finance with the same engine the dashboard uses.
// Read-only: it never signs or sends orders; order bodies it returns are unsigned suggestions.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  adlQueue,
  catchPlan,
  correlatedScenario,
  deriskPlan,
  distressedAtSnapshot,
  findPositions,
  liquidationLadder,
  loadSnapshot,
  MAINNET,
  marketRisks,
  positionRisks,
  simulate,
  singleScenario,
  stepString,
  survivalShock,
  TESTNET,
  validateAgainstServed,
  type NormalizedSnapshot,
  type Scenario,
  type Shape,
  type SimParams,
} from "@domino/engine";
import { z } from "zod";

const network = process.env.STRIKE_NETWORK === "testnet" ? "testnet" : "mainnet";
const TTL_MS = 60_000;
let cache: { snap: NormalizedSnapshot; at: number } | null = null;
let inflight: Promise<NormalizedSnapshot> | null = null;

/** Live snapshot, refreshed at most once a minute (positions, books, tiers, vaults, plus candles for betas). */
async function snapshot(): Promise<NormalizedSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.snap;
  inflight ??= loadSnapshot({ base: network === "testnet" ? TESTNET : MAINNET, withCandles: !cache })
    .then((snap) => {
      if (cache && !Object.keys(snap.betas).length) snap.betas = cache.snap.betas;
      cache = { snap, at: Date.now() };
      return snap;
    })
    .finally(() => (inflight = null));
  return inflight;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const sig = (x: number) => +x.toPrecision(6);
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const normSymbol = (s: string) => (s.includes("-") ? s : `${s}-USD`).toUpperCase();

function requireMarket(snap: NormalizedSnapshot, symbol: string): string {
  const s = normSymbol(symbol);
  if (!snap.markets[s]) throw new Error(`Unknown market ${symbol}. Listed: ${Object.keys(snap.markets).join(", ")}`);
  return s;
}

const shapeSchema = z.enum(["crash", "linear", "wick"]).default("crash").describe("Price path: crash (front-loaded), linear, or wick (retraces 60% after the low)");
const assumptions = {
  slp_usd: z.number().positive().optional().describe("Override the SLP backstop size in USD (default: live SLP vault equity)"),
  slp_symbol_cap: z.number().positive().optional().describe("Max SLP net notional per market as a multiple of its equity (default 1)"),
  mm_withdrawal: z.number().min(0).max(1).optional().describe("Share of market-maker quotes pulled at a 10% move (default 0.5)"),
};
type Assumptions = { slp_usd?: number; slp_symbol_cap?: number; mm_withdrawal?: number };
function params(a: Assumptions): Partial<SimParams> {
  const p: Partial<SimParams> = {};
  if (a.slp_usd !== undefined) p.insuranceFund = a.slp_usd;
  if (a.slp_symbol_cap !== undefined) p.ifNotionalMultiple = a.slp_symbol_cap;
  if (a.mm_withdrawal !== undefined) p.withdrawal = a.mm_withdrawal;
  return p;
}

const label = (snap: NormalizedSnapshot, a: { address: string; vaultId: string; accountId: string }) =>
  a.address || (a.vaultId ? `${snap.raw.vaults.find((v) => v.vault_id === a.vaultId)?.name ?? "unnamed"} vault (${a.vaultId})` : a.accountId);

const server = new McpServer(
  { name: "domino", version: "1.0.0" },
  {
    instructions:
      "Domino replays Strike Finance's documented liquidation engine (staged partial IOCs, neutral-price limits, SLP backstop, Type 1 ADL) against every live position and the real order books. Shocks are signed fractions: -0.2 means the index falls 20% over 3 minutes. Results are model estimates, not guarantees.",
  },
);

server.registerTool(
  "market_risk",
  {
    title: "Strike market risk",
    description:
      "Exchange-wide snapshot of Strike perps: open interest, SLP backstop size, how many live liquidation prices Domino reproduces exactly, and per market the nearest long/short liquidation, long notional liquidating within 10%, bid depth within 10% and beta to BTC.",
    inputSchema: { top: z.number().int().min(1).max(50).default(12).describe("Markets to return, by open interest") },
  },
  async ({ top }) => {
    const snap = await snapshot();
    const risks = positionRisks(snap);
    const v = validateAgainstServed(snap);
    const markets = marketRisks(snap, risks)
      .filter((m) => m.positions > 0)
      .sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd))
      .slice(0, top)
      .map((m) => ({
        symbol: m.symbol,
        open_interest_usd: round(m.longUsd + m.shortUsd, 0),
        longs: m.longs,
        shorts: m.shorts,
        nearest_long_liq_move: m.nearestLong === null ? null : round(m.nearestLong, 4),
        nearest_short_liq_move: m.nearestShort === null ? null : round(m.nearestShort, 4),
        long_liq_within_10pct_usd: round(m.longLiqUsd10, 0),
        bid_depth_within_10pct_usd: round(m.bidDepth10, 0),
        cover: m.longLiqUsd10 > 0 ? round(m.bidDepth10 / m.longLiqUsd10, 2) : null,
        beta_to_btc: round(m.beta, 2),
      }));
    return json({
      network,
      snapshot_time: new Date(snap.fetchedAt).toISOString(),
      open_interest_usd: round(risks.reduce((s, r) => s + r.notional, 0), 0),
      positions: risks.length,
      accounts: snap.accounts.length,
      slp_backstop_usd: round(snap.slpEquity, 0),
      liquidation_prices_reproduced: `${v.matched}/${v.total}`,
      already_distressed: distressedAtSnapshot(snap, risks).map((r) => ({ symbol: r.pos.symbol, side: r.side, level: r.level })),
      markets,
    });
  },
);

server.registerTool(
  "stress_test",
  {
    title: "Replay a liquidation cascade",
    description:
      "Simulate a price shock second by second through Strike's liquidation engine. 'correlated' moves the leader by `shock` and every other market by its beta; 'single' shocks one market. Returns where liquidated notional ends up (order book, SLP, ADL, uncovered), accounts hit, per-market breakdown and the largest events.",
    inputSchema: {
      shock: z.number().min(-0.95).max(3).describe("Signed move of the leader's index, e.g. -0.2 for a 20% crash"),
      symbol: z.string().default("BTC-USD").describe("Leader market (correlated) or the market to shock (single)"),
      mode: z.enum(["correlated", "single"]).default("correlated"),
      shape: shapeSchema,
      ramp_seconds: z.number().int().min(10).max(1800).default(180),
      ...assumptions,
    },
  },
  async ({ shock, symbol, mode, shape, ramp_seconds, ...a }) => {
    const snap = await snapshot();
    const s = requireMarket(snap, symbol);
    const o = { shape: shape as Shape, rampSec: ramp_seconds };
    const scenario: Scenario = mode === "single" ? singleScenario(s, shock, o) : correlatedScenario(snap, shock, s, o);
    const r = simulate(snap, scenario, params(a));
    const t = r.totals;
    const per = new Map<string, { book: number; slp: number; adl: number; positions: Set<number> }>();
    for (const e of r.events) {
      const row = per.get(e.symbol) ?? { book: 0, slp: 0, adl: 0, positions: new Set<number>() };
      if (e.kind === "liquidation") row.book += e.notional;
      if (e.kind === "insurance") row.slp += e.notional;
      if (e.kind === "adl") row.adl += e.notional;
      if (e.kind !== "uncovered") row.positions.add(e.positionId);
      per.set(e.symbol, row);
    }
    return json({
      scenario: scenario.name,
      shocked_markets: Object.keys(scenario.shocks).length,
      totals: {
        liquidated_on_book_usd: round(t.liquidatedNotional, 0),
        absorbed_by_slp_usd: round(t.insuranceNotional, 0),
        auto_deleveraged_usd: round(t.adlNotional, 0),
        uncovered_usd: round(t.uncoveredNotional, 0),
        accounts_hit: t.accountsHit,
        positions_hit: t.positionsHit,
        positions_fully_closed: t.positionsClosed,
        ioc_attempts: t.iocAttempts,
        ioc_attempts_without_fill: t.noFillAttempts,
        liquidation_fees_usd: round(t.liquidationFees, 0),
        slp_mark_to_market_usd: round(t.insurancePnl, 0),
        worst_mark_vs_index_gap: { symbol: t.maxMarkGap.symbol, move: round(t.maxMarkGap.pct, 4) },
      },
      by_market: [...per.entries()]
        .map(([symbol, x]) => ({ symbol, on_book_usd: round(x.book, 0), slp_usd: round(x.slp, 0), adl_usd: round(x.adl, 0), positions_hit: x.positions.size }))
        .sort((a, b) => b.on_book_usd + b.slp_usd + b.adl_usd - (a.on_book_usd + a.slp_usd + a.adl_usd)),
      largest_events: [...r.events]
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 10)
        .map((e) => ({ t_seconds: e.t, kind: e.kind, symbol: e.symbol, side: e.side, size: sig(e.size), price: sig(e.price), notional_usd: round(e.notional, 0), account: e.address || e.accountKey })),
    });
  },
);

server.registerTool(
  "position_xray",
  {
    title: "X-ray a Strike account",
    description:
      "For a wallet address, account id or vault id: every open position with its exact liquidation and bankruptcy price, static distance to liquidation, cascade survival (smallest move, led by that market with others following by beta, at which the replayed cascade first touches it) and Type 1 ADL queue rank for profitable positions.",
    inputSchema: { address: z.string().min(3).describe("Cardano/EVM address, account id or vault id") },
  },
  async ({ address }) => {
    const snap = await snapshot();
    const ids = new Set(findPositions(snap, address).map((p) => p.id));
    if (!ids.size) return json({ address, positions: [], note: "No open positions found for this address/account/vault." });
    const risks = positionRisks(snap);
    const mine = risks.filter((r) => ids.has(r.pos.id));
    const acct = mine[0].account;
    return json({
      account: label(snap, acct),
      account_id: acct.accountId,
      cross_balance_usd: round(acct.crossBalance),
      positions: mine.map((r) => {
        const survival = survivalShock(snap, r.pos.id, (s) => correlatedScenario(snap, s, r.pos.symbol));
        const adl = r.upnl > 0 ? adlQueue(snap, r.pos.symbol, r.side, risks) : [];
        const rank = adl.find((e) => e.pos.id === r.pos.id)?.rank;
        return {
          symbol: r.pos.symbol,
          side: r.side,
          mode: r.pos.mode,
          size: Math.abs(r.pos.size),
          entry: r.pos.entry,
          mark: r.state.mark,
          notional_usd: round(r.notional),
          unrealized_pnl_usd: round(r.upnl),
          liquidation_price: r.liq ? sig(r.liq) : null,
          bankruptcy_price: r.bankruptcy ? sig(r.bankruptcy) : null,
          static_distance: r.liqDistance === null ? null : round(r.liqDistance, 4),
          cascade_survival: survival === null ? "survives a 60% move" : round(r.side === "long" ? -survival : survival, 4),
          margin_ratio: round(r.ratio, 4),
          risk_level: r.level,
          adl_rank: rank ? `${rank} of ${adl.length}` : null,
        };
      }),
    });
  },
);

server.registerTool(
  "liquidation_ladder",
  {
    title: "Liquidation ladder for one market",
    description: "Notional that liquidates at each price bucket around the current mark for one market, split by longs and shorts, alongside resting bid/ask depth in the same buckets.",
    inputSchema: {
      symbol: z.string().describe("Market, e.g. BTC-USD or ADA"),
      range: z.number().min(0.02).max(0.9).default(0.25).describe("Fractional range around mark"),
      bins: z.number().int().min(5).max(100).default(25),
    },
  },
  async ({ symbol, range, bins }) => {
    const snap = await snapshot();
    const s = requireMarket(snap, symbol);
    const ladder = liquidationLadder(snap, s, range, bins);
    return json({
      symbol: s,
      mark: snap.markets[s].mark,
      bins: ladder
        .filter((b) => b.longLiq || b.shortLiq || b.bids || b.asks)
        .map((b) => ({ from: sig(b.lo), to: sig(b.hi), longs_liquidating_usd: round(b.longLiq, 0), shorts_liquidating_usd: round(b.shortLiq, 0), bids_usd: round(b.bids, 0), asks_usd: round(b.asks, 0) })),
    });
  },
);

server.registerTool(
  "derisk_plan",
  {
    title: "Smallest reduce-only order to survive a cascade",
    description:
      "For each position of an account: does it survive a cascade of `survive` (led by its own market, others by beta)? If not, the smallest reduce-only size after which the replayed cascade no longer reaches it, with the unsigned order body to send to POST /v2/order.",
    inputSchema: {
      address: z.string().min(3),
      survive: z.number().min(0.01).max(0.6).default(0.15).describe("Adverse move to survive, as a positive fraction"),
      symbol: z.string().optional().describe("Only this market"),
    },
  },
  async ({ address, survive, symbol }) => {
    const snap = await snapshot();
    const only = symbol ? requireMarket(snap, symbol) : undefined;
    const positions = findPositions(snap, address).filter((p) => !only || p.symbol === only);
    if (!positions.length) return json({ address, plans: [], note: "No matching open positions." });
    return json({
      survive,
      plans: positions.map((p) => {
        const plan = deriskPlan(snap, p.id, (s) => correlatedScenario(snap, s, p.symbol), survive)!;
        const m = snap.markets[p.symbol];
        return {
          symbol: p.symbol,
          side: plan.side,
          size: plan.currentSize,
          already_safe: plan.survivesWithoutAction,
          reduce_size: plan.reduceSize,
          reduce_fraction: round(plan.reduceFraction, 4),
          order: plan.survivesWithoutAction
            ? null
            : { symbol: p.symbol, side: plan.side === "long" ? "sell" : "buy", type: "market", size: stepString(plan.reduceSize, m.step), reduce_only: true },
        };
      }),
    });
  },
);

server.registerTool(
  "catch_plan",
  {
    title: "Where liquidity would absorb a cascade",
    description:
      "Find the price levels where a cascade's liquidation IOCs run out of book in one market, size post-only resting orders there within a USD budget, and replay the cascade with those orders to show how much flow moves from the SLP back to the order book, plus the orders' fills and PnL.",
    inputSchema: {
      symbol: z.string(),
      shock: z.number().min(-0.95).max(3).describe("Signed move of this market, e.g. -0.3"),
      budget_usd: z.number().positive().default(10_000),
      shape: shapeSchema,
    },
  },
  async ({ symbol, shock, budget_usd, shape }) => {
    const snap = await snapshot();
    const s = requireMarket(snap, symbol);
    const m = snap.markets[s];
    const p = catchPlan(snap, s, shock, budget_usd, (x) => correlatedScenario(snap, x, s, { shape: shape as Shape }));
    if (!p) throw new Error("shock must be non-zero");
    return json({
      symbol: s,
      shock,
      side: p.side,
      unabsorbed_liquidation_size: sig(p.unabsorbed),
      orders: p.orders.map((o) => ({ symbol: s, side: p.side === "bid" ? "buy" : "sell", type: "limit", price: stepString(o.price, m.tick), size: stepString(o.size, m.step), time_in_force: "GTC", post_only: true })),
      before: { on_book_usd: round(p.before.liquidatedNotional, 0), slp_usd: round(p.before.insuranceNotional, 0), adl_usd: round(p.before.adlNotional, 0) },
      after: { on_book_usd: round(p.after.liquidatedNotional, 0), slp_usd: round(p.after.insuranceNotional, 0), adl_usd: round(p.after.adlNotional, 0) },
      fills: { size: sig(p.filled.qty), notional_usd: round(p.filled.notional, 0), avg_price: sig(p.filled.avgPrice), from_liquidations: sig(p.filled.byLiquidation), from_arbitrage: sig(p.filled.byArb) },
      cushion_beyond_ioc_limit: p.cushion,
      discount_vs_mark_usd: round(p.discount, 0),
      pnl_at_scenario_end_usd: round(p.pnlAtEnd, 0),
      note: p.orders.length ? undefined : "Every liquidation IOC found liquidity at its limit; SLP flow here comes from accounts gapping past bankruptcy or other markets.",
    });
  },
);

await server.connect(new StdioServerTransport());
