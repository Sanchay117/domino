import type { CurvePoint } from "@domino/engine";
import { useState } from "react";
import { pct, usdShort } from "../format.ts";
import { linear, niceTicks, useWidth } from "./useWidth.ts";

const LAYERS = [
  { key: "liquidatedNotional", label: "Liquidated on the order book", color: "#4efab0" },
  { key: "insuranceNotional", label: "Absorbed by SLP backstop", color: "#ffb547" },
  { key: "adlNotional", label: "Auto-deleveraged (ADL)", color: "#b394ff" },
  { key: "uncoveredNotional", label: "Uncovered", color: "#ff5f5f" },
] as const;

interface Props {
  points: CurvePoint[];
  range: number;
  height?: number;
  onPick?: (shock: number) => void;
}

export default function StressCurve({ points, range, height = 300, onPick }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<CurvePoint | null>(null);
  const m = { l: 58, r: 14, t: 14, b: 30 };
  const pts = [...points, { shock: 0, result: { liquidatedNotional: 0, insuranceNotional: 0, adlNotional: 0, uncoveredNotional: 0 } } as CurvePoint].sort(
    (a, b) => a.shock - b.shock,
  );
  const total = (p: CurvePoint) => LAYERS.reduce((s, l) => s + p.result[l.key], 0);
  const yMax = Math.max(1, ...pts.map(total)) * 1.08;
  const x = linear(-range, range, m.l, width - m.r);
  const y = linear(0, yMax, height - m.b, m.t);
  const ticks = niceTicks(yMax, 4);

  // Stacked area paths, drawn separately for the down and up halves so they meet at zero.
  const halves = [pts.filter((p) => p.shock <= 0), pts.filter((p) => p.shock >= 0)];
  const areas = LAYERS.map((layer, li) => {
    const d = halves
      .map((h) => {
        if (h.length < 2) return "";
        const lower = (p: CurvePoint) => LAYERS.slice(0, li).reduce((s, l) => s + p.result[l.key], 0);
        const upper = (p: CurvePoint) => lower(p) + p.result[layer.key];
        const top = h.map((p) => `${x(p.shock)},${y(upper(p))}`);
        const bottom = [...h].reverse().map((p) => `${x(p.shock)},${y(lower(p))}`);
        return `M${top.join("L")}L${bottom.join("L")}Z`;
      })
      .join("");
    return { ...layer, d };
  });

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best: CurvePoint | null = null;
    for (const p of points) if (!best || Math.abs(x(p.shock) - px) < Math.abs(x(best.shock) - px)) best = p;
    setHover(best);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onPick?.(hover.shock)} style={{ cursor: onPick ? "pointer" : "default", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="#1d1d1d" />
            <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end">
              {usdShort(t)}
            </text>
          </g>
        ))}
        {[-range, -range / 2, 0, range / 2, range].map((s) => (
          <text key={s} x={x(s)} y={height - 10} textAnchor="middle">
            {s === 0 ? "0" : pct(s, 0)}
          </text>
        ))}
        <line x1={x(0)} x2={x(0)} y1={m.t} y2={height - m.b} stroke="#333" strokeDasharray="3 3" />
        <text x={x(-range) + 4} y={m.t + 10} textAnchor="start" style={{ fill: "#5c5c5c" }}>
          ← BTC-led crash
        </text>
        <text x={x(range) - 4} y={m.t + 10} textAnchor="end" style={{ fill: "#5c5c5c" }}>
          squeeze →
        </text>
        {areas.map((a) => (
          <path key={a.key} d={a.d} fill={a.color} fillOpacity={0.72} stroke={a.color} strokeWidth={1} />
        ))}
        {hover && (
          <g>
            <line x1={x(hover.shock)} x2={x(hover.shock)} y1={m.t} y2={height - m.b} stroke="#ededed" strokeOpacity={0.5} />
            <circle cx={x(hover.shock)} cy={y(total(hover))} r={4} fill="#ededed" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(x(hover.shock) + 12, width - 240), top: 12 }}>
          <div style={{ color: "var(--text)", fontWeight: 600 }}>BTC {pct(hover.shock, 0)} (correlated)</div>
          {LAYERS.map((l) => (
            <div key={l.key} className="num">
              <span style={{ color: l.color }}>■</span> {usdShort(hover.result[l.key])} <span className="dim">{l.label.toLowerCase()}</span>
            </div>
          ))}
          <div className="num muted">
            {hover.result.accountsHit} accounts · {hover.result.positionsHit} positions hit
          </div>
          {onPick && <div className="mint">Click to replay in Cascade Lab</div>}
        </div>
      )}
      <div className="legend">
        {LAYERS.map((l) => (
          <span key={l.key}>
            <i style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
