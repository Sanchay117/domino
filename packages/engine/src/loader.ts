// Pull a full exchange snapshot from Strike's public APIs and normalize it for the engine.

import { normalizeTiers } from "./math.ts";
import type { Account, Book, Market, Position, RawDepth, RawLivePosition, RawMarket, RawMarketStat, Snapshot } from "./types.ts";

export const MAINNET = "https://api.strikefinance.org";
export const TESTNET = "https://api-v2-testnet.strikefinance.org";

/** Everything Domino reads, exactly as Strike served it (fixtures store this shape). */
export interface RawSnapshot {
  fetchedAt: number;
  source: string;
  markets: Record<string, RawMarket>;
  positions: RawLivePosition[];
  depth: Record<string, RawDepth>;
  marketStats: RawMarketStat[];
  treasury: { columns: string[]; data: [number, string, number][] };
  fearGreed?: { value: number; classification: string };
  vaults: { vault_id: string; type: string; name: string; equity: string }[];
  takerRate: number;
  /** Hourly [openTime, close] candles per symbol, used to estimate betas. */
  closes: Record<string, [number, number][]>;
}

export interface LoadOptions {
  base?: string;
  fetch?: typeof fetch;
  /** Fetch hourly candles to estimate betas (adds one request per market). */
  withCandles?: boolean;
  depthLimit?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchRawSnapshot(opts: LoadOptions = {}): Promise<RawSnapshot> {
  const base = opts.base ?? MAINNET;
  const f = opts.fetch ?? fetch;
  const get = async <T>(path: string): Promise<T> => {
    const r = await f(base + path);
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return (await r.json()) as T;
  };
  const fetchedAt = Date.now();
  const [marketsRes, livePos, stats, treasury, fearGreed, feeTiers, vaults] = await Promise.all([
    get<{ markets: Record<string, RawMarket> }>("/v2/markets"),
    get<{ positions: RawLivePosition[] }>("/stat/v1/stats/live-positions"),
    get<{ data: RawMarketStat[] }>("/price/v2/marketStats"),
    get<{ columns: string[]; data: [number, string, number][] }>("/stat/v1/dashboard/treasury").catch(() => ({ columns: [], data: [] })),
    get<{ data: { value: number; classification: string } }>("/price/v2/fearGreed").catch(() => null),
    get<{ feeTiers: { Tier: number; TakerRate: number }[] }>("/v2/fee-tiers").catch(() => null),
    get<{ vaults: RawSnapshot["vaults"] }>("/v2/vaults").catch(() => ({ vaults: [] })),
  ]);
  const symbols = Object.keys(marketsRes.markets).filter((s) => marketsRes.markets[s].status === "trading");
  const jobs = symbols.length * (opts.withCandles === false ? 1 : 2);
  let done = 0;
  const tick = (label: string) => opts.onProgress?.(++done, jobs, label);

  const depthRows = await pool(symbols, 6, async (s) => {
    const d = await get<RawDepth>(`/price/v2/depth?symbol=${s}&limit=${opts.depthLimit ?? 1000}`).catch(() => ({ bids: [], asks: [] }) as RawDepth);
    tick(`depth ${s}`);
    return [s, d] as const;
  });
  const closes: Record<string, [number, number][]> = {};
  if (opts.withCandles !== false) {
    await pool(symbols, 6, async (s) => {
      const k = await get<unknown[][]>(`/price/v2/klines?symbol=${s}&interval=1h&limit=168`).catch(() => []);
      closes[s] = k.map((row) => [Number(row[0]), Number(row[4])]);
      tick(`candles ${s}`);
    });
  }
  return {
    fetchedAt,
    source: base,
    markets: marketsRes.markets,
    positions: livePos.positions ?? [],
    depth: Object.fromEntries(depthRows),
    marketStats: stats.data ?? [],
    treasury,
    fearGreed: fearGreed?.data,
    vaults: (vaults.vaults ?? []).map((v) => ({ vault_id: v.vault_id, type: v.type, name: v.name, equity: v.equity })),
    takerRate: feeTiers?.feeTiers?.find((t) => t.Tier === 0)?.TakerRate ?? 0.0005,
    closes,
  };
}

const num = (x: string | number | undefined, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
};

export function latestTreasuryUsd(t: RawSnapshot["treasury"]): number {
  if (!t?.data?.length) return 0;
  const last = Math.max(...t.data.map((r) => r[0]));
  return t.data.filter((r) => r[0] === last).reduce((s, r) => s + num(r[2]), 0);
}

/** OLS beta of hourly log returns of each market against the leader. */
export function estimateBetas(closes: RawSnapshot["closes"], leader = "BTC-USD"): Record<string, number> {
  const ref = new Map(closes[leader] ?? []);
  const out: Record<string, number> = {};
  for (const [s, rows] of Object.entries(closes)) {
    const pairs: [number, number][] = [];
    for (let i = 1; i < rows.length; i++) {
      const [t0, c0] = rows[i - 1];
      const [t1, c1] = rows[i];
      const r0 = ref.get(t0);
      const r1 = ref.get(t1);
      if (!(c0 > 0 && c1 > 0 && r0 && r1)) continue;
      pairs.push([Math.log(c1 / c0), Math.log(r1 / r0)]);
    }
    if (pairs.length < 24) continue;
    const mx = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
    const my = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
    let cov = 0;
    let varx = 0;
    for (const [y, x] of pairs) {
      cov += (x - mx) * (y - my);
      varx += (x - mx) ** 2;
    }
    out[s] = varx > 0 ? cov / varx : 1;
  }
  out[leader] = 1;
  return out;
}

export interface NormalizedSnapshot extends Snapshot {
  betas: Record<string, number>;
  raw: RawSnapshot;
}

export function normalizeSnapshot(raw: RawSnapshot): NormalizedSnapshot {
  const stats = new Map(raw.marketStats.map((s) => [s.symbol, s]));
  const markets: Record<string, Market> = {};
  for (const [s, m] of Object.entries(raw.markets)) {
    if (m.status !== "trading") continue;
    const st = stats.get(s);
    markets[s] = {
      symbol: s,
      name: m.name ?? s,
      category: st?.subCategory || st?.category || "Crypto",
      tiers: normalizeTiers(m.margin_tiers),
      tick: num(m.order_tick_price, 0.01),
      step: num(m.order_limit_step_size, 0.001),
      liqFeeRate: num(m.liquidation_fee_rate, 0.01),
      liqRetention: num(m.liquidation_fee_retention_factor, 0.4),
      mark: num(m.mark_price),
      index: num(m.index_price) || num(m.mark_price),
      last: num(m.last_price) || num(m.mark_price),
      fundingRate: num(m.funding_rate),
      nextFundingTime: num(m.next_funding_time),
      impactNotional: num(m.impact_notional, 1000),
      quotePrec: m.quote_prec,
    };
  }
  const books: Record<string, Book> = {};
  for (const [s, d] of Object.entries(raw.depth)) {
    books[s] = {
      bids: (d.bids ?? []).map(([p, q]) => [num(p), num(q)] as [number, number]).filter(([p, q]) => p > 0 && q > 0),
      asks: (d.asks ?? []).map(([p, q]) => [num(p), num(q)] as [number, number]).filter(([p, q]) => p > 0 && q > 0),
    };
  }
  const byKey = new Map<string, Account>();
  for (const p of raw.positions) {
    if (!markets[p.symbol]) continue;
    const key = p.vault_id ? `vault:${p.vault_id}` : p.account_id;
    let a = byKey.get(key);
    if (!a) {
      a = { key, accountId: p.account_id, address: p.blockchain_address, vaultId: p.vault_id, crossBalance: num(p.cross_balance), positions: [] };
      byKey.set(key, a);
    }
    const pos: Position = {
      id: p.id,
      accountKey: key,
      accountId: p.account_id,
      address: p.blockchain_address,
      vaultId: p.vault_id,
      symbol: p.symbol,
      mode: p.margin_mode,
      leverage: p.leverage,
      size: num(p.size),
      entry: num(p.entry_price),
      isoBalance: p.margin_mode === "isolated" ? num(p.isolated_margin) : 0,
      createdAt: p.create_timestamp,
      servedLiq: num(p.liquidation_price),
      servedMark: num(p.mark_price),
    };
    a.positions.push(pos);
  }
  return {
    fetchedAt: raw.fetchedAt,
    source: raw.source,
    markets,
    accounts: [...byKey.values()],
    books,
    takerRate: raw.takerRate,
    treasuryUsd: latestTreasuryUsd(raw.treasury),
    slpEquity: num((raw.vaults ?? []).find((v) => v.type === "protocol")?.equity),
    fearGreed: raw.fearGreed,
    betas: estimateBetas(raw.closes),
    raw,
  };
}

export async function loadSnapshot(opts: LoadOptions = {}): Promise<NormalizedSnapshot> {
  return normalizeSnapshot(await fetchRawSnapshot(opts));
}
