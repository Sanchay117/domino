import type { MarketRisk } from "@domino/engine";
import { useState } from "react";
import { base, pct, usdShort } from "../format.ts";

type Key = "oi" | "nearestLong" | "nearestShort" | "longLiqUsd10" | "cover" | "beta" | "positions";

const cover = (r: MarketRisk) => (r.longLiqUsd10 > 0 ? r.bidDepth10 / r.longLiqUsd10 : Infinity);
const dist = (d: number | null) => (d === null ? "—" : Math.abs(d) > 5 ? (d > 0 ? ">+500%" : "<−500%") : pct(d));

export default function MarketTable({ rows, onPick }: { rows: MarketRisk[]; onPick: (symbol: string) => void }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "oi", dir: -1 });
  const val = (r: MarketRisk, k: Key): number => {
    switch (k) {
      case "oi":
        return r.longUsd + r.shortUsd;
      case "nearestLong":
        return r.nearestLong === null ? -Infinity : r.nearestLong;
      case "nearestShort":
        return r.nearestShort === null ? Infinity : -r.nearestShort;
      case "cover":
        return -cover(r);
      default:
        return r[k];
    }
  };
  const sorted = [...rows].sort((a, b) => sort.dir * (val(a, sort.key) - val(b, sort.key)));
  const th = (k: Key, label: string, title?: string) => (
    <th className="sortable r" title={title} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : -1 }))}>
      {label}
      {sort.key === k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Market</th>
            {th("oi", "Open interest")}
            <th title="Number of long vs short positions">Longs / shorts</th>
            {th("positions", "Positions")}
            {th("nearestLong", "Next long liq", "Mark move that liquidates the first long")}
            {th("nearestShort", "Next short liq", "Mark move that liquidates the first short")}
            {th("longLiqUsd10", "Longs liq ≤10%", "Long notional whose liquidation price is within 10% of mark")}
            <th className="r" title="Resting bid depth within 10% of mark">
              Bids ≤10%
            </th>
            {th("cover", "Cover", "Bid depth ÷ long liquidations within 10%")}
            {th("beta", "β to BTC", "OLS beta of hourly returns vs BTC over 7 days, from Strike candles")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const oi = r.longUsd + r.shortUsd;
            const c = cover(r);
            return (
              <tr key={r.symbol} className="click" onClick={() => onPick(r.symbol)}>
                <td>
                  <b>{base(r.symbol)}</b> <span className="dim">{r.category !== "Crypto" ? r.category : ""}</span>
                </td>
                <td className="r num">{usdShort(oi)}</td>
                <td>
                  {/* Long and short notional always net out on a perp venue, so crowding is shown by position count. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`${r.longs} long positions / ${r.shorts} short positions`}>
                    <div className="skew">
                      <i style={{ width: `${r.positions ? (100 * r.longs) / r.positions : 50}%`, background: "var(--mint)" }} />
                      <i style={{ flex: 1, background: "var(--red)" }} />
                    </div>
                    <span className="num dim" style={{ fontSize: 11.5 }}>
                      {r.longs}/{r.shorts}
                    </span>
                  </div>
                </td>
                <td className="r num">{r.positions}</td>
                <td className={`r num ${r.nearestLong !== null && r.nearestLong > -0.03 ? "red" : ""}`}>{dist(r.nearestLong)}</td>
                <td className={`r num ${r.nearestShort !== null && r.nearestShort < 0.03 ? "red" : ""}`}>{dist(r.nearestShort)}</td>
                <td className="r num">{r.longLiqUsd10 ? usdShort(r.longLiqUsd10) : "—"}</td>
                <td className="r num">{usdShort(r.bidDepth10)}</td>
                <td className={`r num ${c < 1 ? "red" : c < 3 ? "amber" : "mint"}`}>{Number.isFinite(c) ? `${c.toFixed(1)}×` : "∞"}</td>
                <td className="r num">{r.beta.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
