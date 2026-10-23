import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp, usdShort } from "../anim";
import { LogoMark } from "../components/Logo";
import { KeyClicks, Sfx } from "../components/Sfx";
import { facts, wordAt } from "../data";
import { C, mono, sans } from "../theme";

const TOOLS = ["market_risk", "stress_test", "position_xray", "liquidation_ladder", "derisk_plan", "catch_plan"];
const HUB = { x: 960, y: 500 };
const AGENT = { x: 330, y: 500 };
const API = { x: 1590, y: 500 };

const b = facts.btc15;
const QUESTION = "What would a 15% crash do to Strike right now?";
const RESULT = [
  ["scenario", '"BTC-USD -15.0% (correlated)"'],
  ["liquidated_on_book_usd", Math.round(b.liquidatedNotional).toString()],
  ["absorbed_by_slp_usd", Math.round(b.insuranceNotional).toString()],
  ["auto_deleveraged_usd", Math.round(b.adlNotional).toString()],
  ["accounts_hit", String(b.accountsHit)],
];
const ANSWER = [
  { t: `A 15% BTC-led crash would liquidate ` },
  { t: `${b.accountsHit} accounts`, c: C.text },
  { t: `. ` },
  { t: usdShort(b.liquidatedNotional), c: C.mint },
  { t: ` clears through the order book, ` },
  { t: usdShort(b.insuranceNotional), c: C.amber },
  { t: ` lands on the SLP vault, and ` },
  { t: b.adlNotional === 0 ? "no one is auto-deleveraged" : `${usdShort(b.adlNotional)} is auto-deleveraged`, c: C.text },
  { t: `.` },
];

export const Mcp: React.FC = () => {
  const frame = useCurrentFrame();
  const tAgents = wordAt("mcp", 0, "agents") - 0.1;
  const tDomino = wordAt("mcp", 0, "domino") - 0.1;
  const tMcp = wordAt("mcp", 0, "mcp") - 0.1;
  const tSwap = wordAt("mcp", 1, "ask") - 0.45;
  const tAsk = wordAt("mcp", 1, "ask");
  const tCall = wordAt("mcp", 1, "crash") + 0.1;
  const tRuns = wordAt("mcp", 1, "runs") - 0.1;
  const tAnswer = wordAt("mcp", 1, "replay");

  const head = ramp(frame, 0.2, 0.5);
  const out = interpolate(frame, [f(tSwap), f(tSwap + 0.55)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 760px at 50% 45%, #10161a 0%, ${C.bg} 72%)`, fontFamily: sans, color: C.text }}>
      {/* Phase 1: the server between agents and Strike */}
      <AbsoluteFill style={{ opacity: 1 - out, filter: `blur(${out * 10}px)`, transform: `scale(${1 - 0.06 * out})` }}>
        <div style={{ position: "absolute", left: 140, top: 80, opacity: head, transform: `translateY(${(1 - head) * 14}px)` }}>
          <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 3, color: C.mint }}>FOR AGENTS</div>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5, marginTop: 6 }}>An MCP server for Strike risk.</div>
        </div>

        <svg width={1920} height={1080} style={{ position: "absolute", opacity: ramp(frame, tDomino, 0.4) }}>
          <Flow x1={AGENT.x + 190} y1={AGENT.y} x2={HUB.x - 200} y2={HUB.y} on={frame >= f(tDomino + 0.3)} frame={frame} color={C.violet} />
          <Flow x1={HUB.x + 200} y1={HUB.y} x2={API.x - 200} y2={API.y} on={frame >= f(tDomino + 0.8)} frame={frame} color={C.mint} />
          {TOOLS.map((t, i) => {
            const [x, y] = toolPos(i);
            const p = ramp(frame, tMcp + i * 0.13, 0.3);
            return <line key={t} x1={HUB.x} y1={HUB.y + (y < HUB.y ? -70 : 70)} x2={x} y2={y + (y < HUB.y ? 26 : -26)} stroke={C.line} strokeWidth={2} opacity={p} />;
          })}
        </svg>

        <Node frame={frame} at={tAgents} x={AGENT.x} y={AGENT.y} w={380} color={C.violet} title="AI agent" sub="Claude, or any MCP client" icon={<AgentIcon />} />
        <Node frame={frame} at={tDomino} x={HUB.x} y={HUB.y} w={400} color={C.mint} title="domino-mcp" sub="stdio · read-only · 6 tools" icon={<LogoMark size={54} />} big />
        <Node frame={frame} at={tDomino + 0.5} x={API.x} y={API.y} w={400} color={C.text} title="Strike Finance API" sub="markets · positions · books" icon={<ApiIcon />} />

        {TOOLS.map((t, i) => {
          const [x, y] = toolPos(i);
          const p = pop(frame, tMcp + i * 0.13);
          if (frame < f(tMcp + i * 0.13)) return null;
          return (
            <div
              key={t}
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * p})`,
                opacity: Math.min(1, p * 1.4),
                fontFamily: mono,
                fontSize: 22,
                color: t === "stress_test" ? C.mint : C.text,
                background: C.panel,
                border: `1px solid ${t === "stress_test" ? `${C.mint}88` : C.line}`,
                borderRadius: 999,
                padding: "10px 20px",
                whiteSpace: "nowrap",
              }}
            >
              {t}
            </div>
          );
        })}
      </AbsoluteFill>

      {[tAgents, tDomino, tDomino + 0.5].map((t, i) => (
        <Sfx key={i} src="sfx/pop.wav" at={t} volume={0.25} />
      ))}
      {TOOLS.map((_, i) => (
        <Sfx key={`t${i}`} src="sfx/pop.wav" at={tMcp + i * 0.13} volume={0.13} />
      ))}
      <Sfx src="sfx/whoosh.wav" at={tSwap - 0.25} volume={0.25} />
      <KeyClicks from={tAsk} to={tAsk + 1.3} />
      <Sfx src="sfx/pop.wav" at={tCall} volume={0.25} />
      <Sfx src="sfx/pop.wav" at={tRuns} volume={0.3} />

      {/* Phase 2: the conversation */}
      {frame >= f(tSwap) && <Chat frame={frame} enter={tSwap + 0.2} tAsk={tAsk} tCall={tCall} tRuns={tRuns} tAnswer={tAnswer} />}
    </AbsoluteFill>
  );
};

function toolPos(i: number): [number, number] {
  const col = i % 3;
  const top = i < 3;
  return [HUB.x - 330 + col * 330, top ? HUB.y - 190 : HUB.y + 190];
}

const Node: React.FC<{ frame: number; at: number; x: number; y: number; w: number; color: string; title: string; sub: string; icon: React.ReactNode; big?: boolean }> = ({
  frame,
  at,
  x,
  y,
  w,
  color,
  title,
  sub,
  icon,
  big,
}) => {
  if (frame < f(at)) return null;
  const p = pop(frame, at, 13);
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - (big ? 70 : 60),
        width: w,
        height: big ? 140 : 120,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 24px",
        borderRadius: 18,
        background: big ? `${C.mint}10` : C.panel,
        border: `1px solid ${color}${big ? "aa" : "55"}`,
        boxShadow: big ? `0 0 70px ${C.mint}26` : "0 18px 50px rgba(0,0,0,0.5)",
        opacity: Math.min(1, p * 1.4),
        transform: `scale(${0.85 + 0.15 * p})`,
      }}
    >
      <div style={{ flex: "none", display: "flex" }}>{icon}</div>
      <div>
        <div style={{ fontSize: big ? 36 : 30, fontWeight: 700, fontFamily: big ? mono : sans, color: big ? C.mint : C.text }}>{title}</div>
        <div style={{ fontSize: 20, color: C.muted, marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
};

const AgentIcon = () => (
  <svg width={50} height={50} viewBox="0 0 24 24" fill="none" stroke={C.violet} strokeWidth={1.6} strokeLinejoin="round">
    <path d="M4 5h16v11H9l-5 4z" />
    <circle cx={9} cy={10.5} r={1} fill={C.violet} />
    <circle cx={12} cy={10.5} r={1} fill={C.violet} />
    <circle cx={15} cy={10.5} r={1} fill={C.violet} />
  </svg>
);

const ApiIcon = () => (
  <svg width={50} height={50} viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth={1.6} strokeLinecap="round">
    <path d="M3 17l5-6 4 3 6-8" />
    <path d="M15 6h3v3" />
    <path d="M3 21h18" />
  </svg>
);

/** A connector with packets flowing both ways (requests out, data back). */
const Flow: React.FC<{ x1: number; y1: number; x2: number; y2: number; on: boolean; frame: number; color: string }> = ({ x1, y1, x2, y2, on, frame, color }) => {
  const dots = on
    ? Array.from({ length: 6 }, (_, k) => {
        const back = k % 2 === 1;
        const u = (((frame / 40 + k / 6) % 1) + 1) % 1;
        const v = back ? 1 - u : u;
        return <circle key={k} cx={x1 + (x2 - x1) * v} cy={y1 + (y2 - y1) * v + (back ? 7 : -7)} r={5} fill={back ? C.mint : color} opacity={Math.sin(Math.PI * u)} />;
      })
    : null;
  return (
    <g>
      <line x1={x1} y1={y1 - 7} x2={x2} y2={y2 - 7} stroke={on ? `${color}66` : "#222"} strokeWidth={2} />
      <line x1={x1} y1={y1 + 7} x2={x2} y2={y2 + 7} stroke={on ? `${C.mint}44` : "#222"} strokeWidth={2} />
      {dots}
    </g>
  );
};

const Chat: React.FC<{ frame: number; enter: number; tAsk: number; tCall: number; tRuns: number; tAnswer: number }> = ({ frame, enter, tAsk, tCall, tRuns, tAnswer }) => {
  const p = ramp(frame, enter, 0.55);
  const typed = Math.floor(interpolate(frame, [f(tAsk), f(tAsk + 1.3)], [0, QUESTION.length], CLAMP));
  const callP = pop(frame, tCall);
  const done = frame >= f(tRuns);
  const resP = ramp(frame, tRuns, 0.35);

  // Stream the answer at a steady pace.
  const answerText = ANSWER.map((a) => a.t).join("");
  const streamed = Math.floor(interpolate(frame, [f(tAnswer), f(tAnswer + 1.9)], [0, answerText.length], CLAMP));
  let left = streamed;

  return (
    <div
      style={{
        position: "absolute",
        left: 300,
        top: 56,
        width: 1320,
        height: 870,
        boxSizing: "border-box",
        borderRadius: 20,
        background: "#0e0e0e",
        border: `1px solid ${C.line}`,
        boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
        opacity: p,
        transform: `translateY(${(1 - p) * 40}px)`,
        overflow: "hidden",
      }}
    >
      <div style={{ height: 64, display: "flex", alignItems: "center", gap: 14, padding: "0 28px", borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <div style={{ fontSize: 24, fontWeight: 600 }}>Claude</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: mono, fontSize: 18, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px" }}>
          <div style={{ width: 9, height: 9, borderRadius: 5, background: C.mint, boxShadow: `0 0 10px ${C.mint}` }} />
          domino · 6 tools
        </div>
      </div>

      <div style={{ padding: "34px 40px", display: "flex", flexDirection: "column", gap: 26 }}>
        {/* User */}
        <div style={{ alignSelf: "flex-end", maxWidth: 900, fontSize: 34, lineHeight: 1.4, background: "#1d1d1d", borderRadius: 18, padding: "16px 24px", minHeight: 42, opacity: frame >= f(tAsk - 0.1) ? 1 : 0 }}>
          {QUESTION.slice(0, typed)}
          {typed < QUESTION.length && <span style={{ color: C.mint, opacity: frame % 30 < 16 ? 1 : 0 }}>▌</span>}
        </div>

        {/* Tool call */}
        {frame >= f(tCall) && (
          <div style={{ border: `1px solid ${done ? `${C.mint}55` : C.line}`, borderRadius: 16, background: C.panel, opacity: Math.min(1, callP * 1.4), transform: `translateY(${(1 - callP) * 16}px)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 24px", fontFamily: mono, fontSize: 24, whiteSpace: "nowrap" }}>
              <span style={{ color: done ? C.mint : C.amber }}>{done ? "✓" : "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(frame / 3) % 10]}</span>
              <span style={{ color: C.muted }}>domino ·</span>
              <span style={{ color: C.text, fontWeight: 600 }}>stress_test</span>
              <span style={{ color: C.dim }}>
                ({"{"} <span style={{ color: C.violet }}>shock</span>: <span style={{ color: C.amber }}>-0.15</span>, <span style={{ color: C.violet }}>symbol</span>: <span style={{ color: C.mint }}>"BTC-USD"</span> {"}"})
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ color: done ? C.mint : C.dim, fontSize: 19 }}>{done ? "done" : "replaying…"}</span>
            </div>
            {done && (
              <div style={{ borderTop: `1px solid ${C.line}`, padding: "16px 24px 18px", fontFamily: mono, fontSize: 24, lineHeight: 1.55, opacity: resP }}>
                {RESULT.map(([k, v], i) => (
                  <div key={k} style={{ opacity: ramp(frame, tRuns + i * 0.07, 0.25) }}>
                    <span style={{ color: C.violet }}>"{k}"</span>
                    <span style={{ color: C.dim }}>: </span>
                    <span style={{ color: v.startsWith('"') ? C.mint : C.amber }}>{v}</span>
                    <span style={{ color: C.dim }}>,</span>
                  </div>
                ))}
                <div style={{ color: C.dim }}>…</div>
              </div>
            )}
          </div>
        )}

        {/* Answer */}
        {frame >= f(tAnswer) && (
          <div style={{ fontSize: 36, lineHeight: 1.5, color: C.muted, maxWidth: 1220 }}>
            {ANSWER.map((a, i) => {
              const n = Math.max(0, Math.min(a.t.length, left));
              left -= a.t.length;
              return (
                <span key={i} style={{ color: a.c ?? C.muted, fontWeight: a.c ? 600 : 400 }}>
                  {a.t.slice(0, n)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
