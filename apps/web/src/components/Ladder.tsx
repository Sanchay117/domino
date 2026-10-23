import type { PositionRisk, SimResult } from "@domino/engine";
import { useMemo, useState } from "react";
import { pct, price, usdShort } from "../format.ts";
import { linear, useWidth } from "./useWidth.ts";

interface Props {
  result: SimResult;
  risks: PositionRisk[];
  symbol: string;
  t: number;
  range: number;
  height?: number;
}

const HALO = { stroke: "var(--panel)", strokeWidth: 4, paintOrder: "stroke" } as const;

/**
 * The liquidation ladder: resting order-book depth above the axis, liquidation prices below it.
 * During playback the book drains as liquidation IOCs eat it, and liquidation bars fill in as
 * positions are hit.
 */
export default function Ladder({ result, risks, symbol, t, range, height = 300 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const BINS = 64;
  const m = { l: 52, r: 14, t: 26, b: 28 };
  const f0 = result.frames[0].symbols[symbol];
  const mark0 = f0?.mark ?? 1;
  const lo = mark0 * (1 - range);
  const hi = mark0 * (1 + range);
  const w = (hi - lo) / BINS;
  const bin = (p: number) => Math.floor((p - lo) / w);
  const frame = result.frames[Math.min(result.frames.length - 1, Math.max(0, Math.round(t)))];
  const cur = frame.symbols[symbol];
  const firstHit = useMemo(() => new Map(result.fates.map((f) => [f.positionId, f.firstHitT])), [result]);

  const liq = useMemo(() => {
    const rows = Array.from({ length: BINS }, () => ({ total: 0, items: [] as { id: number; n: number; side: string }[] }));
    for (const r of risks) {
      if (r.pos.symbol !== symbol || r.liq <= 0 || r.level === "bankrupt") continue;
      const i = bin(r.liq);
      if (i < 0 || i >= BINS) continue;
      rows[i].total += r.notional;
      rows[i].items.push({ id: r.pos.id, n: r.notional, side: r.side });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [risks, symbol, lo, hi]);

  const book = useMemo(() => {
    const rows = Array.from({ length: BINS }, () => ({ bids: 0, asks: 0 }));
    const b = frame.books?.[symbol];
    if (b) {
      for (const [p, q] of b.bids) {
        const i = bin(p);
        if (i >= 0 && i < BINS) rows[i].bids += p * q;
      }
      for (const [p, q] of b.asks) {
        const i = bin(p);
        if (i >= 0 && i < BINS) rows[i].asks += p * q;
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, symbol, lo, hi]);

  const initialBook = useMemo(() => {
    const rows = Array.from({ length: BINS }, () => 0);
    const b = result.frames[0].books?.[symbol];
    if (b) for (const [p, q] of [...b.bids, ...b.asks]) {
      const i = bin(p);
      if (i >= 0 && i < BINS) rows[i] += p * q;
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, symbol, lo, hi]);

  const axisY = m.t + (height - m.t - m.b) * 0.55;
  const bookMax = Math.max(1, ...initialBook);
  const liqMax = Math.max(1, ...liq.map((r) => r.total));
  const x = linear(lo, hi, m.l, width - m.r);
  const bw = (width - m.l - m.r) / BINS;
  const upH = (v: number) => (axisY - m.t) * Math.sqrt(v / bookMax);
  const downH = (v: number) => (height - m.b - axisY - 4) * Math.sqrt(v / liqMax);

  const hoverRow = hover !== null ? { book: book[hover], liq: liq[hover], lo: lo + hover * w } : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg
        width={width}
        height={height}
        style={{ display: "block" }}
        onMouseMove={(e) => {
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const i = Math.floor((px - m.l) / bw);
          setHover(i >= 0 && i < BINS ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {initialBook.map((v, i) => (
          <rect key={`g${i}`} x={m.l + i * bw + 1} y={axisY - upH(v)} width={Math.max(1, bw - 2)} height={upH(v)} fill="none" stroke="#2a2a2a" />
        ))}
        {book.map((r, i) => (
          <g key={`b${i}`}>
            {r.bids > 0 && <rect x={m.l + i * bw + 1} y={axisY - upH(r.bids)} width={Math.max(1, bw - 2)} height={upH(r.bids)} fill="#4efab0" fillOpacity={0.55} />}
            {r.asks > 0 && <rect x={m.l + i * bw + 1} y={axisY - upH(r.asks)} width={Math.max(1, bw - 2)} height={upH(r.asks)} fill="#8a8a8a" fillOpacity={0.45} />}
          </g>
        ))}
        {liq.map((r, i) => {
          if (!r.total) return null;
          const hit = r.items.filter((it) => {
            const ft = firstHit.get(it.id);
            return ft !== null && ft !== undefined && ft <= t;
          }).reduce((s, it) => s + it.n, 0);
          return (
            <g key={`l${i}`}>
              <rect x={m.l + i * bw + 1} y={axisY + 4} width={Math.max(1, bw - 2)} height={downH(r.total)} fill="#ff5f5f" fillOpacity={0.12} stroke="#ff5f5f" strokeOpacity={0.5} />
              {hit > 0 && <rect x={m.l + i * bw + 1} y={axisY + 4} width={Math.max(1, bw - 2)} height={downH(r.total) * Math.min(1, hit / r.total)} fill="#ff5f5f" />}
            </g>
          );
        })}
        <line x1={m.l} x2={width - m.r} y1={axisY} y2={axisY} stroke="#333" />
        <line x1={x(mark0)} x2={x(mark0)} y1={m.t} y2={height - m.b} stroke="#5c5c5c" strokeDasharray="2 3" />
        {cur && (
          <>
            <line x1={x(cur.index)} x2={x(cur.index)} y1={m.t} y2={height - m.b} stroke="#ededed" strokeOpacity={0.6} strokeDasharray="4 3" />
            <line x1={x(cur.mark)} x2={x(cur.mark)} y1={m.t - 4} y2={height - m.b} stroke="#4efab0" strokeWidth={2} />
            {/* Sits in the top margin so it never collides with the in-plot labels; flips side near the right edge. */}
            <text
              x={x(cur.mark) > width - 120 ? x(cur.mark) - 4 : x(cur.mark) + 4}
              y={m.t - 8}
              textAnchor={x(cur.mark) > width - 120 ? "end" : "start"}
              style={{ fill: "#4efab0" }}
            >
              mark {pct(cur.mark / mark0 - 1)}
            </text>
          </>
        )}
        {/* Drawn after the bars and lines, with a halo, so they stay readable when the mark line crosses them. */}
        <text x={m.l + 2} y={m.t + 10} style={HALO}>
          resting book (USD, √ scale)
        </text>
        <text x={m.l + 2} y={height - m.b - 4} style={HALO}>
          liquidation prices
        </text>
        {[-range, -range / 2, 0, range / 2, range].map((u, i, all) => (
          <text key={u} x={x(mark0 * (1 + u))} y={height - 8} textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}>
            {price(mark0 * (1 + u))}
          </text>
        ))}
        {hover !== null && <rect x={m.l + hover * bw} y={m.t} width={bw} height={height - m.t - m.b} fill="#fff" fillOpacity={0.04} />}
      </svg>
      {hoverRow && (
        <div className="tooltip" style={{ left: Math.min(m.l + (hover ?? 0) * bw + 14, width - 230), top: 30 }}>
          <div className="num">
            {price(hoverRow.lo)} – {price(hoverRow.lo + w)}
          </div>
          <div className="num">
            <span className="mint">bids</span> {usdShort(hoverRow.book.bids)} <span className="muted">asks</span> {usdShort(hoverRow.book.asks)}
          </div>
          <div className="num">
            <span className="red">liquidations</span> {usdShort(hoverRow.liq.total)} · {hoverRow.liq.items.length} positions
          </div>
        </div>
      )}
    </div>
  );
}
