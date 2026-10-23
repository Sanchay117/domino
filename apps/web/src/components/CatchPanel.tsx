import { catchPlan, type CatchPlan, type NormalizedSnapshot, type RestingOrder, type Scenario, type SimParams } from "@domino/engine";
import { useEffect, useState } from "react";
import { base, pct, price, size, usdShort } from "../format.ts";

interface Props {
  snap: NormalizedSnapshot;
  scenario: Scenario;
  params: SimParams;
  symbol: string;
  applied: boolean;
  onApply: (orders: RestingOrder[] | null) => void;
}

/**
 * Where would resting liquidity have absorbed this cascade? Prices post-only orders at the IOC limits
 * the book could not fill, and lets the user replay the whole scenario with them in the book.
 */
export default function CatchPanel({ snap, scenario, params, symbol, applied, onApply }: Props) {
  const [budget, setBudget] = useState(10_000);
  const [plan, setPlan] = useState<CatchPlan | null | undefined>(undefined);
  const shock = scenario.shocks[symbol] ?? 0;

  useEffect(() => {
    setPlan(undefined);
    const id = setTimeout(() => {
      const { resting: _resting, recordBooks: _books, ...plain } = params;
      setPlan(shock ? catchPlan(snap, symbol, shock, budget, () => scenario, { params: plain }) : null);
    }, 150);
    return () => clearTimeout(id);
  }, [snap, scenario, params, symbol, shock, budget]);

  const sym = base(symbol);
  const m = snap.markets[symbol];
  const cli = `npm run guardian -- catch --symbol ${symbol} --shock ${shock > 0 ? "+" : ""}${Math.round(Math.abs(shock) * 100)} --budget ${budget}`;

  return (
    <div className="panel">
      <h2>Catch the {sym} cascade</h2>
      <p className="sub">
        Post-only {shock < 0 ? "bids" : "asks"} priced at the liquidation IOC limits the book could not fill, so that flow clears through the book instead
        of the SLP.
      </p>
      <label className="field">
        <span>
          Liquidity budget <b className="num">{usdShort(budget)}</b>
        </span>
        <input type="range" min={1000} max={100_000} step={1000} value={budget} onChange={(e) => {
            if (applied) onApply(null);
            setBudget(Number(e.target.value));
          }}
        />
      </label>
      {plan === undefined && <div className="muted">Replaying with and without the orders…</div>}
      {plan === null && <div className="muted">{sym} does not move in this scenario.</div>}
      {plan && plan.orders.length === 0 && (
        <div className="callout mint">
          Every {sym} liquidation IOC found liquidity at its limit. Any SLP flow here comes from accounts that gap straight past bankruptcy, which resting
          orders cannot help.
        </div>
      )}
      {plan && plan.orders.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th className="r">{plan.side === "bid" ? "Bid" : "Ask"}</th>
                <th className="r">Size</th>
                <th className="r">USD</th>
                <th className="r">vs mark</th>
              </tr>
            </thead>
            <tbody>
              {plan.orders.map((o) => (
                <tr key={o.price}>
                  <td className="r num">{price(o.price)}</td>
                  <td className="r num">{size(o.size)}</td>
                  <td className="r num">{usdShort(o.price * o.size)}</td>
                  <td className="r num dim">{pct(o.price / m.mark - 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.cushion > 0 && (
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              Priced {(plan.cushion * 100).toFixed(2)}% beyond the IOC limits: the new depth moves the mark, and with it the limits.
            </div>
          )}
          <div className="callout" style={{ marginTop: 12 }}>
            SLP absorbs <b className="amber">{usdShort(plan.before.insuranceNotional)}</b> → <b className="amber">{usdShort(plan.after.insuranceNotional)}</b>{" "}
            <span className="mint">({usdShort(plan.after.insuranceNotional - plan.before.insuranceNotional)})</span>. Your orders fill {size(plan.filled.qty)}{" "}
            {sym} ({usdShort(plan.filled.notional)}), {usdShort(plan.discount)} {plan.side === "bid" ? "below" : "above"} mark; PnL at the scenario's end{" "}
            <span className={plan.pnlAtEnd >= 0 ? "mint" : "red"}>{usdShort(plan.pnlAtEnd)}</span>.
          </div>
          <button
            className={`btn ${applied ? "" : "primary"}`}
            style={{ marginTop: 12, width: "100%" }}
            onClick={() => onApply(applied ? null : plan.orders.map((o) => ({ symbol, side: plan.side, price: o.price, size: o.size, tag: "catch" })))}
          >
            {applied ? "Remove orders from the replay" : "Replay with these orders in the book"}
          </button>
          <pre className="code wrap" style={{ marginTop: 12 }}>
            {cli}
          </pre>
        </>
      )}
    </div>
  );
}
