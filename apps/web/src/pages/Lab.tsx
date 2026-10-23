import {
  correlatedScenario,
  DEFAULT_PARAMS,
  positionRisks,
  simulate,
  singleScenario,
  type NormalizedSnapshot,
  type RestingOrder,
  type Shape,
  type SimParams,
  type SimResult,
} from "@domino/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import CatchPanel from "../components/CatchPanel.tsx";
import EventFeed from "../components/EventFeed.tsx";
import Ladder from "../components/Ladder.tsx";
import PriceChart from "../components/PriceChart.tsx";
import { base, pct, usdShort } from "../format.ts";

interface Config {
  mode: "single" | "corr";
  symbol: string;
  shock: number;
  shape: Shape;
  rampSec: number;
  withdrawal: number;
  refill: number;
  slp: number;
  slpMultiple: number;
  markModel: SimParams["markModel"];
}

function fromParams(snap: NormalizedSnapshot, p: URLSearchParams): Config {
  const symbol = p.get("symbol") && snap.markets[p.get("symbol")!] ? p.get("symbol")! : "BTC-USD";
  return {
    mode: p.get("mode") === "single" ? "single" : "corr",
    symbol,
    shock: Number(p.get("shock") ?? -0.15),
    shape: (p.get("shape") as Shape) ?? "crash",
    rampSec: Number(p.get("ramp") ?? 180),
    withdrawal: Number(p.get("withdrawal") ?? DEFAULT_PARAMS.withdrawal),
    refill: Number(p.get("refill") ?? DEFAULT_PARAMS.refillPerSec),
    slp: Number(p.get("slp") ?? Math.round(snap.slpEquity || DEFAULT_PARAMS.insuranceFund)),
    slpMultiple: Number(p.get("slpx") ?? DEFAULT_PARAMS.ifNotionalMultiple),
    markModel: p.get("mark") === "index" ? "index" : "strike",
  };
}

const PLAY_SECONDS = 12;

export default function Lab({ snap, params }: { snap: NormalizedSnapshot; params: URLSearchParams }) {
  const [cfg, setCfg] = useState<Config>(() => fromParams(snap, params));
  useEffect(() => setCfg(fromParams(snap, params)), [snap, params]);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((c) => ({ ...c, [k]: v }));
  // Wall-clock seconds for a full playback; `?play=` overrides it (slower playback for recordings).
  const playSeconds = Number(params.get("play") ?? new URLSearchParams(location.search).get("play")) || PLAY_SECONDS;

  const symbols = useMemo(() => {
    const withPos = new Set(snap.accounts.flatMap((a) => a.positions.map((p) => p.symbol)));
    return Object.keys(snap.markets)
      .filter((s) => withPos.has(s))
      .sort();
  }, [snap]);
  const risks = useMemo(() => positionRisks(snap), [snap]);

  const [result, setResult] = useState<SimResult | null>(null);
  const [focus, setFocusState] = useState<string>(cfg.symbol);
  const [ms, setMs] = useState(0);
  // Resting orders from the Catch panel; kept in a ref too so runs scheduled from effects see the latest value.
  const catchRef = useRef<RestingOrder[] | null>(null);
  const [catchOrders, setCatchOrders] = useState<RestingOrder[] | null>(null);

  // The replay is deterministic, so focusing another market just re-runs it while recording that market's book.
  const run = (c: Config, recordSym: string): SimResult => {
    const scenario =
      c.mode === "single"
        ? singleScenario(c.symbol, c.shock, { shape: c.shape, rampSec: c.rampSec })
        : correlatedScenario(snap, c.shock, c.symbol, { shape: c.shape, rampSec: c.rampSec });
    return simulate(snap, scenario, {
      withdrawal: c.withdrawal,
      refillPerSec: c.refill,
      insuranceFund: c.slp,
      ifNotionalMultiple: c.slpMultiple,
      markModel: c.markModel,
      recordBooks: [recordSym],
      resting: catchRef.current ?? undefined,
    });
  };
  const setFocus = (s: string) => {
    setFocusState(s);
    // Catch orders belong to the market they were planned for, so focusing another one drops them.
    if (catchRef.current) {
      catchRef.current = null;
      setCatchOrders(null);
      setResult(run(cfg, s));
    } else if (result && !result.frames[0].books?.[s]) setResult(run(cfg, s));
  };
  const applyCatch = (orders: RestingOrder[] | null) => {
    catchRef.current = orders;
    setCatchOrders(orders);
    setResult(run(cfg, focus));
    setT(0);
    setPlaying(true);
  };

  useEffect(() => {
    catchRef.current = null;
    setCatchOrders(null);
    const id = setTimeout(() => {
      const t0 = performance.now();
      const r = run(cfg, cfg.symbol);
      setMs(performance.now() - t0);
      setResult(r);
      setFocusState(cfg.symbol);
      setT(0);
      setPlaying(true);
    }, 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, snap]);

  // Playback
  const T = result ? result.frames[result.frames.length - 1].t : 1;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  useEffect(() => {
    if (!playing || !result) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((cur) => {
        const nt = Math.min(T, cur + (dt * T) / playSeconds);
        if (nt >= T) setPlaying(false);
        return nt;
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, result, T]);

  const tInt = Math.floor(t);
  const live = useMemo(() => {
    if (!result) return null;
    const ev = result.events.filter((e) => e.t <= tInt);
    const sum = (k: string) => ev.filter((e) => e.kind === k).reduce((s, e) => s + e.notional, 0);
    return {
      liquidated: sum("liquidation"),
      slp: sum("insurance"),
      adl: sum("adl"),
      accounts: new Set(ev.filter((e) => e.accountKey).map((e) => e.accountKey)).size,
    };
  }, [result, tInt]);

  const bySymbol = useMemo(() => {
    if (!result) return [];
    const m = new Map<string, { symbol: string; shock: number; liq: number; slp: number; adl: number; positions: Set<number> }>();
    for (const e of result.events) {
      const r = m.get(e.symbol) ?? { symbol: e.symbol, shock: result.scenario.shocks[e.symbol] ?? 0, liq: 0, slp: 0, adl: 0, positions: new Set<number>() };
      if (e.kind === "liquidation") r.liq += e.notional;
      if (e.kind === "insurance") r.slp += e.notional;
      if (e.kind === "adl") r.adl += e.notional;
      if (e.positionId) r.positions.add(e.positionId);
      m.set(e.symbol, r);
    }
    return [...m.values()].sort((a, b) => b.liq + b.slp + b.adl - (a.liq + a.slp + a.adl));
  }, [result]);

  const range = Math.min(0.6, Math.max(0.08, Math.abs(cfg.shock * (cfg.mode === "corr" && focus !== cfg.symbol ? (result?.scenario.shocks[focus] ?? cfg.shock) / cfg.shock : 1)) * 1.3));
  const focusShock = result?.scenario.shocks[focus] ?? 0;
  const tot = result?.totals;

  return (
    <div className="grid cols-1-2">
      <div className="grid" style={{ alignContent: "start" }}>
        <div className="panel">
          <h2>Scenario</h2>
          <p className="sub">Shock the external index and replay Strike's mark-price batches second by second.</p>
          <div className="field">
            <span>Type</span>
            <div className="seg">
              <button className={cfg.mode === "corr" ? "on" : ""} onClick={() => set("mode", "corr")}>
                Market-wide (β)
              </button>
              <button className={cfg.mode === "single" ? "on" : ""} onClick={() => set("mode", "single")}>
                Single market
              </button>
            </div>
          </div>
          <label className="field">
            <span>{cfg.mode === "corr" ? "Leader market (others follow by β)" : "Market"}</span>
            <select value={cfg.symbol} onChange={(e) => set("symbol", e.target.value)}>
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s} {snap.betas[s] !== undefined ? `· β ${snap.betas[s].toFixed(2)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              Index move <b className={`num ${cfg.shock < 0 ? "red" : "mint"}`}>{pct(cfg.shock, 0)}</b>
            </span>
            <input type="range" min={-0.5} max={0.5} step={0.01} value={cfg.shock} onChange={(e) => set("shock", Number(e.target.value))} />
          </label>
          <div className="field">
            <span>Path</span>
            <div className="seg">
              {(["crash", "linear", "wick"] as Shape[]).map((s) => (
                <button key={s} className={cfg.shape === s ? "on" : ""} onClick={() => set("shape", s)}>
                  {s === "crash" ? "Front-loaded" : s === "linear" ? "Steady" : "Wick + bounce"}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>
              Over <b className="num">{cfg.rampSec}s</b>
            </span>
            <input type="range" min={20} max={600} step={10} value={cfg.rampSec} onChange={(e) => set("rampSec", Number(e.target.value))} />
          </label>
          <details className="adv">
            <summary>Liquidity &amp; backstop assumptions</summary>
            <label className="field">
              <span>
                Market makers pull at a 10% move <b className="num">{Math.round(cfg.withdrawal * 100)}%</b>
              </span>
              <input type="range" min={0} max={0.95} step={0.05} value={cfg.withdrawal} onChange={(e) => set("withdrawal", Number(e.target.value))} />
            </label>
            <label className="field">
              <span>
                Quote refill per second <b className="num">{Math.round(cfg.refill * 100)}%</b>
              </span>
              <input type="range" min={0} max={0.3} step={0.01} value={cfg.refill} onChange={(e) => set("refill", Number(e.target.value))} />
            </label>
            <label className="field">
              <span>
                SLP backstop equity <b className="num">{usdShort(cfg.slp)}</b>
              </span>
              <input type="range" min={0} max={Math.max(2_000_000, cfg.slp)} step={10_000} value={cfg.slp} onChange={(e) => set("slp", Number(e.target.value))} />
            </label>
            <label className="field">
              <span>
                SLP per-market exposure cap <b className="num">{cfg.slpMultiple.toFixed(2)}× equity</b>
              </span>
              <input type="range" min={0.02} max={2} step={0.02} value={cfg.slpMultiple} onChange={(e) => set("slpMultiple", Number(e.target.value))} />
            </label>
            <div className="field">
              <span>Mark model</span>
              <div className="seg">
                <button className={cfg.markModel === "strike" ? "on" : ""} onClick={() => set("markModel", "strike")}>
                  Strike median
                </button>
                <button className={cfg.markModel === "index" ? "on" : ""} onClick={() => set("markModel", "index")}>
                  Index only
                </button>
              </div>
            </div>
          </details>
          <div className="dim" style={{ fontSize: 12 }}>
            {result ? `${result.frames.length - 1} mark batches replayed${ms >= 1 ? ` in ${ms.toFixed(0)} ms` : ""}` : "Simulating…"}
          </div>
        </div>

        {result && cfg.mode === "corr" && (
          <div className="panel">
            <h2>Where it breaks</h2>
            <p className="sub">Markets that saw liquidations. Click one to focus the charts.</p>
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th className="r">Move</th>
                  <th className="r">Book</th>
                  <th className="r">SLP</th>
                  <th className="r">ADL</th>
                </tr>
              </thead>
              <tbody>
                {bySymbol.slice(0, 12).map((r) => (
                  <tr key={r.symbol} className="click" onClick={() => setFocus(r.symbol)} style={r.symbol === focus ? { background: "var(--panel-2)" } : undefined}>
                    <td>
                      <b>{base(r.symbol)}</b>
                    </td>
                    <td className="r num">{pct(r.shock, 0)}</td>
                    <td className="r num">{usdShort(r.liq)}</td>
                    <td className="r num amber">{r.slp ? usdShort(r.slp) : "–"}</td>
                    <td className="r num violet">{r.adl ? usdShort(r.adl) : "–"}</td>
                  </tr>
                ))}
                {bySymbol.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Nothing liquidates in this scenario.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {result && result.totals.positionsHit > 0 && (
          <CatchPanel snap={snap} scenario={result.scenario} params={result.params} symbol={focus} applied={catchOrders !== null} onApply={applyCatch} />
        )}
      </div>

      <div className="grid" style={{ alignContent: "start" }}>
        {result && tot && live && (
          <div className="panel">
            <p className="verdict">
              {cfg.mode === "corr" ? (
                <>
                  <b>{base(cfg.symbol)}</b> {pct(cfg.shock, 0)} over {cfg.rampSec}s with {Object.keys(result.scenario.shocks).length - 1} markets following by β:{" "}
                </>
              ) : (
                <>
                  <b>{base(cfg.symbol)}</b> {pct(cfg.shock, 0)} over {cfg.rampSec}s:{" "}
                </>
              )}
              {tot.positionsHit === 0 ? (
                <>no position on Strike reaches maintenance margin.</>
              ) : (
                <>
                  <b>{tot.accountsHit} accounts</b> are hit. <b className="mint">{usdShort(tot.liquidatedNotional)}</b> clears through the order book in{" "}
                  {tot.iocAttempts} staged IOCs ({tot.noFillAttempts} found no liquidity), <b className="amber">{usdShort(tot.insuranceNotional)}</b> falls to
                  the SLP backstop (mark-to-market {usdShort(tot.insurancePnl)})
                  {tot.adlNotional > 0 ? (
                    <>
                      {" "}
                      and <b className="violet">{usdShort(tot.adlNotional)}</b> is force-closed from winning traders by ADL
                    </>
                  ) : (
                    <>, with no ADL</>
                  )}
                  {tot.uncoveredNotional > 0 && (
                    <>
                      , leaving <b className="red">{usdShort(tot.uncoveredNotional)}</b> uncovered
                    </>
                  )}
                  . Worst mark dislocation: {pct(tot.maxMarkGap.pct, 2)} on {base(tot.maxMarkGap.symbol || cfg.symbol)}.
                </>
              )}
              {catchOrders && (
                <span className="badge ok" style={{ marginLeft: 8 }}>
                  with {catchOrders.length} catch order{catchOrders.length > 1 ? "s" : ""} resting in {base(catchOrders[0].symbol)}
                </span>
              )}
            </p>
            <div className="stats" style={{ marginTop: 14, marginBottom: 0 }}>
              <div className="stat">
                <div className="label">Liquidated on book</div>
                <div className="value mint">{usdShort(live.liquidated)}</div>
              </div>
              <div className="stat">
                <div className="label">SLP absorbed</div>
                <div className="value amber">{usdShort(live.slp)}</div>
              </div>
              <div className="stat">
                <div className="label">Auto-deleveraged</div>
                <div className="value violet">{usdShort(live.adl)}</div>
              </div>
              <div className="stat">
                <div className="label">Accounts hit</div>
                <div className="value">{live.accounts}</div>
              </div>
              <div className="stat">
                <div className="label">Liq fees → SLP</div>
                <div className="value">{usdShort(tot.liquidationFees)}</div>
              </div>
            </div>
            <div className="playbar">
              <button className="btn primary" style={{ width: 96 }} onClick={() => (t >= T ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
                {playing ? "Pause" : t >= T ? "Replay" : "Play"}
              </button>
              <input type="range" min={0} max={T} step={0.1} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />
              <span className="num muted" style={{ width: 64, textAlign: "right" }}>
                t+{tInt}s
              </span>
            </div>
          </div>
        )}

        {result && (
          <div className="panel">
            <h2>
              {base(focus)} mark vs index <span className="muted" style={{ fontWeight: 400 }}>· index {pct(focusShock, 1)}</span>
            </h2>
            <p className="sub">
              Strike's mark is the median of a funding-adjusted index, index + average basis, and the local book. Liquidation IOCs that drain the bids drag
              two of the three down together, which is where mark can break away from index.
            </p>
            <PriceChart result={result} symbol={focus} t={t} />
          </div>
        )}

        {result && (
          <div className="panel">
            <h2>{base(focus)} liquidation ladder</h2>
            <p className="sub">
              Above the axis: resting depth in the simulated book (outline = depth at t0). Below: notional liquidating at each price; it fills red as the
              cascade reaches it.
            </p>
            <Ladder result={result} risks={risks} symbol={focus} t={t} range={range} />
          </div>
        )}

        {result && (
          <div className="panel">
            <h2>Domino log</h2>
            <p className="sub">Every liquidation IOC, SLP transfer and ADL fill, in engine order.</p>
            <EventFeed events={result.events} t={t} />
          </div>
        )}
      </div>
    </div>
  );
}
