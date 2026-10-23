import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp } from "../anim";
import { LogoMark } from "../components/Logo";
import { Sfx, tock } from "../components/Sfx";
import { sceneById, wordAt } from "../data";
import { C, mono, sans } from "../theme";

/** Shown on the end card. */
export const REPO_URL = "github.com/Sanchay117/domino";

const PILLARS = [
  { title: "Dashboard", sub: "Risk Radar · Cascade Lab · Catch · X-Ray", color: C.mint, icon: "chart" },
  { title: "Guardian bot", sub: "signed reduce-only orders, builder fee", color: C.amber, icon: "shield" },
  { title: "MCP server", sub: "six read-only tools for AI agents", color: C.violet, icon: "nodes" },
] as const;

// The closing domino row: the chain falls until it reaches the mint one, which holds.
const N = 18;
const GAP = 56;
const DW = 14;
const DH = 80;
const STOP = 11;
const LEAN = (Math.asin((GAP - DW) / DH) * 180) / Math.PI;
const ROW_X0 = 960 - ((N - 1) * GAP + DW) / 2;
const BASE = 850;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const s = sceneById("outro");
  const tLogo = s.lines[0].start - 0.15;
  const badges = [wordAt("outro", 0, "open"), wordAt("outro", 0, "no"), wordAt("outro", 0, "public")];
  const tBuilt = wordAt("outro", 0, "built") - 0.1;
  const tSee = wordAt("outro", 1, "see") - 0.35;
  const tFall = wordAt("outro", 1, "cascade") - 0.1;

  const logo = pop(frame, tLogo, 15);
  const tip = interpolate(frame, [f(tLogo + 0.25), f(tLogo + 0.8)], [0, 1], { ...CLAMP, easing: Easing.out(Easing.back(2)) });
  const lift = interpolate(frame, [f(tSee), f(tSee + 0.7)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
  const tag = ramp(frame, tSee + 0.25, 0.6);
  const endFade = interpolate(frame, [s.frames - 22, s.frames - 2], [1, 0], CLAMP);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 760px at 50% 55%, #121a16 0%, ${C.bg} 72%)`, fontFamily: sans, color: C.text, opacity: endFade }}>
      {/* Logo: centred, then rises to make room for the tagline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: interpolate(lift, [0, 1], [230, 150]),
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 26,
          opacity: Math.min(1, logo * 1.3),
          transform: `scale(${(0.85 + 0.15 * logo) * (1 - 0.3 * lift)})`,
        }}
      >
        <LogoMark size={120} tip={tip} />
        <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4 }}>Domino</div>
      </div>

      {/* Phase 1: what it is */}
      <AbsoluteFill style={{ opacity: 1 - lift, transform: `translateY(${-40 * lift}px)` }}>
        <div style={{ position: "absolute", top: 410, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
          {["open source", "no backend", "public Strike Finance API"].map((b, i) => {
            const p = pop(frame, badges[i] - 0.05);
            if (frame < f(badges[i] - 0.05)) return <div key={b} />;
            return (
              <div
                key={b}
                style={{
                  fontFamily: mono,
                  fontSize: 25,
                  color: C.mint,
                  border: `1px solid ${C.mint}55`,
                  background: `${C.mint}0d`,
                  borderRadius: 999,
                  padding: "10px 22px",
                  opacity: Math.min(1, p * 1.4),
                  transform: `translateY(${(1 - p) * 14}px)`,
                }}
              >
                {b}
              </div>
            );
          })}
        </div>

        <div style={{ position: "absolute", top: 540, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 36 }}>
          {PILLARS.map((p, i) => {
            const at = tBuilt + i * 0.28;
            const u = pop(frame, at);
            if (frame < f(at)) return <div key={p.title} style={{ width: 520 }} />;
            return (
              <div
                key={p.title}
                style={{
                  width: 520,
                  height: 230,
                  boxSizing: "border-box",
                  borderRadius: 20,
                  padding: "30px 32px",
                  background: C.panel,
                  border: `1px solid ${p.color}44`,
                  boxShadow: `0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 ${p.color}22`,
                  opacity: Math.min(1, u * 1.4),
                  transform: `translateY(${(1 - u) * 40}px)`,
                }}
              >
                <PillarIcon kind={p.icon} color={p.color} />
                <div style={{ fontSize: 38, fontWeight: 700, marginTop: 20 }}>{p.title}</div>
                <div style={{ fontSize: 23, color: C.muted, marginTop: 8 }}>{p.sub}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      <Sfx src="sfx/hit.wav" at={tLogo} volume={0.4} />
      {badges.map((t, i) => (
        <Sfx key={i} src="sfx/pop.wav" at={t - 0.05} volume={0.18} />
      ))}
      {PILLARS.map((_, i) => (
        <Sfx key={`p${i}`} src="sfx/pop.wav" at={tBuilt + i * 0.28} volume={0.22} />
      ))}
      <Sfx src="sfx/whoosh.wav" at={tSee - 0.3} volume={0.25} />
      {Array.from({ length: STOP }, (_, i) => (
        <Sfx key={`d${i}`} src={tock(i)} at={tFall + i * 0.1} volume={i === 0 ? 0.25 : 0.4} />
      ))}
      <Sfx src="sfx/tock-1.wav" at={tFall + (STOP - 1) * 0.1 + 0.2} volume={0.7} />
      <Sfx src="sfx/hit.wav" at={tFall + (STOP - 1) * 0.1 + 0.2} volume={0.3} />

      {/* Phase 2: the tagline, and a cascade that gets caught */}
      {frame >= f(tSee) && (
        <>
          <div
            style={{
              position: "absolute",
              top: 420,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 86,
              fontWeight: 700,
              letterSpacing: -2.5,
              opacity: tag,
              transform: `translateY(${(1 - tag) * 24}px)`,
            }}
          >
            See the <span style={{ color: C.mint }}>cascade</span> before the market does.
          </div>
          <DominoRow frame={frame} t0={tFall} appear={tSee + 0.3} />
          <EndLine frame={frame} at={tSee + 2.6} />
        </>
      )}
    </AbsoluteFill>
  );
};

const DominoRow: React.FC<{ frame: number; t0: number; appear: number }> = ({ frame, t0, appear }) => {
  const t = frame / 30;
  const show = ramp(frame, appear, 0.5);
  const hitAt = t0 + (STOP - 1) * 0.1 + 0.2;
  const wobble = t < hitAt ? 0 : 4 * Math.exp(-(t - hitAt) * 5) * Math.sin((t - hitAt) * 22);
  const glow = t < hitAt ? 0 : Math.exp(-(t - hitAt) * 1.6);
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, opacity: show }}>
      <line x1={ROW_X0 - 60} x2={ROW_X0 + (N - 1) * GAP + DW + 60} y1={BASE} y2={BASE} stroke={C.line} strokeWidth={2} />
      {Array.from({ length: N }, (_, i) => {
        const x = ROW_X0 + i * GAP;
        const stop = i === STOP;
        let angle = 0;
        if (i < STOP) {
          const u = Math.min(1, Math.max(0, (t - (t0 + i * 0.1)) / 0.2));
          angle = LEAN * Easing.in(Easing.quad)(u);
        } else if (stop) angle = Math.max(0, wobble);
        const fallen = i < STOP && t >= t0 + i * 0.1;
        const fill = stop ? C.mint : fallen ? "#3a1b1d" : C.panel2;
        const stroke = stop ? C.mint : fallen ? C.red : "#3a3a3a";
        return (
          <g key={i} transform={`rotate(${angle} ${x + DW} ${BASE})`}>
            {stop && glow > 0 && <rect x={x - 10} y={BASE - DH - 10} width={DW + 20} height={DH + 10} rx={8} fill={C.mint} opacity={0.25 * glow} />}
            <rect x={x} y={BASE - DH} width={DW} height={DH} rx={3} fill={fill} stroke={stroke} strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
};

const EndLine: React.FC<{ frame: number; at: number }> = ({ frame, at }) => {
  const p = ramp(frame, at, 0.6);
  return (
    <div style={{ position: "absolute", top: 905, left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: 24, color: C.muted, opacity: p }}>
      {REPO_URL ? <span style={{ color: C.text }}>{REPO_URL}</span> : null}
      {REPO_URL ? "  ·  " : ""}built for the Strike Finance hackathon
    </div>
  );
};

const PillarIcon: React.FC<{ kind: "chart" | "shield" | "nodes"; color: string }> = ({ kind, color }) => (
  <svg width={46} height={46} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {kind === "chart" && (
      <>
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 3 3 5-6" />
      </>
    )}
    {kind === "shield" && (
      <>
        <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
        <path d="M8.5 12l2.5 2.5 4.5-5" />
      </>
    )}
    {kind === "nodes" && (
      <>
        <circle cx={12} cy={12} r={3} />
        <circle cx={4.5} cy={6} r={2} />
        <circle cx={19.5} cy={6} r={2} />
        <circle cx={12} cy={21} r={1.6} />
        <path d="M6.2 7.2l3.4 2.9M17.8 7.2l-3.4 2.9M12 15v4.4" />
      </>
    )}
  </svg>
);
