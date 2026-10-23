import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp } from "../anim";
import { Sfx } from "../components/Sfx";
import { facts, sceneById } from "../data";
import { C, mono, sans } from "../theme";

const COLS = 34;
const CELL = 30;

export const Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const s = sceneById("proof");
  const [l1, l2] = s.lines;
  const total = facts.validation.total;
  const rows = Math.ceil(total / COLS);

  const head = ramp(frame, l1.start - 0.1, 0.5);
  const api = [0, 1, 2].map((i) => ramp(frame, l1.start + 0.5 + i * 0.35, 0.4));
  const fillStart = l2.start + 0.3;
  const fillEnd = l2.start + 5.0;
  const exactAt = l2.start + l2.seconds - 1.0;
  const count = Math.round(interpolate(frame, [f(fillStart), f(fillEnd)], [0, facts.validation.matched], CLAMP));
  const exact = pop(frame, exactAt, 12);
  const pulse = interpolate(frame, [f(exactAt), f(exactAt) + 10, f(exactAt) + 30], [0, 1, 0], CLAMP);

  // Each dot lights in a scattered order, all within the fill window.
  const order = Array.from({ length: total }, (_, i) => ({ i, r: random(`v${i}`) })).sort((a, b) => a.r - b.r);
  const litAt = new Map(order.map(({ i }, k) => [i, fillStart + ((fillEnd - fillStart) * k) / total]));

  const gridW = COLS * CELL;
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: sans, color: C.text }}>
      <div style={{ position: "absolute", left: 140, top: 80, opacity: head, transform: `translateY(${(1 - head) * 14}px)` }}>
        <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 3, color: C.mint }}>PROOF FIRST</div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5, marginTop: 6 }}>Recompute every liquidation price.</div>
      </div>

      <div style={{ position: "absolute", left: 140, top: 270, fontFamily: mono, fontSize: 23, color: C.muted, lineHeight: 1.75 }}>
        {[
          ["GET", "/stat/v1/stats/live-positions", "balances, entries, sizes"],
          ["GET", "/v2/markets", "margin tiers, ticks, steps"],
          ["LP =", "(entry − (W + TU − TM + MA) / size) / (1 − D·MMR)", ""],
        ].map(([a, b, c], i) => (
          <div key={b} style={{ opacity: api[i], transform: `translateX(${(1 - api[i]) * -16}px)` }}>
            <span style={{ color: i === 2 ? C.amber : C.mint }}>{a}</span> <span style={{ color: C.text }}>{b}</span> <span style={{ color: C.dim }}>{c && `· ${c}`}</span>
          </div>
        ))}
      </div>

      {/* One dot per live position */}
      <svg width={gridW} height={rows * CELL} style={{ position: "absolute", left: 140, top: 470 }}>
        {Array.from({ length: total }, (_, i) => {
          const at = litAt.get(i)!;
          const on = interpolate(frame, [f(at), f(at) + 6], [0, 1], CLAMP);
          const x = (i % COLS) * CELL + CELL / 2;
          const y = Math.floor(i / COLS) * CELL + CELL / 2;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={8} fill="#1c1c1c" />
              {on > 0 && <circle cx={x} cy={y} r={(5 + 4 * on) * (1 + 0.25 * pulse)} fill={C.mint} opacity={0.35 + 0.65 * on} />}
            </g>
          );
        })}
      </svg>

      <Sfx src="sfx/whoosh.wav" at={fillStart - 0.3} volume={0.18} />
      <Sfx src="sfx/pop.wav" at={exactAt} volume={0.4} />
      <Sfx src="sfx/hit.wav" at={exactAt} volume={0.3} />

      {/* Counter */}
      <div style={{ position: "absolute", left: 140 + gridW + 70, top: 470, width: 600 }}>
        <div style={{ fontSize: 24, color: C.muted }}>liquidation prices reproduced</div>
        <div style={{ fontFamily: mono, fontSize: 132, fontWeight: 600, lineHeight: 1.05, color: count === total ? C.mint : C.text }}>
          {count}
          <span style={{ color: C.dim, fontSize: 70 }}> / {total}</span>
        </div>
        {frame >= f(exactAt) && (
          <div style={{ marginTop: 18, opacity: exact, transform: `scale(${0.85 + 0.15 * exact})`, transformOrigin: "left center" }}>
            <div style={{ display: "inline-block", fontSize: 40, fontWeight: 700, color: C.bg, background: C.mint, borderRadius: 12, padding: "8px 20px" }}>Exactly.</div>
            <div style={{ fontFamily: mono, fontSize: 22, color: C.muted, marginTop: 14 }}>worst error {facts.validation.worst.toExponential(1)} · Strike mainnet snapshot</div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
