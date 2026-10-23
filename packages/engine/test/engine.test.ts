import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adlQueue,
  attemptSize,
  classify,
  correlatedScenario,
  crossProfile,
  generateApiWallet,
  impactPrice,
  iocLimit,
  markPrice,
  neutralPrice,
  normalizeSnapshot,
  normalizeTiers,
  signatureMessage,
  signRequest,
  simulate,
  singleScenario,
  validateAgainstServed,
  verifyRequest,
  type Account,
  type Market,
  type RawSnapshot,
} from "../src/index.ts";

const fixture = fileURLToPath(new URL("../../../fixtures/snapshot.json", import.meta.url));
const snap = normalizeSnapshot(JSON.parse(readFileSync(fixture, "utf8")) as RawSnapshot);

describe("documented worked examples (docs.strikefinance.org)", () => {
  it("partial liquidation: 1 BTC at $50,000 and 125% margin ratio asks for 0.5 BTC", () => {
    expect(attemptSize(1, 1.25, 50_000, 1, 0.00001)).toBeCloseTo(0.5, 10);
  });

  it("attempt fractions scale 20% → 100% with margin ratio, attempt 5 closes everything", () => {
    expect(attemptSize(10, 1.0, 50_000, 1, 0.00001)).toBeCloseTo(0.1 + 2, 8);
    expect(attemptSize(10, 1.75, 50_000, 2, 0.00001)).toBeCloseTo(0.1 + 8, 8);
    expect(attemptSize(10, 2.5, 50_000, 3, 0.00001)).toBe(10);
    expect(attemptSize(10, 1.0, 50_000, 5, 0.00001)).toBe(10);
  });

  it("impact price: $1,000 buy over 4 @ 100 and 10 @ 102 fills at ≈101.19047619", () => {
    expect(impactPrice([[100, 4], [102, 10]], 1000)).toBeCloseTo(101.19047619, 7);
    expect(impactPrice([[100, 4]], 1000)).toBe(0); // side cannot fill → caller falls back to index
  });

  it("P1 funding adjustment: X = 20,000, F = 0.01%/h, 30 min left → 20,001", () => {
    const r = markPrice({ index: 20_000, fundingRate: 0.0001, hourRemaining: 0.5, basis: [], bestBid: 19_999, bestAsk: 20_002, last: 20_001 });
    expect(r.p1).toBeCloseTo(20_001, 8);
  });

  it("order-book sweep: clearing the asks moves P3 by 12% but the mark stays at ≈100.005", () => {
    const basis = [...Array(59).fill(0), -0.05];
    const r = markPrice({ index: 100, fundingRate: 0.0001, hourRemaining: 0.5, basis, bestBid: 99.95, bestAsk: 0, last: 112 });
    expect(r.p2).toBeCloseTo(99.999, 3);
    expect(r.p3).toBe(112);
    expect(r.mark).toBeCloseTo(100.005, 6);
  });

  it("final deviation check falls back to P2 when the candidate is >5% from index", () => {
    const r = markPrice({ index: 100, fundingRate: 0, hourRemaining: 0.5, basis: [10], bestBid: 109, bestAsk: 111, last: 110 });
    expect(r.usedFallback).toBe(true);
    expect(r.mark).toBeCloseTo(110, 8);
  });

  it("maintenance amounts are derived for tier continuity", () => {
    const tiers = normalizeTiers(snap.raw.markets["AAOI-USD"].margin_tiers);
    expect(tiers[2].ma).toBeCloseTo(830, 6);
    expect(tiers[4].ma).toBeCloseTo(9180, 6);
  });
});

describe("liquidation mechanics", () => {
  const market: Market = {
    symbol: "TEST-USD",
    name: "Test",
    category: "Crypto",
    tiers: normalizeTiers([
      { max_notional: "100000", max_leverage: 20, maintenance_margin_rate: "0.025", maintenance_amount: "0" },
      { max_notional: "1000000", max_leverage: 10, maintenance_margin_rate: "0.05", maintenance_amount: "0" },
    ]),
    tick: 0.01,
    step: 0.001,
    liqFeeRate: 0.01,
    liqRetention: 0.4,
    mark: 100,
    index: 100,
    last: 100,
    fundingRate: 0,
    nextFundingTime: 0,
    impactNotional: 1000,
    quotePrec: 8,
  };

  it("a fee-free fill at the neutral price preserves a cross profile's margin ratio", () => {
    const account: Account = { key: "a", accountId: "a", address: "", vaultId: "", crossBalance: 0, positions: [] };
    account.positions.push({ id: 1, accountKey: "a", accountId: "a", address: "", vaultId: "", symbol: "TEST-USD", mode: "cross", leverage: 20, size: 3000, entry: 110, isoBalance: 0, createdAt: 0, servedLiq: 0, servedMark: 0 });
    // Pick a balance that puts the profile at a 120% margin ratio at mark 100.
    const notional = 3000 * 100;
    const mm = notional * 0.05 - market.tiers[1].ma;
    const upnl = (100 - 110) * 3000;
    account.crossBalance = mm / 1.2 - upnl;
    const markets = { "TEST-USD": market };
    const before = crossProfile(account, { "TEST-USD": 100 }, markets)!;
    expect(before.ratio).toBeCloseTo(1.2, 10);
    const q = attemptSize(3000, before.ratio, 100, 1, market.step);
    const np = neutralPrice(market.tiers, 3000, q, 100, before.ratio);
    expect(np).toBeLessThan(100);
    account.crossBalance += (np - 110) * q;
    account.positions[0].size -= q;
    const after = crossProfile(account, { "TEST-USD": 100 }, markets)!;
    expect(after.ratio).toBeCloseTo(before.ratio, 9);
  });

  it("IOC limits include taker commission and align to tick away from the trader", () => {
    expect(iocLimit(99.123, 1, 0.0005, 0.01)).toBeCloseTo(99.18, 10); // 99.1726 → up
    expect(iocLimit(100.877, -1, 0.0005, 0.01)).toBeCloseTo(100.82, 10); // 100.8266 → down
  });

  it("risk levels follow the documented thresholds", () => {
    expect(classify(100, 0, 50).level).toBe("none");
    expect(classify(100, 0, 75).level).toBe("margin_call");
    expect(classify(100, 0, 95).level).toBe("reduce_only");
    expect(classify(100, 0, 100).level).toBe("liquidate");
    expect(classify(100, -120, 10).level).toBe("bankrupt");
  });
});

describe("live mainnet snapshot", () => {
  it("reproduces every liquidation price Strike serves", () => {
    const v = validateAgainstServed(snap);
    expect(v.total).toBeGreaterThan(100);
    expect(v.matched).toBe(v.total);
  });

  it("a flat market liquidates nobody", () => {
    const r = simulate(snap, { name: "flat", shocks: {}, rampSec: 30, holdSec: 30, shape: "linear" });
    expect(r.events).toHaveLength(0);
  });

  it("conserves size: every closed unit is liquidated, backstopped or deleveraged", () => {
    const r = simulate(snap, correlatedScenario(snap, -0.25), { insuranceFund: 20_000, ifNotionalMultiple: 0.5 });
    for (const f of r.fates) expect(f.initialSize - f.finalSize).toBeCloseTo(f.liquidated + f.backstopped + f.deleveraged, 6);
    expect(r.totals.adlNotional).toBeGreaterThan(0); // a small backstop forces Type 1 ADL
  });

  it("a deeper crash never liquidates less", () => {
    const sizes = [-0.05, -0.1, -0.2].map((s) => {
      const t = simulate(snap, singleScenario("BTC-USD", s)).totals;
      return t.liquidatedNotional + t.insuranceNotional + t.adlNotional;
    });
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[0]);
    expect(sizes[2]).toBeGreaterThanOrEqual(sizes[1]);
  });

  it("ADL queue ranks profitable positions by profit % × effective leverage", () => {
    const q = adlQueue(snap, "ADA-USD", "short");
    for (let i = 1; i < q.length; i++) expect(q[i - 1].score).toBeGreaterThanOrEqual(q[i].score);
  });
});

describe("API wallet signing", () => {
  it("hashes an empty body as SHA-256 of empty input", () => {
    expect(signatureMessage("GET", "/v2/account", 1704067200, "550e8400-e29b-41d4-a716-446655440000")).toBe(
      "GET:/v2/account:1704067200:550e8400-e29b-41d4-a716-446655440000:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces headers that verify against the public key", () => {
    const w = generateApiWallet();
    expect(w.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.stringify({ symbol: "BTC-USD", side: "sell", type: "market", size: "0.001", reduce_only: true });
    const h = signRequest(w, "POST", "/v2/order", body, 1704067200, "550e8400-e29b-41d4-a716-446655440000");
    expect(h["X-API-Wallet-Signature"]).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyRequest(w.publicKeyHex, h, "POST", "/v2/order", body)).toBe(true);
    expect(verifyRequest(w.publicKeyHex, h, "POST", "/v2/order", body + " ")).toBe(false);
  });
});
