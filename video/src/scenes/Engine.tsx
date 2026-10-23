import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp } from "../anim";
import { Sfx } from "../components/Sfx";
import { facts, sceneById } from "../data";
import { C, mono, sans } from "../theme";

const ATTEMPTS = [21, 40, 60, 80, 100];
const DEST = [
  { title: "Order book", note: "IOC fills against resting bids", color: C.mint },
  { title: "SLP vault", note: "the protocol backstop takes the rest", color: C.amber },
  { title: "Auto-deleveraging", note: "profitable opposite side, ranked", color: C.violet },
];

const CODE = `/** Attempts 1–4 are risk-scaled partials; attempt 5 takes the rest. */
export function attemptSize(size, ratio, mark, attempt, step) {
  if (attempt >= MAX_ATTEMPTS) return size;
  const fraction = 0.2 + 0.8 * clamp(ratio - 1, 0, 1);
  return floorToStep(Math.min(size, 5000 / mark + size * fraction), step);
}

/** Neutral Price = Mark − D × ReleasedMM / (Q × R) */
export function neutralPrice(tiers, size, q, mark, ratio) {
  const released = releasedMaintenance(tiers, Math.abs(size), q, mark);
  return mark - (Math.sign(size) * released) / (q * ratio);
}`;

export const Engine: React.FC = () => {
  const frame = useCurrentFrame();
  const s = sceneById("engine");
  const [l1, l2, l3, l4] = s.lines;

  const kicker = ramp(frame, l1.start - 0.2, 0.5);
  const pos = pop(frame, l2.start);
  const bracket = ramp(frame, l2.start + 4.0, 0.5);
  const destAt = [l3.start, l3.start + 2.3, l3.start + 4.6];
  const swap = interpolate(frame, [f(l4.start - 0.3), f(l4.start + 0.6)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
  const code = ramp(frame, l4.start + 0.5, 0.7);
  const typed = Math.floor(interpolate(frame, [f(l4.start + 0.8), f(l4.start + 5.5)], [0, CODE.length], CLAMP));

  // Which destination the flow is currently going to.
  const active = frame >= f(destAt[2]) ? 2 : frame >= f(destAt[1]) ? 1 : frame >= f(destAt[0]) ? 0 : -1;

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: sans, color: C.text }}>
      <div style={{ position: "absolute", left: 140, top: 80, opacity: kicker * (1 - swap), transform: `translateY(${(1 - kicker) * 14 - 20 * swap}px)` }}>
        <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 3, color: C.mint }}>HOW STRIKE LIQUIDATES</div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5, marginTop: 6 }}>Staged, bounded, backstopped.</div>
      </div>
      {swap > 0 && (
        <div style={{ position: "absolute", left: 140, top: 80, opacity: swap, transform: `translateY(${(1 - swap) * 20}px)` }}>
          <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 3, color: C.mint }}>THE PORT</div>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5, marginTop: 6 }}>Every rule, in TypeScript.</div>
        </div>
      )}

      {/* Pipeline (gives way to the code) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transform: `scale(${1 - 0.08 * swap})`,
          opacity: 1 - swap,
          filter: swap > 0 ? `blur(${swap * 8}px)` : undefined,
        }}
      >
        <svg width={1920} height={1080} style={{ position: "absolute" }}>
          {frame >= f(l2.start + 0.9) && <Connector x1={470} y1={540} x2={560} y2={540} on color={C.red} frame={frame} />}
          {DEST.map((d, i) =>
            frame >= f(destAt[i]) ? <Connector key={i} x1={990} y1={540} x2={1180} y2={385 + i * 135} on={active === i} color={d.color} frame={frame} /> : null,
          )}
        </svg>

        {/* Position */}
        <div
          style={{
            position: "absolute",
            left: 140,
            top: 420,
            width: 330,
            padding: 24,
            borderRadius: 16,
            background: C.panel,
            border: `1px solid ${C.red}66`,
            opacity: pos,
            transform: `scale(${0.9 + 0.1 * pos})`,
          }}
        >
          <div style={{ fontFamily: mono, fontSize: 20, color: C.muted }}>ADA-USD · long · cross</div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 18 }}>margin ratio</div>
          <div style={{ fontFamily: mono, fontSize: 64, fontWeight: 600, color: C.red, lineHeight: 1.05 }}>104%</div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 8 }}>below maintenance → liquidate</div>
        </div>

        {/* Staged IOC attempts */}
        <div style={{ position: "absolute", left: 560, top: 330, width: 430 }}>
          {ATTEMPTS.map((pct, i) => {
            const at = l2.start + 0.9 + i * 0.5;
            const p = pop(frame, at);
            const fill = ramp(frame, at + 0.1, 0.5);
            if (frame < f(at)) return <div key={i} style={{ height: 70 }} />;
            return (
              <div
                key={i}
                style={{
                  height: 58,
                  marginBottom: 12,
                  borderRadius: 12,
                  background: C.panel,
                  border: `1px solid ${C.line}`,
                  position: "relative",
                  overflow: "hidden",
                  opacity: p,
                  transform: `translateX(${(1 - p) * -20}px)`,
                }}
              >
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct * fill}%`, background: `${C.red}1c` }} />
                <div style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${pct * fill}%`, background: C.red }} />
                <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", height: "100%", padding: "0 18px" }}>
                  <span style={{ fontSize: 24, fontWeight: 600 }}>IOC attempt {i + 1}</span>
                  <span style={{ fontFamily: mono, fontSize: 22, color: C.muted }}>{i === 4 ? "all of it" : `~${pct}% of size`}</span>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 8, opacity: bracket, fontFamily: mono, fontSize: 21, color: C.amber, borderTop: `2px solid ${C.amber}88`, paddingTop: 10 }}>
            sell limit = neutral price ÷ (1 − fee): never worse for the trader
          </div>
        </div>

        {/* Destinations */}
        {DEST.map((d, i) => {
          const p = pop(frame, destAt[i]);
          const lit = active === i;
          if (frame < f(destAt[i])) return null;
          return (
            <div
              key={d.title}
              style={{
                position: "absolute",
                left: 1180,
                top: 330 + i * 135,
                width: 600,
                height: 110,
                borderRadius: 16,
                padding: "18px 26px",
                background: lit ? `${d.color}14` : C.panel,
                border: `1px solid ${lit ? d.color : C.line}`,
                boxShadow: lit ? `0 0 50px ${d.color}30` : "none",
                opacity: p,
                transform: `translateX(${(1 - p) * 30}px)`,
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: d.color }}>
                {i + 1}. {d.title}
                {i === 1 && <span style={{ fontFamily: mono, fontSize: 22, color: C.muted, fontWeight: 400 }}>{`   ${(facts.slpEquity / 1e6).toFixed(2)}M equity`}</span>}
              </div>
              <div style={{ fontSize: 22, color: C.muted, marginTop: 4 }}>{d.note}</div>
            </div>
          );
        })}
      </div>

      <Sfx src="sfx/pop.wav" at={l2.start} volume={0.25} />
      {ATTEMPTS.map((_, i) => (
        <Sfx key={i} src="sfx/pop.wav" at={l2.start + 0.9 + i * 0.5} volume={0.16} />
      ))}
      {destAt.map((t, i) => (
        <Sfx key={`d${i}`} src="sfx/pop.wav" at={t} volume={0.28} />
      ))}
      <Sfx src="sfx/whoosh.wav" at={l4.start - 0.45} volume={0.25} />

      {/* The port */}
      {frame >= f(l4.start + 0.5) && (
        <div style={{ position: "absolute", left: 140, right: 140, top: 250, display: "flex", gap: 36, opacity: code, transform: `translateY(${(1 - code) * 40}px)` }}>
          <div style={{ flex: 1.55, background: "#0c0c0c", border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 30px" }}>
            <div style={{ fontFamily: mono, fontSize: 19, color: C.dim, marginBottom: 12 }}>packages/engine/src/liquidation.ts · simplified</div>
            <pre style={{ margin: 0, fontFamily: mono, fontSize: 22, lineHeight: 1.55, color: "#cfcfcf", whiteSpace: "pre-wrap" }}>
              {highlight(CODE.slice(0, typed))}
              <span style={{ background: C.mint, color: C.mint, opacity: frame % 30 < 15 ? 1 : 0 }}>▌</span>
            </pre>
          </div>
          <div style={{ flex: 0.85, display: "grid", gap: 30, alignContent: "start", paddingTop: 20 }}>
            {[
              [`${facts.positions}`, "live positions replayed"],
              [`${facts.marketsWithPositions}`, "markets, with real order books"],
              ["1 / sec", "mark-price batches, like Strike"],
              ["~50 ms", "for a full 4-minute cascade"],
            ].map(([v, k], i) => {
              const p = pop(frame, l4.start + 1.6 + i * 0.6);
              return (
                <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 18, opacity: p, transform: `translateX(${(1 - p) * 24}px)` }}>
                  <span style={{ fontFamily: mono, fontSize: 48, fontWeight: 600, color: C.mint, minWidth: 220, whiteSpace: "nowrap" }}>{v}</span>
                  <span style={{ fontSize: 25, color: C.muted }}>{k}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** A connector line; when on, dots flow along it. */
const Connector: React.FC<{ x1: number; y1: number; x2: number; y2: number; on: boolean; color: string; frame: number }> = ({ x1, y1, x2, y2, on, color, frame }) => {
  const mx = (x1 + x2) / 2;
  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  const dots = on
    ? Array.from({ length: 5 }, (_, k) => {
        const u = ((frame / 26 + k / 5) % 1 + 1) % 1;
        // Point on the cubic Bézier.
        const v = 1 - u;
        const x = v ** 3 * x1 + 3 * v * v * u * mx + 3 * v * u * u * mx + u ** 3 * x2;
        const y = v ** 3 * y1 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u ** 3 * y2;
        return <circle key={k} cx={x} cy={y} r={5} fill={color} opacity={Math.sin(Math.PI * u)} />;
      })
    : null;
  return (
    <g>
      <path d={d} fill="none" stroke={on ? color : "#2a2a2a"} strokeWidth={on ? 3 : 2} strokeOpacity={on ? 0.8 : 1} />
      {dots}
    </g>
  );
};

/** Minimal syntax colouring: comments, keywords, numbers. */
function highlight(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\/\*\*[\s\S]*?(?:\*\/|$))|\b(export|function|const|return|if)\b|(\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const color = m[1] ? C.dim : m[2] ? C.violet : C.amber;
    out.push(
      <span key={k++} style={{ color }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(src.slice(last));
  return out;
}
