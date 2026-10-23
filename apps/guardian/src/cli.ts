#!/usr/bin/env node
// Guardian CLI: `scan`, `protect` and `catch` on top of the Domino engine. Dry run unless --live.

import { parseArgs } from "node:util";
import type { Shape } from "@domino/engine";
import { catchCascade } from "./catch.ts";
import { load, type CommonOptions } from "./context.ts";
import { protect } from "./protect.ts";
import { scan } from "./scan.ts";
import { c } from "./term.ts";

const HELP = `${c.bold("guardian")} · liquidation-cascade tooling for Strike Finance perps

  ${c.bold("scan")}                                   exchange-wide stress curve, market risk and closest liquidations
  ${c.bold("protect")} --address <wallet|account|vault> [--symbol BTC-USD] [--survive 15] [--watch 30] [--live]
                                         keep each position out of reach of a cascade of N% (led by its own market)
  ${c.bold("catch")} --symbol <market> [--shock 12|+12] [--budget 2000] [--shape crash|linear|wick] [--live]
                                         rest post-only orders where liquidation IOCs run out of book

options
  --network mainnet|testnet   API to read and trade on (default mainnet)
  --fixture <file>            use a saved snapshot instead of live data (reproducible runs)
  --builder-fee <bps>         attach X-Builder-Fee-Bps to orders
  --max-order <usd>           protect: refuse any single order above this notional (default 25000)
  --live                      actually send orders (needs STRIKE_API_PUBLIC_KEY and STRIKE_API_PRIVATE_KEY)

Without --live nothing is sent: orders are signed and printed.`;

async function main(): Promise<void> {
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
      address: { type: "string" },
      symbol: { type: "string" },
      survive: { type: "string", default: "15" },
      watch: { type: "string" },
      shock: { type: "string", default: "12" },
      budget: { type: "string", default: "2000" },
      shape: { type: "string", default: "crash" },
      network: { type: "string", default: "mainnet" },
      fixture: { type: "string" },
      "builder-fee": { type: "string" },
      "max-order": { type: "string", default: "25000" },
      top: { type: "string", default: "10" },
      live: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const cmd = positionals[0];
  if (v.help || !cmd) return console.log(HELP);

  const network = v.network === "testnet" ? "testnet" : "mainnet";
  const common: CommonOptions = { network, fixture: v.fixture };
  const num = (name: string, s: string | undefined) => {
    const x = Number(s);
    if (s === undefined || !Number.isFinite(x)) throw new Error(`--${name} must be a number`);
    return x;
  };
  const builderFee = v["builder-fee"] === undefined ? undefined : num("builder-fee", v["builder-fee"]);
  const symbol = v.symbol ? (v.symbol.includes("-") ? v.symbol : `${v.symbol}-USD`).toUpperCase() : undefined;
  if (v.live && v.fixture) throw new Error("--live cannot be combined with --fixture: orders must be based on live positions.");

  switch (cmd) {
    case "scan":
      return scan(await load(common), num("top", v.top));
    case "protect":
      if (!v.address) throw new Error("protect needs --address <wallet address, account id or vault id>");
      return protect({
        ...common,
        query: v.address,
        symbol,
        survive: Math.abs(num("survive", v.survive)) / 100,
        watch: v.watch === undefined ? undefined : Math.max(5, num("watch", v.watch)),
        live: v.live,
        builderFee,
        maxOrderUsd: num("max-order", v["max-order"]),
      });
    case "catch": {
      if (!symbol) throw new Error("catch needs --symbol, e.g. --symbol BTC-USD");
      const shape = v.shape as Shape;
      if (!["crash", "linear", "wick"].includes(shape)) throw new Error("--shape must be crash, linear or wick");
      // A bare number is a crash; "+N" is a squeeze.
      const shock = (v.shock.trim().startsWith("+") ? 1 : -1) * Math.abs(num("shock", v.shock)) / 100;
      return catchCascade(await load(common), { ...common, symbol, shock, budget: num("budget", v.budget), shape, live: v.live, builderFee });
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(c.red(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
