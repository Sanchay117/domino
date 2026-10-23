// End-to-end check of the MCP server over stdio: list tools, then call each one against live Strike data.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "domino-smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "apps/mcp/src/server.ts"] }));

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const text = (r: Awaited<ReturnType<typeof client.callTool>>) => (r.content as { type: string; text: string }[])[0]?.text ?? "";
const call = async (name: string, args: Record<string, unknown>, show = 900) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const out = text(r);
  console.log(`\n## ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms${r.isError ? ", ERROR" : ""})\n${out.slice(0, show)}${out.length > show ? "\n…" : ""}`);
  return out;
};

const risk = JSON.parse(await call("market_risk", { top: 3 }));
await call("stress_test", { shock: -0.2 }, 1400);
await call("liquidation_ladder", { symbol: "ADA", range: 0.1, bins: 10 }, 600);
await call("catch_plan", { symbol: "ADA-USD", shock: -0.3, budget_usd: 10000 }, 1200);

// Find a live wallet with an open position to x-ray and plan for.
const ladder = await call("stress_test", { shock: -0.1, symbol: "BTC-USD" }, 0);
const wallet = (JSON.parse(ladder).largest_events as { account: string }[]).find((e) => e.account.startsWith("addr") || e.account.startsWith("0x"))?.account;
if (wallet) {
  await call("position_xray", { address: wallet }, 1500);
  await call("derisk_plan", { address: wallet, survive: 0.15 }, 1200);
}
await call("stress_test", { shock: -0.2, symbol: "NOPE" }, 300);
console.log("\nsnapshot positions:", risk.positions);
await client.close();
