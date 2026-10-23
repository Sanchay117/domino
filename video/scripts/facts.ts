// Every number the narration quotes, computed from the same snapshot the footage is recorded on.
// Writes src/generated/facts.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  catchPlan,
  correlatedScenario,
  deriskPlan,
  marketRisks,
  normalizeSnapshot,
  positionRisks,
  simulate,
  validateAgainstServed,
  type RawSnapshot,
} from "../../packages/engine/src/index.ts";

const raw = JSON.parse(readFileSync(new URL("../../fixtures/snapshot.json", import.meta.url), "utf8")) as RawSnapshot;
const snap = normalizeSnapshot(raw);
const risks = positionRisks(snap);
const v = validateAgainstServed(snap);

const crash = (shock: number, leader = "BTC-USD") => simulate(snap, correlatedScenario(snap, shock, leader)).totals;
const btc20 = crash(-0.2);
const btc15 = crash(-0.15);
const curve = Array.from({ length: 20 }, (_, i) => -0.4 + i * 0.04).filter((s) => s < 0);
const firstSlp = curve.map((s) => ({ s, t: crash(s) })).filter((p) => p.t.insuranceNotional > 1000).sort((a, b) => b.s - a.s)[0];

const ada = catchPlan(snap, "ADA-USD", -0.3, 10_000, (s) => correlatedScenario(snap, s, "ADA-USD"))!;

// Showcase wallet for X-Ray: a sizeable single-position wallet that a 15% cascade would reach, with a sensible fix.
const candidates = snap.accounts
  .filter((a) => a.address && a.positions.length === 1)
  .map((a) => ({ a, r: risks.find((r) => r.account.key === a.key)! }))
  .filter(({ r }) => r && r.notional > 3000 && r.level === "none")
  .sort((x, y) => y.r.notional - x.r.notional);
let xray: Record<string, unknown> | null = null;
for (const { a, r } of candidates) {
  const plan = deriskPlan(snap, r.pos.id, (s) => correlatedScenario(snap, s, r.pos.symbol), 0.15);
  if (plan && !plan.survivesWithoutAction && plan.reduceFraction > 0.08 && plan.reduceFraction < 0.6) {
    xray = {
      address: a.address,
      symbol: r.pos.symbol,
      side: r.side,
      notional: r.notional,
      liq: r.liq,
      liqDistance: r.liqDistance,
      reduceSize: plan.reduceSize,
      reduceFraction: plan.reduceFraction,
    };
    break;
  }
}

const markets = marketRisks(snap, risks).filter((m) => m.positions > 0);
const facts = {
  fetchedAt: snap.fetchedAt,
  validation: v,
  openInterest: risks.reduce((s, r) => s + r.notional, 0),
  positions: risks.length,
  accounts: snap.accounts.length,
  marketsWithPositions: markets.length,
  slpEquity: snap.slpEquity,
  btc20,
  btc15,
  firstSlpShock: firstSlp?.s ?? null,
  catch: {
    symbol: "ADA-USD",
    shock: -0.3,
    budget: 10_000,
    orders: ada.orders,
    cushion: ada.cushion,
    before: ada.before,
    after: ada.after,
    filled: ada.filled,
    pnlAtEnd: ada.pnlAtEnd,
  },
  xray,
};

mkdirSync(new URL("../src/generated/", import.meta.url), { recursive: true });
writeFileSync(new URL("../src/generated/facts.json", import.meta.url), JSON.stringify(facts, null, 2));
console.log(JSON.stringify({ ...facts, catch: { ...facts.catch, before: undefined, after: undefined } }, null, 2));
console.log("catch SLP", Math.round(ada.before.insuranceNotional), "->", Math.round(ada.after.insuranceNotional));
