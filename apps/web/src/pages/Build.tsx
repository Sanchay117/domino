import { validateAgainstServed, type NormalizedSnapshot } from "@domino/engine";
import { useMemo } from "react";

const MCP_CONFIG = `# Claude Code
claude mcp add domino -- npx tsx /path/to/domino/apps/mcp/src/server.ts

# Claude Desktop or any MCP client
{
  "mcpServers": {
    "domino": {
      "command": "npx",
      "args": ["tsx", "/path/to/domino/apps/mcp/src/server.ts"]
    }
  }
}`;

const ENGINE = `import { loadSnapshot, correlatedScenario, simulate } from "@domino/engine";

const snap = await loadSnapshot();                 // live Strike mainnet
const crash = correlatedScenario(snap, -0.2);      // BTC −20%, others by β
const { totals, events } = simulate(snap, crash, { insuranceFund: 500_000 });

console.log(totals.liquidatedNotional, totals.insuranceNotional, totals.adlNotional);`;

const GUARDIAN = `# read-only market scan
npm run guardian -- scan

# watch a wallet and keep every position alive through a 15% cascade
npm run guardian -- protect --address addr1q… --survive 15 --watch 30

# same, but actually send the reduce-only orders (needs an API wallet)
STRIKE_API_PUBLIC_KEY=… STRIKE_API_PRIVATE_KEY=… \\
npm run guardian -- protect --address addr1q… --survive 15 --watch 30 --live

# rest bids where a 30% ADA crash's liquidation IOCs run out of book
npm run guardian -- catch --symbol ADA-USD --shock 30 --budget 10000`;

const TESTS = [
  "Partial liquidation: 1 BTC @ $50k at 125% margin ratio → 0.5 BTC first IOC",
  "Attempt fractions 20% → 100% with margin ratio; attempt 5 closes everything",
  "Impact price $1,000 over 4 @ 100 + 10 @ 102 → 101.19047619",
  "P1 funding adjustment: 20,000 × (1 + 0.01% × ½h) → 20,001",
  "Ask-side sweep moves P3 by 12% but mark stays at ≈100.005",
  "Mark falls back to P2 beyond the 5% index deviation",
  "Maintenance amounts derived for tier continuity (AAOI: 830, 9,180)",
  "A fill at the neutral price preserves a cross profile's margin ratio",
  "IOC limits include taker commission, tick-aligned away from the trader",
  "Risk levels at 70% / 90% / 100% margin ratio and bankruptcy",
  "Every live liquidation price Strike serves is reproduced",
  "A flat market liquidates nobody",
  "Size is conserved: closed = liquidated + backstopped + deleveraged",
  "Deeper crashes never liquidate less",
  "ADL queue ordered by profit % × effective leverage",
  "A resting order the market never reaches changes nothing",
  "Catch orders take flow off the SLP and never overfill",
  "Empty-body hash and Ed25519 signatures verify",
];

export default function Build({ snap }: { snap: NormalizedSnapshot }) {
  const v = useMemo(() => validateAgainstServed(snap), [snap]);
  return (
    <>
      <div className="hero">
        <div>
          <h1>Guardian, MCP &amp; the engine</h1>
          <p>
            Domino is three things on one engine: this dashboard, <b>Guardian</b> (a bot that signs Strike API-wallet orders to de-risk positions or
            provide liquidity where cascades will need it), and an <b>MCP server</b> so any AI agent can stress-test Strike before it trades.
          </p>
        </div>
      </div>
      <div className="grid cols-2">
        <div className="panel">
          <h2>Guardian bot</h2>
          <p className="sub">
            Signs with your Strike API wallet (Ed25519, never leaves your machine), dry-run by default, and attaches your builder code fee via{" "}
            <span className="num">X-Builder-Fee-Bps</span> so integrators earn on the flow it creates.
          </p>
          <pre className="code">{GUARDIAN}</pre>
        </div>
        <div className="panel">
          <h2>MCP server for AI agents</h2>
          <p className="sub">
            Tools: <span className="num">market_risk</span>, <span className="num">stress_test</span>, <span className="num">position_xray</span>,{" "}
            <span className="num">liquidation_ladder</span>, <span className="num">derisk_plan</span>, <span className="num">catch_plan</span>. Ask Claude "what
            happens to my Strike book if BTC drops 15%?" and it runs the replay.
          </p>
          <pre className="code">{MCP_CONFIG}</pre>
        </div>
        <div className="panel">
          <h2>Use the engine directly</h2>
          <p className="sub">Pure TypeScript, no backend. Runs in the browser (this page) or Node.</p>
          <pre className="code">{ENGINE}</pre>
        </div>
        <div className="panel">
          <h2>Why trust the numbers</h2>
          <p className="sub">
            Right now Domino reproduces <b className="mint">{v.matched} of {v.total}</b> liquidation prices Strike serves for live positions (worst error{" "}
            {(v.worst * 100).toFixed(4)}%). The test suite encodes Strike's own documented worked examples:
          </p>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {TESTS.map((t) => (
              <div key={t}>
                <span className="mint">✓</span> {t}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Model notes</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          Each simulated second is one mark-price batch. Index paths are scenario inputs; markets follow the leader by β estimated from Strike's own hourly
          candles. Book levels within 2% of mid are treated as market-maker quotes that re-peg to the index, get pulled as the move deepens and refill over
          time; deeper levels are static and taken by arbitrage once the index passes them. Liquidations follow Strike's documented staged process. The SLP
          acceptance rule (drawdown and per-market exposure caps) is an assumption you can tune in the Lab, since Strike does not publish its utilisation
          limits. Taker fees use tier 0 for every account. Positions already past maintenance in the snapshot are frozen.
        </p>
      </div>
    </>
  );
}
