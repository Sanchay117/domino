// `guardian scan`: a read-only risk report for the whole exchange.

import { correlatedScenario, distressedAtSnapshot, MAINNET, marketRisks, TESTNET, positionRisks, simulate, validateAgainstServed, type NormalizedSnapshot } from "@domino/engine";
import { base, c, heading, pct, price, shortAddr, table, usdShort } from "./term.ts";

const SHOCKS = [-0.05, -0.1, -0.15, -0.2, -0.3, 0.1, 0.2];

export function scan(snap: NormalizedSnapshot, top = 10): void {
  const risks = positionRisks(snap);
  const v = validateAgainstServed(snap);
  const oi = risks.reduce((s, r) => s + r.notional, 0);
  const at = new Date(snap.fetchedAt).toISOString().replace("T", " ").slice(0, 16);

  console.log(`${c.bold("Domino scan")} ${c.dim(`· Strike ${snap.source === MAINNET ? "mainnet" : snap.source === TESTNET ? "testnet" : snap.source} · ${at} UTC`)}`);
  console.log(
    `Open interest ${c.bold(usdShort(oi))} across ${risks.length} positions and ${snap.accounts.length} accounts · SLP backstop ${c.yellow(usdShort(snap.slpEquity))}`,
  );
  console.log(c.dim(`Liquidation prices recomputed from public data: ${v.matched}/${v.total} match what Strike serves.`));

  heading("Exchange stress curve · BTC leads over 3 minutes, every market follows by β");
  table(
    [">shock", ">on book", ">to SLP", ">ADL", ">uncovered", ">accounts", ">no-fill IOCs", "worst mark gap"],
    SHOCKS.map((shock) => {
      const t = simulate(snap, correlatedScenario(snap, shock)).totals;
      return [
        pct(shock, 0),
        usdShort(t.liquidatedNotional),
        t.insuranceNotional > 0 ? c.yellow(usdShort(t.insuranceNotional)) : c.dim("$0"),
        t.adlNotional > 0 ? c.magenta(usdShort(t.adlNotional)) : c.dim("$0"),
        t.uncoveredNotional > 0 ? c.red(usdShort(t.uncoveredNotional)) : c.dim("$0"),
        String(t.accountsHit),
        `${t.noFillAttempts}/${t.iocAttempts}`,
        t.maxMarkGap.symbol ? `${base(t.maxMarkGap.symbol)} ${pct(t.maxMarkGap.pct, 2)}` : "–",
      ];
    }),
  );

  heading(`Markets · top ${top} by open interest`);
  const markets = marketRisks(snap, risks)
    .filter((m) => m.positions > 0)
    .sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd))
    .slice(0, top);
  const dist = (d: number | null, near: boolean) => (d === null ? c.dim("–") : near ? c.red(pct(d)) : Math.abs(d) > 5 ? ">500%" : pct(d));
  table(
    ["market", ">OI", ">longs/shorts", ">next long liq", ">next short liq", ">longs liq ≤10%", ">bids ≤10%", ">cover", ">β"],
    markets.map((m) => {
      const cover = m.longLiqUsd10 > 0 ? m.bidDepth10 / m.longLiqUsd10 : Infinity;
      return [
        c.bold(base(m.symbol)),
        usdShort(m.longUsd + m.shortUsd),
        `${m.longs}/${m.shorts}`,
        dist(m.nearestLong, m.nearestLong !== null && m.nearestLong > -0.03),
        dist(m.nearestShort, m.nearestShort !== null && m.nearestShort < 0.03),
        m.longLiqUsd10 ? usdShort(m.longLiqUsd10) : c.dim("–"),
        usdShort(m.bidDepth10),
        !Number.isFinite(cover) ? c.green("∞") : cover < 1 ? c.red(`${cover.toFixed(1)}×`) : cover < 3 ? c.yellow(`${cover.toFixed(1)}×`) : c.green(`${cover.toFixed(1)}×`),
        m.beta.toFixed(2),
      ];
    }),
  );

  heading("Closest to liquidation");
  const closest = risks
    .filter((r) => r.liqDistance !== null && r.level !== "bankrupt" && r.level !== "liquidate")
    .sort((a, b) => Math.abs(a.liqDistance!) - Math.abs(b.liqDistance!))
    .slice(0, 8);
  table(
    ["account", "position", ">notional", ">mark", ">liq price", ">distance", ">margin ratio"],
    closest.map((r) => [
      r.account.address ? shortAddr(r.account.address) : `vault ${r.account.vaultId.slice(0, 8)}`,
      `${base(r.pos.symbol)} ${r.side} ${r.pos.mode}`,
      usdShort(r.notional),
      price(r.state.mark),
      price(r.liq),
      Math.abs(r.liqDistance!) < 0.03 ? c.red(pct(r.liqDistance!)) : pct(r.liqDistance!),
      `${(r.ratio * 100).toFixed(1)}%`,
    ]),
  );

  const distressed = distressedAtSnapshot(snap, risks);
  if (distressed.length)
    console.log(
      c.dim(`\n${distressed.length} position(s) already past maintenance in this snapshot (${distressed.map((d) => `${base(d.pos.symbol)} ${d.side}`).join(", ")}); scenarios freeze them.`),
    );
}
