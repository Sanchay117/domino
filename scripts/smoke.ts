// Quick end-to-end run of the simulator on the captured fixture.
import { readFileSync } from "node:fs";
import { correlatedScenario, marketRisks, normalizeSnapshot, simulate, singleScenario, type RawSnapshot } from "@domino/engine";

const snap = normalizeSnapshot(JSON.parse(readFileSync(process.argv[2] ?? "fixtures/snapshot.json", "utf8")) as RawSnapshot);
console.log("treasury", Math.round(snap.treasuryUsd), "betas", Object.entries(snap.betas).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(" "));
const usd = (x: number) => "$" + Math.round(x).toLocaleString();

for (const shock of [-0.05, -0.1, -0.2, -0.3, 0.1, 0.2]) {
  const t0 = performance.now();
  const r = simulate(snap, correlatedScenario(snap, shock));
  const t = r.totals;
  console.log(
    `${(shock * 100).toFixed(0).padStart(4)}%  ${(performance.now() - t0).toFixed(0)}ms  liq ${usd(t.liquidatedNotional)}  IF ${usd(t.insuranceNotional)}  ADL ${usd(t.adlNotional)}  uncovered ${usd(t.uncoveredNotional)}  accts ${t.accountsHit}  pos ${t.positionsHit}/${t.positionsClosed} closed  nofill ${t.noFillAttempts}/${t.iocAttempts}  gap ${t.maxMarkGap.symbol} ${(t.maxMarkGap.pct * 100).toFixed(2)}%  IFpnl ${usd(t.insurancePnl)}`,
  );
}
for (const [sym, shock] of [["ADA-USD", -0.25], ["NIGHT-USD", 0.3], ["WTI-USD", -0.15]] as const) {
  const r = simulate(snap, singleScenario(sym, shock));
  console.log(sym, shock, JSON.stringify(r.totals));
}
const rows = marketRisks(snap).filter((r) => r.positions > 0).sort((a, b) => b.longUsd + b.shortUsd - a.longUsd - a.shortUsd);
for (const r of rows.slice(0, 10))
  console.log(r.symbol.padEnd(11), "beta", r.beta.toFixed(2), "OI", usd(r.longUsd + r.shortUsd), "nearestL", r.nearestLong?.toFixed(3), "nearestS", r.nearestShort?.toFixed(3), "L10", usd(r.longLiqUsd10), "bid10", usd(r.bidDepth10));
