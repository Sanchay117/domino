// `guardian catch`: rest post-only orders exactly where a cascade's liquidation IOCs run out of book,
// so that flow clears through the order book instead of landing on the SLP vault.

import { catchPlan, correlatedScenario, stepString, type NormalizedSnapshot, type Shape } from "@domino/engine";
import { makeClient, type CommonOptions } from "./context.ts";
import { base, c, heading, pct, price, size, table, usd, usdShort } from "./term.ts";

export interface CatchOptions extends CommonOptions {
  symbol: string;
  shock: number;
  budget: number;
  shape: Shape;
  live?: boolean;
  builderFee?: number;
}

export async function catchCascade(snap: NormalizedSnapshot, o: CatchOptions): Promise<void> {
  if (!snap.markets[o.symbol]) throw new Error(`Unknown market ${o.symbol}. Try BTC-USD, ETH-USD, ADA-USD…`);
  const m = snap.markets[o.symbol];
  const make = (s: number) => correlatedScenario(snap, s, o.symbol, { shape: o.shape });
  const plan = catchPlan(snap, o.symbol, o.shock, o.budget, make);
  if (!plan) throw new Error("Nothing to plan: give a non-zero --shock and a positive --budget.");
  const sym = base(o.symbol);
  const liquidated = plan.side === "bid" ? "long" : "short";

  console.log(
    `${c.bold("Domino catch")} ${c.dim(`· ${sym} ${pct(o.shock, 0)} over 3 minutes (${o.shape}), every market following by β · budget ${usd(o.budget)}`)}`,
  );
  const b = plan.before;
  console.log(
    `Baseline: ${usdShort(b.liquidatedNotional)} clears through the book, ${c.yellow(usdShort(b.insuranceNotional))} lands on the SLP, ${c.magenta(usdShort(b.adlNotional))} is auto-deleveraged.`,
  );
  if (!plan.orders.length) {
    console.log(
      c.green(
        `\nEvery ${sym} ${liquidated} liquidation IOC in this scenario finds liquidity at its limit. Anything the SLP takes comes from accounts that gap straight past bankruptcy or from other markets, which resting orders here cannot help.`,
      ),
    );
    return;
  }
  console.log(
    `${size(plan.unabsorbed)} ${sym} of ${liquidated} liquidations went to the backstop because their IOCs found no ${plan.side === "bid" ? "bids" : "asks"} at their limit price.`,
  );

  heading(`Resting ${plan.side}s · post-only GTC, priced at the IOC limits${plan.cushion ? ` (${plan.side === "bid" ? "+" : "−"}${(plan.cushion * 100).toFixed(2)}% cushion)` : ""} so the liquidation engine can match them`);
  table(
    [">price", ">size", ">notional", ">vs mark now"],
    plan.orders.map((x) => [price(x.price), size(x.size), usdShort(x.price * x.size), pct(x.price / m.mark - 1)]),
  );

  const a = plan.after;
  const f = plan.filled;
  heading("Replayed with these orders in the book");
  table(
    ["", ">before", ">after", ">change"],
    [
      ["through the book", usdShort(b.liquidatedNotional), usdShort(a.liquidatedNotional), delta(a.liquidatedNotional - b.liquidatedNotional, true)],
      ["to the SLP", usdShort(b.insuranceNotional), usdShort(a.insuranceNotional), delta(a.insuranceNotional - b.insuranceNotional, false)],
      ["auto-deleveraged", usdShort(b.adlNotional), usdShort(a.adlNotional), delta(a.adlNotional - b.adlNotional, false)],
      ["SLP mark-to-market", usdShort(b.insurancePnl), usdShort(a.insurancePnl), delta(a.insurancePnl - b.insurancePnl, true)],
    ],
  );
  console.log(
    `\nYour fills: ${size(f.qty)} ${sym} (${usdShort(f.notional)}) at ${price(f.avgPrice)} on average · ${size(f.byLiquidation)} from liquidation IOCs, ${size(f.byArb)} from arbitrage.`,
  );
  console.log(
    `Bought ${usdShort(plan.discount)} ${plan.side === "bid" ? "below" : "above"} mark at fill time. Marked at the scenario's last price (${price(plan.endMark)}): ${plan.pnlAtEnd >= 0 ? c.green(usd(plan.pnlAtEnd)) : c.red(usd(plan.pnlAtEnd))}${o.shape !== "wick" ? c.dim(" (try --shape wick for a crash that retraces)") : ""}.`,
  );

  const { client, demoKey } = makeClient(o);
  if (o.live) await client.syncClock();
  heading(o.live ? "Placing orders" : demoKey ? "Signed orders (throwaway key; dry run)" : "Signed orders (dry run; add --live to place)");
  for (const x of plan.orders) {
    const req = client.placeOrderRequest({
      symbol: o.symbol,
      side: plan.side === "bid" ? "buy" : "sell",
      type: "limit",
      size: stepString(x.size, m.step),
      price: stepString(x.price, m.tick),
      time_in_force: "GTC",
      post_only: true,
      client_order_id: `domino-catch-${Date.now()}-${Math.round(x.price / m.tick)}`,
    });
    if (!o.live) {
      console.log(`${c.cyan(`${req.method} ${req.path}`)} ${req.body}`);
      continue;
    }
    const res = await client.send(req);
    console.log(`${res.status < 300 ? c.green("placed") : c.red(`rejected (${res.status})`)} ${JSON.stringify(res.body)}`);
  }
}

function delta(x: number, upIsGood: boolean): string {
  if (Math.abs(x) < 0.5) return c.dim("—");
  const s = (x > 0 ? "+" : "") + usdShort(x);
  return x > 0 === upIsGood ? c.green(s) : c.red(s);
}
