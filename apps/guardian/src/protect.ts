// `guardian protect`: keep every position of one account out of reach of a cascade of a chosen size.
// Each cycle replays the cascade against the latest snapshot; when it would touch a position, Guardian
// sends the smallest reduce-only order after which it no longer does.

import { correlatedScenario, deriskPlan, findPositions, positionRisks, stepString, type NormalizedSnapshot, type OrderRequest } from "@domino/engine";
import { load, makeClient, type CommonOptions } from "./context.ts";
import { base, c, heading, pct, price, size, table, usdShort } from "./term.ts";

export interface ProtectOptions extends CommonOptions {
  query: string;
  symbol?: string;
  survive: number;
  watch?: number;
  live?: boolean;
  builderFee?: number;
  maxOrderUsd: number;
}

export async function protect(o: ProtectOptions): Promise<void> {
  const { client, demoKey } = makeClient(o);
  if (o.live) await client.syncClock();
  // Positions with an order in flight, keyed by id → size when the order went out; skipped until the size changes.
  const pending = new Map<number, number>();
  let betas: Record<string, number> | undefined;

  for (let cycle = 1; ; cycle++) {
    const snap = await load(o, betas);
    betas = snap.betas;
    await protectOnce(snap, o, client, demoKey, pending, cycle);
    if (!o.watch) return;
    console.log(c.dim(`\nnext check in ${o.watch}s · Ctrl-C to stop`));
    await new Promise((r) => setTimeout(r, o.watch! * 1000));
  }
}

async function protectOnce(
  snap: NormalizedSnapshot,
  o: ProtectOptions,
  client: ReturnType<typeof makeClient>["client"],
  demoKey: boolean,
  pending: Map<number, number>,
  cycle: number,
): Promise<void> {
  const ids = new Set(findPositions(snap, o.query).filter((p) => !o.symbol || p.symbol === o.symbol).map((p) => p.id));
  const risks = positionRisks(snap).filter((r) => ids.has(r.pos.id));
  const at = new Date(snap.fetchedAt).toISOString().slice(11, 19);
  heading(`Guardian · cycle ${cycle} · ${at} UTC · survive a ${pct(o.survive, 0)} cascade ${o.live ? c.red("LIVE") : c.dim("dry run")}`);
  if (!risks.length) {
    console.log(c.yellow(`No open positions for ${o.query}${o.symbol ? ` in ${o.symbol}` : ""}.`));
    return;
  }

  const orders: { order: OrderRequest; usd: number; posId: number; size: number }[] = [];
  const rows: string[][] = [];
  for (const r of risks) {
    const m = snap.markets[r.pos.symbol];
    const was = pending.get(r.pos.id);
    if (was !== undefined && was === r.pos.size) {
      rows.push([c.bold(base(r.pos.symbol)), r.side, size(Math.abs(r.pos.size)), price(r.state.mark), r.liq ? price(r.liq) : "—", "—", c.dim("order pending, waiting for fill")]);
      continue;
    }
    pending.delete(r.pos.id);
    // The cascade is led by the position's own market, with every other market following by β.
    const plan = deriskPlan(snap, r.pos.id, (shock) => correlatedScenario(snap, shock, r.pos.symbol), o.survive);
    const dist = r.liqDistance === null ? "—" : pct(r.liqDistance);
    if (!plan || plan.survivesWithoutAction) {
      rows.push([c.bold(base(r.pos.symbol)), r.side, size(Math.abs(r.pos.size)), price(r.state.mark), r.liq ? price(r.liq) : "—", dist, c.green("safe")]);
      continue;
    }
    const usd = plan.reduceSize * r.state.mark;
    rows.push([
      c.bold(base(r.pos.symbol)),
      r.side,
      size(Math.abs(r.pos.size)),
      price(r.state.mark),
      r.liq ? price(r.liq) : "—",
      dist,
      c.yellow(`reduce ${size(plan.reduceSize)} (${(plan.reduceFraction * 100).toFixed(1)}%, ${usdShort(usd)})`),
    ]);
    orders.push({
      order: {
        symbol: r.pos.symbol,
        side: r.side === "long" ? "sell" : "buy",
        type: "market",
        size: stepString(plan.reduceSize, m.step),
        reduce_only: true,
        client_order_id: `domino-guardian-${r.pos.id}-${Date.now()}`,
      },
      usd,
      posId: r.pos.id,
      size: r.pos.size,
    });
  }
  table(["market", "side", ">size", ">mark", ">liq price", ">distance", "guardian"], rows);

  for (const { order, usd, posId, size: sizeNow } of orders) {
    if (usd > o.maxOrderUsd) {
      console.log(c.red(`\nSkipping ${order.symbol}: ${usdShort(usd)} exceeds --max-order ${usdShort(o.maxOrderUsd)}. Raise it if this is intended.`));
      continue;
    }
    const req = client.placeOrderRequest(order);
    if (!o.live) {
      console.log(`\n${c.dim(demoKey ? "Signed with a throwaway key (set STRIKE_API_PUBLIC_KEY / STRIKE_API_PRIVATE_KEY to sign as you):" : "Signed, not sent (add --live to send):")}`);
      console.log(c.cyan(`${req.method} ${req.url}`));
      for (const [k, v] of Object.entries(req.headers)) console.log(c.dim(`${k}: ${v}`));
      console.log(req.body);
      continue;
    }
    const res = await client.send(req);
    const ok = res.status >= 200 && res.status < 300;
    console.log(`${ok ? c.green("sent") : c.red(`rejected (${res.status})`)} ${order.side} ${order.size} ${order.symbol} reduce-only · ${JSON.stringify(res.body)}`);
    if (ok) pending.set(posId, sizeNow);
  }
}
