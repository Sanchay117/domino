import type { SimResult } from "@domino/engine";
import { pct, price, usdShort } from "../format.ts";
import { linear, useWidth } from "./useWidth.ts";

const COLORS: Record<string, string> = { liquidation: "#ff5f5f", no_fill: "#777", insurance: "#ffb547", adl: "#b394ff", uncovered: "#ffffff" };

/** Index vs mark vs best bid/ask for one market during a replay, as % move from the starting index. */
export default function PriceChart({ result, symbol, t, height = 260 }: { result: SimResult; symbol: string; t: number; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const m = { l: 52, r: 14, t: 12, b: 26 };
  const frames = result.frames;
  const T = frames[frames.length - 1].t;
  const x0 = frames[0].symbols[symbol]?.index ?? 1;
  const rel = (p: number) => p / x0 - 1;
  const series = frames.map((f) => f.symbols[symbol]);
  const vals = series.flatMap((s) => [rel(s.index), rel(s.mark), s.bid ? rel(s.bid) : 0, s.ask ? rel(s.ask) : 0]).filter(Number.isFinite);
  const lo = Math.min(...vals, 0) - 0.005;
  const hi = Math.max(...vals, 0) + 0.005;
  const x = linear(0, T, m.l, width - m.r);
  const y = linear(lo, hi, height - m.b, m.t);
  const upto = frames.filter((f) => f.t <= t);
  const path = (get: (i: number) => number) => upto.map((f, i) => `${i ? "L" : "M"}${x(f.t)},${y(get(i))}`).join("");
  const events = result.events.filter((e) => e.symbol === symbol && e.t <= t && e.kind !== "no_fill");
  const maxN = Math.max(1, ...result.events.filter((e) => e.symbol === symbol).map((e) => e.notional));
  const yTicks = 5;
  const tick = (i: number) => lo + ((hi - lo) * i) / yTicks;
  const cur = series[Math.min(series.length - 1, Math.max(0, Math.round(t)))];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {Array.from({ length: yTicks + 1 }, (_, i) => (
          <g key={i}>
            <line x1={m.l} x2={width - m.r} y1={y(tick(i))} y2={y(tick(i))} stroke="#1b1b1b" />
            <text x={m.l - 8} y={y(tick(i)) + 3.5} textAnchor="end">
              {pct(tick(i))}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((u) => (
          <text key={u} x={x(u * T)} y={height - 8} textAnchor="middle">
            {Math.round(u * T)}s
          </text>
        ))}
        <path d={path((i) => (series[i].bid ? rel(series[i].bid) : rel(series[i].index)))} fill="none" stroke="#ff5f5f" strokeOpacity={0.35} strokeWidth={1} />
        <path d={path((i) => rel(series[i].index))} fill="none" stroke="#ededed" strokeOpacity={0.55} strokeDasharray="4 3" strokeWidth={1.3} />
        <path d={path((i) => rel(series[i].mark))} fill="none" stroke="#4efab0" strokeWidth={2} />
        {events.map((e, i) => (
          <circle key={i} cx={x(e.t)} cy={y(rel(e.price))} r={3 + 9 * Math.sqrt(e.notional / maxN)} fill={COLORS[e.kind]} fillOpacity={0.5} stroke={COLORS[e.kind]} />
        ))}
        <line x1={x(t)} x2={x(t)} y1={m.t} y2={height - m.b} stroke="#ededed" strokeOpacity={0.25} />
      </svg>
      {cur && (
        <div className="tooltip" style={{ right: 16, top: 10, left: "auto" }}>
          <div className="num">
            <span className="mint">mark</span> {price(cur.mark)} <span className="dim">({pct(rel(cur.mark), 2)})</span>
          </div>
          <div className="num">
            <span className="muted">index</span> {price(cur.index)}
          </div>
          <div className="num">
            <span className="red">bid</span> {price(cur.bid)} <span className="dim">· depth ±5% {usdShort(cur.bidDepth)}</span>
          </div>
        </div>
      )}
      <div className="legend">
        <span>
          <i style={{ background: "#4efab0" }} />
          Mark (Strike's median of P1/P2/P3)
        </span>
        <span>
          <i style={{ background: "#ededed" }} />
          Index (external spot)
        </span>
        <span>
          <i style={{ background: "#ff5f5f", opacity: 0.5 }} />
          Best bid
        </span>
        <span>
          <i style={{ background: "#ff5f5f", borderRadius: "50%" }} />
          Liquidation fill
        </span>
        <span>
          <i style={{ background: "#ffb547", borderRadius: "50%" }} />
          SLP transfer
        </span>
        <span>
          <i style={{ background: "#b394ff", borderRadius: "50%" }} />
          ADL
        </span>
      </div>
    </div>
  );
}
