import type { SimEvent } from "@domino/engine";
import { base, price, shortAddr, size, usdShort } from "../format.ts";
import { go } from "../router.ts";

const LABEL: Record<SimEvent["kind"], string> = { liquidation: "liq IOC", no_fill: "no fill", insurance: "SLP", adl: "ADL", uncovered: "uncovered" };

function describe(e: SimEvent) {
  const query = e.address || e.accountKey.replace(/^vault:/, "");
  const who = query ? (
    <a href="#" onClick={(ev) => (ev.preventDefault(), go("xray", { q: query }))} className="dim" style={{ textDecoration: "none" }}>
      {e.address ? shortAddr(e.address) : "vault"}
    </a>
  ) : null;
  const sym = base(e.symbol);
  switch (e.kind) {
    case "liquidation":
      return (
        <>
          {e.side.toUpperCase()} {size(e.size)} {sym} sold into the book @ {price(e.price)} · attempt {e.attempt} · {Math.round((100 * e.size) / (e.requested || e.size))}% filled ·{" "}
          {usdShort(e.notional)} {who}
        </>
      );
    case "no_fill":
      return (
        <>
          {e.side.toUpperCase()} {size(e.requested ?? 0)} {sym} IOC found no liquidity above {price(e.price)} · attempt {e.attempt} {who}
        </>
      );
    case "insurance":
      return (
        <>
          {e.side.toUpperCase()} {size(e.size)} {sym} → SLP @ {price(e.price)} ({e.reason === "bankrupt" ? "bankrupt" : "after attempt 5"}) · {usdShort(e.notional)} {who}
        </>
      );
    case "adl":
      return (
        <>
          #{e.rank} winning {e.side} {size(e.size)} {sym} force-closed @ {price(e.price)} · {usdShort(e.notional)} {who}
        </>
      );
    case "uncovered":
      return (
        <>
          {size(e.size)} {sym} left uncovered after SLP and ADL · {usdShort(e.notional)}
        </>
      );
  }
}

export default function EventFeed({ events, t, symbol }: { events: SimEvent[]; t: number; symbol?: string }) {
  const shown = events.filter((e) => e.t <= t && (!symbol || e.symbol === symbol));
  const rows = shown.slice(-250).reverse();
  return (
    <div className="feed">
      {rows.length === 0 && <div className="muted" style={{ padding: "8px 2px" }}>No liquidations yet. Every position is still above maintenance.</div>}
      {rows.map((e, i) => (
        <div key={`${e.t}-${e.positionId}-${e.kind}-${i}`} className="row">
          <span className="dim">t+{e.t}s</span>
          <span className={`kind ${e.kind}`}>{LABEL[e.kind]}</span>
          <span>{describe(e)}</span>
        </div>
      ))}
    </div>
  );
}
