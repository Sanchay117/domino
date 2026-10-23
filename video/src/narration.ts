// The narration, scene by scene. `text` is the caption; `say` (when present) is what the voice reads,
// spelled for speech. Shared by scripts/tts.ts (audio) and the Remotion composition (timing + captions).

export interface Line {
  text: string;
  say?: string;
}

export interface SceneScript {
  id: string;
  lines: Line[];
  /** Seconds of picture before the first line and after the last. */
  lead?: number;
  tail?: number;
}

export const VOICE = "aura-2-thalia-en";

export const SCRIPT: SceneScript[] = [
  {
    id: "open",
    lead: 1.6,
    tail: 0.8,
    lines: [
      { text: "On a perpetuals exchange, a liquidation is never just one liquidation." },
      { text: "It sells into the book, the bids thin out, the mark slips, and the next position falls." },
      { text: "Domino lets you watch that chain reaction on Strike Finance, before it happens." },
    ],
  },
  {
    id: "engine",
    lead: 0.4,
    tail: 0.6,
    lines: [
      { text: "Strike liquidates carefully." },
      {
        text: "A position is closed in up to five staged IOC orders, each bounded by a neutral price that protects the trader.",
        say: "A position is closed in up to five staged, I.O.C. orders, each bounded by a neutral price that protects the trader.",
      },
      {
        text: "Whatever the book can't absorb goes to the SLP vault, and when that's full, profitable traders on the other side are auto-deleveraged.",
        say: "Whatever the book can't absorb goes to the S.L.P. vault, and when that's full, profitable traders on the other side are auto-deleveraged.",
      },
      { text: "Domino ports every one of those rules to TypeScript, and replays them second by second, against every live position and the real order books." },
    ],
  },
  {
    id: "proof",
    lead: 0.3,
    tail: 1.0,
    lines: [
      { text: "Before simulating anything, it checks itself." },
      { text: "From public API data alone, Domino reproduces all 472 liquidation prices Strike serves. Exactly." },
    ],
  },
  {
    id: "radar",
    lead: 0.5,
    tail: 0.8,
    lines: [
      { text: "The Risk Radar runs twenty full cascade replays and draws the exchange's stress curve." },
      {
        text: "In a 20% crash led by Bitcoin, 94 accounts get hit: $470k clears through the order book, and $132k lands on the SLP.",
        say: "In a twenty percent crash led by Bitcoin, ninety-four accounts get hit. Four hundred and seventy thousand dollars clears through the order book, and a hundred and thirty-two thousand lands on the S.L.P.",
      },
      { text: "Below it, every market: where its next liquidation sits, and how much bid liquidity stands in front of it." },
    ],
  },
  {
    id: "lab",
    lead: 0.4,
    tail: 0.8,
    lines: [
      { text: "Click the curve, and the Cascade Lab plays that crash back, one mark-price batch at a time." },
      {
        text: "Above the axis, liquidation IOCs eat the resting bids. Below it, positions turn red as the cascade reaches them.",
        say: "Above the axis, liquidation I.O.C.s eat the resting bids. Below it, positions turn red as the cascade reaches them.",
      },
      {
        text: "And every IOC, SLP transfer and ADL fill lands in the log, in engine order.",
        say: "And every I.O.C., S.L.P. transfer and A.D.L. fill lands in the log, in engine order.",
      },
    ],
  },
  {
    id: "catch",
    lead: 0.4,
    tail: 1.0,
    lines: [
      { text: "So where is liquidity missing?" },
      {
        text: "Domino finds the IOC limits the book could not fill, and prices post-only bids right there.",
        say: "Domino finds the I.O.C. limits the book could not fill, and prices post-only bids right there.",
      },
      {
        text: "If ADA crashes 30%, $10k of bids moves almost $9k of liquidations off the SLP and back onto the order book.",
        say: "If ADA crashes thirty percent, ten thousand dollars of bids moves almost nine thousand dollars of liquidations off the S.L.P., and back onto the order book.",
      },
    ],
  },
  {
    id: "xray",
    lead: 0.4,
    tail: 0.6,
    lines: [
      { text: "Paste any wallet into Position X-Ray." },
      {
        text: "This $103k oil long is 9.5% from liquidation. To survive a 15% cascade, it needs to cut 35%.",
        say: "This hundred-thousand-dollar oil long is nine and a half percent from liquidation. To survive a fifteen percent cascade, it needs to cut thirty-five percent.",
      },
    ],
  },
  {
    id: "guardian",
    lead: 0.3,
    tail: 1.0,
    lines: [
      { text: "Guardian turns that into a bot." },
      { text: "It signs the reduce-only order with your Strike API wallet, adds a builder fee, and keeps watching." },
    ],
  },
  {
    id: "mcp",
    lead: 0.4,
    tail: 1.2,
    lines: [
      {
        text: "And because agents trade too, Domino ships an MCP server.",
        say: "And because agents trade too, Domino ships an M.C.P. server.",
      },
      { text: "Ask Claude what a 15% crash would do to Strike, and it runs the same replay on live data.", say: "Ask Claude what a fifteen percent crash would do to Strike, and it runs the same replay on live data." },
    ],
  },
  {
    id: "outro",
    lead: 0.5,
    tail: 2.6,
    lines: [
      { text: "Domino. Open source, no backend, built entirely on the public Strike Finance API." },
      { text: "See the cascade before the market does." },
    ],
  },
];
