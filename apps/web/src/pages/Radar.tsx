import { distressedAtSnapshot, marketRisks, positionRisks, validateAgainstServed, type NormalizedSnapshot } from "@domino/engine";
import { useMemo } from "react";
import MarketTable from "../components/MarketTable.tsx";
import StressCurve from "../components/StressCurve.tsx";
import { useStressCurve } from "../components/useStressCurve.ts";
import { accountLabel, accountQuery, base, pct, usdShort } from "../format.ts";
import { go } from "../router.ts";

const RANGE = 0.4;
const SHOCKS = Array.from({ length: 20 }, (_, i) => -RANGE + i * 0.04).filter((s) => Math.abs(s) > 1e-9).concat([RANGE]);

export default function Radar({ snap }: { snap: NormalizedSnapshot }) {
  const risks = useMemo(() => positionRisks(snap), [snap]);
  const markets = useMemo(() => marketRisks(snap, risks).filter((m) => m.positions > 0), [snap, risks]);
  const validation = useMemo(() => validateAgainstServed(snap), [snap]);
  const distressed = useMemo(() => distressedAtSnapshot(snap, risks), [snap, risks]);
  const curve = useStressCurve(snap, SHOCKS);

  const oi = risks.reduce((s, r) => s + r.notional, 0);
  const within5 = risks.filter((r) => r.liqDistance !== null && Math.abs(r.liqDistance) <= 0.05 && r.level !== "bankrupt").reduce((s, r) => s + r.notional, 0);
  const fragile = [...markets].filter((m) => m.longLiqUsd10 > 5000).sort((a, b) => a.bidDepth10 / a.longLiqUsd10 - b.bidDepth10 / b.longLiqUsd10)[0];
  const closest = [...markets].filter((m) => m.nearestLong !== null).sort((a, b) => (b.nearestLong ?? -1) - (a.nearestLong ?? -1))[0];
  const whale = [...snap.accounts]
    .map((a) => ({ a, n: risks.filter((r) => r.account.key === a.key).reduce((s, r) => s + r.notional, 0) }))
    .sort((x, y) => y.n - x.n)[0];

  const p20 = curve.points.find((p) => Math.abs(p.shock + 0.2) < 1e-9);
  const firstSlp = [...curve.points].filter((p) => p.shock < 0 && p.result.insuranceNotional > 1000).sort((a, b) => b.shock - a.shock)[0];
  const firstAdl = [...curve.points].filter((p) => p.result.adlNotional > 0).sort((a, b) => Math.abs(a.shock) - Math.abs(b.shock))[0];

  return (
    <>
      <div className="hero">
        <div>
          <h1>How hard can Strike fall?</h1>
          <p>
            Domino replays Strike's own liquidation engine (staged partial IOCs, neutral-price bounds, the SLP backstop and auto-deleveraging) against every
            live position and the real order book, so you can see the cascade before the market shows it to you.
          </p>
        </div>
        <span className={`badge ${validation.matched === validation.total ? "ok" : "warn"}`} title="Liquidation prices recomputed from public data vs. the values Strike serves">
          ✓ {validation.matched}/{validation.total} live liquidation prices reproduced exactly
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Open interest</div>
          <div className="value">{usdShort(oi)}</div>
          <div className="note">
            {risks.length} positions · {snap.accounts.length} accounts
          </div>
        </div>
        <div className="stat">
          <div className="label">Liquidates within 5%</div>
          <div className="value red">{usdShort(within5)}</div>
          <div className="note">notional, either direction</div>
        </div>
        <div className="stat">
          <div className="label">SLP backstop</div>
          <div className="value amber">{usdShort(snap.slpEquity)}</div>
          <div className="note">protocol vault equity</div>
        </div>
        <div className="stat">
          <div className="label">Fear &amp; Greed</div>
          <div className="value">{snap.fearGreed?.value ?? "—"}</div>
          <div className="note">{snap.fearGreed?.classification ?? ""}</div>
        </div>
        <div className="stat">
          <div className="label">Markets with positions</div>
          <div className="value">{markets.length}</div>
          <div className="note">{Object.keys(snap.markets).length} listed</div>
        </div>
      </div>

      <div className="grid cols-3-1" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2>Exchange stress curve</h2>
          <p className="sub">
            Each point is a full cascade replay: BTC moves by the x-axis amount over 3 minutes and every other market follows with its beta. Stacked:
            where the liquidated notional ends up. {curve.done ? "" : `Simulating ${curve.points.length}/${SHOCKS.length}…`}
          </p>
          <StressCurve points={curve.points} range={RANGE} height={390} onPick={(shock) => go("lab", { mode: "corr", symbol: "BTC-USD", shock: shock.toFixed(2) })} />
        </div>
        <div className="panel">
          <h2>What Domino sees right now</h2>
          <p className="sub">Auto-generated from the current snapshot.</p>
          <div className="grid" style={{ gap: 12 }}>
            {p20 && (
              <div className="callout mint">
                A <b>−20% BTC-led crash</b> hits <b>{p20.result.accountsHit} accounts</b>: {usdShort(p20.result.liquidatedNotional)} clears through the book and{" "}
                <span className="amber">{usdShort(p20.result.insuranceNotional)}</span> lands on the SLP
                {p20.result.adlNotional > 0 ? (
                  <>
                    , and <span className="violet">{usdShort(p20.result.adlNotional)}</span> is force-closed from winners via ADL
                  </>
                ) : (
                  <> with no ADL needed</>
                )}
                .
              </div>
            )}
            {firstSlp && (
              <div className="callout">
                The SLP backstop starts absorbing meaningful flow at a <b>{pct(firstSlp.shock, 0)}</b> crash: liquidation IOCs run out of resting bids above
                their neutral-price limit.
                {firstAdl ? ` ADL first appears at ${pct(firstAdl.shock, 0)}.` : " ADL never triggers within ±40% at current SLP limits."}
              </div>
            )}
            {fragile && (
              <div className="callout">
                <b>{base(fragile.symbol)}</b> is the thinnest cushion: {usdShort(fragile.longLiqUsd10)} of longs liquidate within 10% against{" "}
                {usdShort(fragile.bidDepth10)} of bids ({(fragile.bidDepth10 / fragile.longLiqUsd10).toFixed(1)}× cover).
                {closest && closest.symbol !== fragile.symbol && (
                  <>
                    {" "}
                    The closest liquidation is on <b>{base(closest.symbol)}</b>, {pct(closest.nearestLong ?? 0)} away.
                  </>
                )}
              </div>
            )}
            {distressed.length > 0 && (
              <div className="callout">
                Public data shows <b>{distressed.length} position{distressed.length > 1 ? "s" : ""}</b> already past maintenance or bankruptcy (
                {distressed.map((d) => `${base(d.pos.symbol)} ${d.side}`).join(", ")}). Domino freezes these so scenarios measure only the shock.
              </div>
            )}
            {whale && (
              <div className="callout mint" style={{ cursor: "pointer" }} onClick={() => go("xray", { q: accountQuery(whale.a) })}>
                Largest book: <span className="num">{accountLabel(whale.a, snap.raw.vaults)}</span> with {usdShort(whale.n)} across {whale.a.positions.length}{" "}
                positions.{" "}
                <span className="mint">X-ray it →</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Market risk radar</h2>
        <p className="sub">Liquidation distances come from Strike's exact margin-tier formulas. Click a market to crash it in the Cascade Lab.</p>
        <MarketTable rows={markets} onPick={(symbol) => go("lab", { mode: "single", symbol, shock: "-0.15" })} />
      </div>
    </>
  );
}
