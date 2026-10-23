// Raw shapes served by the Strike API, and the normalized shapes the engine works with.

export interface RawMarginTier {
  max_notional: string;
  max_leverage: number;
  maintenance_margin_rate: string;
  maintenance_amount: string;
}

/** One entry of `GET /v2/markets` → `markets[symbol]`. */
export interface RawMarket {
  symbol: string;
  name?: string;
  base_asset?: string;
  status: string;
  quote_prec: number;
  default_leverage?: number;
  margin_tiers: RawMarginTier[];
  order_tick_price: string;
  order_limit_step_size: string;
  order_limit_min_size?: string;
  liquidation_fee_rate: string;
  liquidation_fee_retention_factor: string;
  mark_price: string;
  index_price: string;
  last_price?: string;
  bid1_price?: string;
  ask1_price?: string;
  funding_rate?: string;
  next_funding_time?: number;
  impact_notional?: string;
}

/** One entry of `GET /stat/v1/stats/live-positions` → `positions[]`. */
export interface RawLivePosition {
  id: number;
  create_timestamp: number;
  account_id: string;
  blockchain_address: string;
  vault_id: string;
  symbol: string;
  margin_mode: "cross" | "isolated";
  leverage: number;
  size: string;
  entry_price: string;
  mark_price: string;
  margin: string;
  isolated_margin: string;
  cross_balance: string;
  accumulated_funding_fees: string;
  liquidation_price: string;
}

/** `GET /price/v2/depth` */
export interface RawDepth {
  lastUpdateId?: number;
  E?: number;
  T?: number;
  bids: [string, string][];
  asks: [string, string][];
}

/** One entry of `GET /price/v2/marketStats` → `data[]`. */
export interface RawMarketStat {
  symbol: string;
  category: string;
  subCategory: string;
  assetName: string;
  active: boolean;
  status: string;
  marketStats: {
    volume24h: string;
    priceChangePercentage24h: string;
    lastPrice: string;
    markPrice: string;
    indexPrice: string;
    fundingRate: string;
    openInterest: string;
  };
}

export interface Tier {
  maxNotional: number;
  maxLeverage: number;
  mmr: number;
  /** Maintenance amount, derived the way the engine does: MA[i] = MA[i-1] + maxNotional[i-1] * (MMR[i] - MMR[i-1]). */
  ma: number;
}

export interface Market {
  symbol: string;
  name: string;
  category: string;
  tiers: Tier[];
  tick: number;
  step: number;
  liqFeeRate: number;
  liqRetention: number;
  mark: number;
  index: number;
  last: number;
  fundingRate: number;
  nextFundingTime: number;
  impactNotional: number;
  quotePrec: number;
}

export type MarginMode = "cross" | "isolated";

export interface Position {
  id: number;
  /** account_id + vault_id; vault accounts are separate margin accounts. */
  accountKey: string;
  accountId: string;
  address: string;
  vaultId: string;
  symbol: string;
  mode: MarginMode;
  leverage: number;
  /** Signed base size: + long, − short. */
  size: number;
  entry: number;
  /** iso_balance for isolated positions, 0 for cross. */
  isoBalance: number;
  createdAt: number;
  /** Strike's served liquidation price and the mark it was computed at (used for validation). */
  servedLiq: number;
  servedMark: number;
}

export interface Account {
  key: string;
  accountId: string;
  address: string;
  vaultId: string;
  /** Cross profile base balance W = wallet − Σ iso_balance (served as cross_balance). */
  crossBalance: number;
  positions: Position[];
}

/** A price level: [price, base quantity]. */
export type Level = [number, number];

export interface Book {
  bids: Level[]; // high → low
  asks: Level[]; // low → high
}

export interface Snapshot {
  fetchedAt: number;
  source: string;
  markets: Record<string, Market>;
  accounts: Account[];
  books: Record<string, Book>;
  /** Taker commission rate used for liquidation IOCs (fee tier 0 unless overridden). */
  takerRate: number;
  /** Protocol treasury holdings in USD (latest `/stat/v1/dashboard/treasury` sum). */
  treasuryUsd: number;
  /** Equity of the protocol SLP vault, which receives liquidation fees and backs the Insurance Fund. */
  slpEquity: number;
  fearGreed?: { value: number; classification: string };
}
