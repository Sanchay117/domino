import {
  adlQueue,
  correlatedScenario,
  deriskPlan,
  findPositions,
  generateApiWallet,
  positionRisks,
  stepString,
  StrikeClient,
  survivalShock,
  type DeriskPlan,
  type NormalizedSnapshot,
  type PositionRisk,
} from "@domino/engine";
import { useEffect, useMemo, useState } from "react";
import { accountLabel, accountQuery, base, pct, price, size, usd, usdShort } from "../format.ts";
import { go } from "../router.ts";

export default function XRay({ snap, params }: { snap: NormalizedSnapshot; params: URLSearchParams }) {
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  const risks = useMemo(() => positionRisks(snap), [snap]);

  const suggestions = useMemo(() => {
    const byAcct = new Map<string, { label: string; query: string; n: number; nearest: number }>();
    for (const r of risks) {
      const a = byAcct.get(r.account.key) ?? { label: accountLabel(r.account, snap.raw.vaults), query: accountQuery(r.account), n: 0, nearest: 1 };
      a.n += r.notional;
      if (r.liqDistance !== null && r.level !== "bankrupt") a.nearest = Math.min(a.nearest, Math.abs(r.liqDistance));
      byAcct.set(r.account.key, a);
    }
    const all = [...byAcct.values()];
    const big = [...all].sort((a, b) => b.n - a.n).slice(0, 5);
    const close = [...all].filter((a) => a.n > 2000 && !big.includes(a)).sort((a, b) => a.nearest - b.nearest).slice(0, 3);
    return { big, close };
  }, [risks, snap]);

  const ids = useMemo(() => new Set(findPositions(snap, q).map((p) => p.id)), [snap, q]);
  const rows = risks.filter((r) => ids.has(r.pos.id));
  const accounts = [...new Map(rows.map((r) => [r.account.key, r.account])).values()];

  return (
    <>
      <div className="hero">
        <div>
          <h1>Position X-Ray</h1>
          <p>
            Paste any Strike wallet address or account id. Domino shows where each position liquidates, how far the market has to move before a{" "}
            <i>cascade</i> reaches it (which can be sooner than the static liquidation price suggests), where it sits in the ADL queue, and the smallest
            reduce-only order that keeps it alive.
          </p>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            go("xray", { q: input.trim() });
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="addr1… / 0x… / account id" spellCheck={false} />
          <button className="btn primary" type="submit">
            X-ray
          </button>
        </form>
        <div className="chips">
          <span className="dim" style={{ fontSize: 12, alignSelf: "center" }}>
            Largest books:
          </span>
          {suggestions.big.map((s) => (
            <button key={s.query} className="chip" onClick={() => go("xray", { q: s.query })}>
              {s.label} · {usdShort(s.n)}
            </button>
          ))}
          <span className="dim" style={{ fontSize: 12, alignSelf: "center", marginLeft: 8 }}>
            Closest to liquidation:
          </span>
          {suggestions.close.map((s) => (
            <button key={s.query} className="chip" onClick={() => go("xray", { q: s.query })}>
              {s.label} · {pct(-s.nearest)}
            </button>
          ))}
        </div>
      </div>

      {q && rows.length === 0 && <div className="panel muted">No open positions found for that address or account in the current snapshot.</div>}
      {accounts.map((a) => (
        <AccountCard key={a.key} snap={snap} rows={rows.filter((r) => r.account.key === a.key)} risks={risks} />
      ))}
    </>
  );
}

function AccountCard({ snap, rows, risks }: { snap: NormalizedSnapshot; rows: PositionRisk[]; risks: PositionRisk[] }) {
  const account = rows[0].account;
  const cross = rows.find((r) => r.pos.mode === "cross")?.profile;
  const [survival, setSurvival] = useState<Record<number, number | null | undefined>>({});
  const [selected, setSelected] = useState<number>(rows[0].pos.id);

  useEffect(() => {
    let cancelled = false;
    setSurvival({});
    const queue = rows.map((r) => r.pos);
    let i = 0;
    const next = () => {
      if (cancelled || i >= queue.length) return;
      const pos = queue[i++];
      const s = survivalShock(snap, pos.id, (shock) => correlatedScenario(snap, shock, pos.symbol));
      setSurvival((m) => ({ ...m, [pos.id]: s }));
      setTimeout(next, 0);
    };
    const id = setTimeout(next, 50);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, account.key]);

  const adlRank = (r: PositionRisk) => {
    if (r.upnl <= 0) return null;
    const qd = adlQueue(snap, r.pos.symbol, r.side, risks);
    const e = qd.find((x) => x.pos.id === r.pos.id);
    return e ? { rank: e.rank, of: qd.length } : null;
  };

  const sel = rows.find((r) => r.pos.id === selected) ?? rows[0];

  return (
    <div className="grid" style={{ marginBottom: 16 }}>
      <div className="stats" style={{ marginBottom: 0 }}>
        <div className="stat">
          <div className="label">{account.vaultId ? "Vault" : "Wallet"}</div>
          <div className="value num" style={{ fontSize: 14, wordBreak: "break-all" }} title={account.address || account.vaultId}>
            {accountLabel(account, snap.raw.vaults)}
          </div>
          <div className="note num">acct {account.accountId.slice(0, 13)}…</div>
        </div>
        <div className="stat">
          <div className="label">Cross base balance</div>
          <div className="value">{usd(account.crossBalance)}</div>
          <div className="note">wallet − isolated margin</div>
        </div>
        <div className="stat">
          <div className="label">Cross margin balance</div>
          <div className="value">{cross ? usd(cross.marginBalance) : "—"}</div>
          <div className="note">{cross ? `uPnL ${usd(cross.upnl)}` : "no cross positions"}</div>
        </div>
        <div className="stat">
          <div className="label">Margin ratio</div>
          <div className={`value ${cross && cross.ratio >= 0.7 ? "red" : ""}`}>{cross ? `${(cross.ratio * 100).toFixed(1)}%` : "—"}</div>
          <div className="note">liquidation at 100%</div>
        </div>
        <div className="stat">
          <div className="label">Notional</div>
          <div className="value">{usdShort(rows.reduce((s, r) => s + r.notional, 0))}</div>
          <div className="note">
            {rows.length} position{rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Positions</h2>
        <p className="sub">
          Cascade survival = the smallest move in that market (with every other market following by β) at which the replayed engine first touches the
          position. Click a row for its Guardian plan.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th className="r">Size</th>
                <th className="r">Notional</th>
                <th className="r">Entry</th>
                <th className="r">Mark</th>
                <th className="r">uPnL</th>
                <th className="r">Liq price</th>
                <th className="r">Static distance</th>
                <th className="r">Cascade survival</th>
                <th className="r">ADL queue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = survival[r.pos.id];
                const adl = adlRank(r);
                return (
                  <tr key={r.pos.id} className="click" onClick={() => setSelected(r.pos.id)} style={r.pos.id === sel.pos.id ? { background: "var(--panel-2)" } : undefined}>
                    <td>
                      <b>{base(r.pos.symbol)}</b> <span className="dim">{r.pos.mode}</span>
                    </td>
                    <td className={r.side === "long" ? "mint" : "red"}>{r.side}</td>
                    <td className="r num">{size(Math.abs(r.pos.size))}</td>
                    <td className="r num">{usdShort(r.notional)}</td>
                    <td className="r num">{price(r.pos.entry)}</td>
                    <td className="r num">{price(r.state.mark)}</td>
                    <td className={`r num ${r.upnl >= 0 ? "mint" : "red"}`}>{usd(r.upnl)}</td>
                    <td className="r num">{r.liq ? price(r.liq) : "none"}</td>
                    <td className="r num">{r.level === "bankrupt" ? <span className="red">past bankruptcy</span> : r.liqDistance === null ? "—" : pct(r.liqDistance)}</td>
                    <td className="r num">
                      {s === undefined ? <span className="dim">simulating…</span> : s === null ? <span className="mint">survives 60%</span> : <span className={s < 0.1 ? "red" : s < 0.2 ? "amber" : ""}>{pct(r.side === "long" ? -s : s)}</span>}
                    </td>
                    <td className="r num">{adl ? <span className={adl.rank <= 3 ? "violet" : ""}>#{adl.rank} of {adl.of}</span> : <span className="dim">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <GuardianPlan snap={snap} risk={sel} />
    </div>
  );
}

function GuardianPlan({ snap, risk }: { snap: NormalizedSnapshot; risk: PositionRisk }) {
  const [target, setTarget] = useState(0.15);
  const [plan, setPlan] = useState<DeriskPlan | null | undefined>(undefined);
  const wallet = useMemo(() => generateApiWallet(), []);
  useEffect(() => {
    setPlan(undefined);
    const id = setTimeout(() => setPlan(deriskPlan(snap, risk.pos.id, (shock) => correlatedScenario(snap, shock, risk.pos.symbol), target)), 60);
    return () => clearTimeout(id);
  }, [snap, risk.pos.id, risk.pos.symbol, target]);

  const reduce = plan && plan.reduceSize > 0 ? stepString(plan.reduceSize, snap.markets[risk.pos.symbol].step) : null;
  const prepared = useMemo(
    () =>
      reduce
        ? new StrikeClient(snap.source, wallet, { builderFeeBps: 5 }).placeOrderRequest({
            symbol: risk.pos.symbol,
            side: risk.side === "long" ? "sell" : "buy",
            type: "market",
            size: reduce,
            reduce_only: true,
          })
        : null,
    [reduce, risk.pos.symbol, risk.side, snap.source, wallet],
  );
  const cmd = `npm run guardian -- protect --address ${accountQuery(risk.account)} --symbol ${risk.pos.symbol} --survive ${Math.round(target * 100)}`;

  return (
    <div className="grid cols-2">
      <div className="panel">
        <h2>
          Guardian plan · {base(risk.pos.symbol)} {risk.side}
        </h2>
        <p className="sub">The smallest reduce-only order after which the replayed cascade no longer reaches this position.</p>
        <label className="field">
          <span>
            Survive a cascade of <b className="num">{pct(risk.side === "long" ? -target : target, 0)}</b> in {base(risk.pos.symbol)} (market-wide by β)
          </span>
          <input type="range" min={0.03} max={0.5} step={0.01} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
        </label>
        {plan === undefined && <div className="muted">Searching reduction size…</div>}
        {plan === null && <div className="muted">Position not found.</div>}
        {plan && plan.survivesWithoutAction && (
          <div className="callout mint">
            Already safe: this position survives a {pct(risk.side === "long" ? -target : target, 0)} cascade without any change. Guardian would stay idle.
          </div>
        )}
        {plan && !plan.survivesWithoutAction && (
          <div className="callout">
            Reduce by <b className="num">{size(plan.reduceSize)}</b> {base(risk.pos.symbol)} (<b>{(plan.reduceFraction * 100).toFixed(1)}%</b>, about{" "}
            {usdShort(plan.reduceSize * risk.state.mark)}) with a reduce-only market order. After that, a {pct(risk.side === "long" ? -target : target, 0)} cascade
            no longer reaches this position.
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Run it continuously with the Guardian bot (your API wallet key never leaves your machine):
          </div>
          <pre className="code wrap">{cmd}</pre>
        </div>
      </div>
      <div className="panel">
        <h2>Signed order Guardian would send</h2>
        <p className="sub">
          Real Ed25519 API-wallet signature over <span className="num">METHOD:PATH:TS:NONCE:SHA256(body)</span>, signed here with a throwaway demo key.
          Builder fee attached via <span className="num">X-Builder-Fee-Bps</span>.
        </p>
        {prepared ? (
          <pre className="code wrap">
            {`${prepared.method} ${prepared.url}\n`}
            {Object.entries(prepared.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
            {`\n\n${JSON.stringify(JSON.parse(prepared.body ?? "{}"), null, 2)}`}
          </pre>
        ) : (
          <div className="muted">No order needed for this target.</div>
        )}
      </div>
    </div>
  );
}
