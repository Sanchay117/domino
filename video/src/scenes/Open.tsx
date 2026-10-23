import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp } from "../anim";
import { LogoMark } from "../components/Logo";
import { Sfx, tock } from "../components/Sfx";
import { sceneById } from "../data";
import { C, mono, sans } from "../theme";

const N = 48;
const GAP = 74;
const DW = 26;
const DH = 138;
const BASE_Y = 700;
const X0 = 300;
const T0 = 2.1; // first domino tips
const FALL = 0.32; // seconds each domino takes to fall
const REST = 78; // degrees: lying on the next one

const SYMBOLS = ["BTC", "ADA", "ETH", "NIGHT", "SOL", "HYPE", "WTI", "XRP", "ZEC", "XAU", "SPCX", "NEAR", "PUMP", "DOGE"];

/** When each domino starts to fall: slow at first, then faster, like a real cascade. */
export const FALL_TIMES: number[] = (() => {
  const out: number[] = [];
  let t = T0;
  for (let i = 0; i < N; i++) {
    out.push(t);
    t += Math.max(0.13, 0.36 * 0.95 ** i);
  }
  return out;
})();

const label = (i: number) => `${SYMBOLS[Math.floor(random(`s${i}`) * SYMBOLS.length)]} ${[3, 5, 8, 10, 12, 15, 20, 25, 40][Math.floor(random(`l${i}`) * 9)]}×`;
const markY = (i: number) => 250 + 210 * (1 - (1 - i / (N - 1)) ** 1.7) + (random(`m${i}`) - 0.5) * 14;
const markPct = (i: number) => -14.2 * (1 - (1 - i / (N - 1)) ** 1.7);

export const Open: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const s = sceneById("open");
  const titleAt = s.lines[2].start - 0.2;
  const line2 = s.lines[1];

  // Index of the domino at the front of the cascade, with a fractional part for smooth tracking.
  let front = -1;
  for (let i = 0; i < N; i++) if (t >= FALL_TIMES[i]) front = i;
  const frontProgress = front < 0 ? 0 : Math.min(1, (t - FALL_TIMES[front]) / FALL);
  const head = front < 0 ? 0 : front + frontProgress;

  const lastX = X0 + (N - 1) * GAP;
  const pan = interpolate(frame, [f(T0 + 1.5), f(FALL_TIMES[N - 1] + 0.6)], [0, lastX - 1500], { ...CLAMP, easing: Easing.inOut(Easing.sin) });

  const world = 1 - ramp(frame, titleAt, 0.9, Easing.inOut(Easing.cubic));
  const enter = ramp(frame, 0.2, 1.2);

  // Mark line revealed up to the cascade's front.
  const pts: string[] = [];
  for (let i = 0; i <= Math.min(N - 1, Math.floor(head)); i++) pts.push(`${X0 + i * GAP + DW},${markY(i)}`);
  if (head > 0 && head < N - 1) {
    const i = Math.floor(head);
    const u = head - i;
    pts.push(`${X0 + (i + u) * GAP + DW},${markY(i) + (markY(i + 1) - markY(i)) * u}`);
  }
  const headPct = head <= 0 ? 0 : markPct(Math.min(N - 1, head));
  const [hx, hy] = pts.length ? pts[pts.length - 1].split(",").map(Number) : [X0, markY(0)];

  const tags = ["sells into the book", "bids thin out", "mark slips", "next position falls"];
  const tagTimes = [0.1, 1.5, 2.9, 3.9].map((d) => line2.start + d);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 60%, #121a16 0%, ${C.bg} 70%)` }}>
      {/* Domino world */}
      <AbsoluteFill style={{ opacity: world * enter, filter: `blur(${(1 - world) * 8}px)`, transform: `scale(${0.94 + 0.06 * world})` }}>
        <svg width={1920} height={1080} style={{ position: "absolute" }}>
          <g transform={`translate(${-pan},0)`}>
            {/* floor */}
            <line x1={0} x2={lastX + 2000} y1={BASE_Y} y2={BASE_Y} stroke={C.line} strokeWidth={2} />
            {Array.from({ length: 70 }, (_, k) => (
              <line key={k} x1={k * 80} x2={k * 80 - 60} y1={BASE_Y} y2={BASE_Y + 120} stroke="#1a1a1a" strokeWidth={1} />
            ))}
            {/* mark line */}
            <polyline points={pts.join(" ")} fill="none" stroke={C.mint} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            {pts.length > 0 && (
              <>
                <circle cx={hx} cy={hy} r={6} fill={C.mint} />
                <text x={hx + 14} y={hy + 6} fill={C.mint} fontFamily={mono} fontSize={24} fontWeight={600}>
                  mark {headPct.toFixed(1)}%
                </text>
              </>
            )}
            {Array.from({ length: N }, (_, i) => {
              const u = Math.min(1, Math.max(0, (t - FALL_TIMES[i]) / FALL));
              const angle = REST * Easing.in(Easing.quad)(u);
              const hit = t >= FALL_TIMES[i];
              const flash = hit ? interpolate(t - FALL_TIMES[i], [0, 0.25, 0.9], [1, 1, 0], CLAMP) : 0;
              const x = X0 + i * GAP;
              const fill = hit ? `rgb(${Math.round(40 + 140 * flash)}, ${Math.round(20 + 30 * flash)}, ${Math.round(22 + 30 * flash)})` : C.panel2;
              const stroke = hit ? C.red : i === 0 ? C.mint : "#3a3a3a";
              return (
                <g key={i} transform={`rotate(${angle} ${x + DW} ${BASE_Y})`}>
                  <rect x={x} y={BASE_Y - DH} width={DW} height={DH} rx={4} fill={fill} stroke={stroke} strokeWidth={2} />
                  <text
                    x={x + DW / 2 + 5}
                    y={BASE_Y - 10}
                    fill={hit ? "#ffb3b3" : C.muted}
                    fontFamily={mono}
                    fontSize={14}
                    transform={`rotate(-90 ${x + DW / 2 + 5} ${BASE_Y - 10})`}
                  >
                    {label(i)}
                  </text>
                  {flash > 0 && <circle cx={x + DW / 2} cy={BASE_Y - DH - 14} r={4 + 14 * (1 - flash)} fill="none" stroke={C.red} strokeOpacity={flash} strokeWidth={2} />}
                </g>
              );
            })}
          </g>
        </svg>

        {/* The mechanism, spelled out while line 2 is spoken */}
        <div style={{ position: "absolute", top: 120, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 18, fontFamily: sans }}>
          {tags.map((tag, i) => {
            const p = pop(frame, tagTimes[i]);
            if (frame < f(tagTimes[i])) return <div key={tag} style={{ width: 300 }} />;
            return (
              <div key={tag} style={{ display: "flex", alignItems: "center", gap: 18, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
                <div
                  style={{
                    padding: "12px 20px",
                    borderRadius: 999,
                    border: `1px solid ${i === 3 ? C.red : C.line}`,
                    background: "rgba(17,17,17,0.9)",
                    color: i === 3 ? C.red : C.text,
                    fontSize: 26,
                    fontWeight: 500,
                  }}
                >
                  {tag}
                </div>
                {i < tags.length - 1 && <div style={{ color: C.dim, fontSize: 28 }}>→</div>}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* Title */}
      <Title at={titleAt + 0.2} />

      {FALL_TIMES.map((ft, i) => (
        <Sfx key={i} src={tock(i)} at={ft} volume={i === 0 ? 0.25 : 0.38 + 0.22 * random(`v${i}`)} />
      ))}
      <Sfx src={tock(3)} at={FALL_TIMES[N - 1] + FALL} volume={0.5} />
      {tagTimes.map((tt, i) => (
        <Sfx key={`t${i}`} src="sfx/pop.wav" at={tt} volume={0.2} />
      ))}
      <Sfx src="sfx/whoosh.wav" at={titleAt - 0.35} volume={0.35} />
      <Sfx src="sfx/hit.wav" at={titleAt + 0.2} volume={0.55} />
    </AbsoluteFill>
  );
};

const Title: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  if (frame < f(at)) return null;
  const p = pop(frame, at, 16);
  const tip = interpolate(frame, [f(at + 0.3), f(at + 0.9)], [0, 1], { ...CLAMP, easing: Easing.out(Easing.back(2)) });
  const sub = ramp(frame, at + 0.7, 0.6);
  const strike = ramp(frame, at + 1.4, 0.6);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: sans, paddingBottom: 90 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${0.85 + 0.15 * p})`, opacity: Math.min(1, p * 1.3) }}>
        <LogoMark size={170} tip={tip} />
        <div style={{ fontSize: 168, fontWeight: 700, color: C.text, letterSpacing: -5 }}>Domino</div>
      </div>
      <div style={{ marginTop: 22, fontSize: 44, color: C.muted, opacity: sub, transform: `translateY(${(1 - sub) * 12}px)` }}>
        The liquidation-cascade lab for <span style={{ color: C.text, fontWeight: 600 }}>Strike Finance</span>
      </div>
      <div style={{ marginTop: 34, display: "flex", gap: 14, opacity: strike }}>
        {["live mainnet data", "Strike's own engine, replayed", "open source"].map((s) => (
          <div key={s} style={{ fontFamily: mono, fontSize: 22, color: C.mint, border: `1px solid ${C.mint}44`, borderRadius: 999, padding: "8px 18px" }}>
            {s}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
