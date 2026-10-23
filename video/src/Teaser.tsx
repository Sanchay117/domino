import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp } from "./anim";
import { LogoMark } from "./components/Logo";
import { facts } from "./data";
import { Guardian } from "./scenes/Guardian";
import { Mcp } from "./scenes/Mcp";
import { Open } from "./scenes/Open";
import { Outro } from "./scenes/Outro";
import { Catch, Lab, Radar } from "./scenes/FootageScenes";
import { TEASER } from "./teaserPlan";
import { C, FPS, mono, sans } from "./theme";

// A 35-second cut for social: type cards on the beat between moments of the real scenes. Every boundary
// below sits on the 120 BPM grid in teaserPlan.ts, which the music shares.

type Beat =
  | { kind: "scene"; at: number; dur: number; comp: React.FC; from: number; label?: string }
  | { kind: "type"; at: number; dur: number; lines: (string | [string])[] }
  | { kind: "logo"; at: number; dur: number }
  | { kind: "proof"; at: number; dur: number };

const BEATS: Beat[] = [
  { kind: "scene", at: 0, dur: TEASER.drop, comp: Open, from: 1.2 },
  { kind: "type", at: TEASER.drop, dur: 1.5, lines: ["A liquidation is", ["never just one."]] },
  { kind: "logo", at: 5, dur: 2 },
  { kind: "proof", at: 7, dur: 2 },
  { kind: "type", at: 9, dur: 1, lines: ["Replay ", ["any crash."]] },
  { kind: "scene", at: 10, dur: 3, comp: Radar, from: 13.4, label: "Risk Radar · BTC-led crash, −20%" },
  { kind: "type", at: 13, dur: 1, lines: ["Watch it ", ["cascade."]] },
  { kind: "scene", at: 14, dur: 3, comp: Lab, from: 8.6, label: "Cascade Lab · one mark-price batch per second" },
  { kind: "type", at: 17, dur: 1, lines: ["Catch ", ["the flow."]] },
  { kind: "scene", at: 18, dur: 3, comp: Catch, from: 12.4, label: "Catch · post-only bids where the IOCs run dry" },
  { kind: "type", at: 21, dur: 1, lines: ["Guard ", ["any wallet."]] },
  { kind: "scene", at: 22, dur: 3, comp: Guardian, from: 6.4, label: "Guardian bot · signed reduce-only orders" },
  { kind: "type", at: 25, dur: 1, lines: ["Ask ", ["your agent."]] },
  { kind: "scene", at: 26, dur: 3, comp: Mcp, from: 9.7, label: "MCP server · six tools for AI agents" },
  { kind: "scene", at: TEASER.end, dur: TEASER.seconds - TEASER.end, comp: Outro, from: 7.1 },
];

// Narration reused from the full demo: the opening line under the dominoes, the tagline on the end card.
const VO = [
  { file: "audio/open-1.wav", at: 0.3, dur: 4.84 },
  { file: "audio/outro-2.wav", at: TEASER.end + (8.18 - 7.1), dur: 2.32 },
];

function musicVolume(frame: number): number {
  const t = frame / FPS;
  let duck = 0;
  for (const v of VO) {
    if (t < v.at - 0.2 || t > v.at + v.dur + 0.3) continue;
    duck = Math.max(duck, Math.min(1, (t - (v.at - 0.2)) / 0.2, (v.at + v.dur + 0.3 - t) / 0.3));
  }
  return 0.8 - 0.4 * duck;
}

export const TEASER_FRAMES = f(TEASER.seconds);

export const Teaser: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {BEATS.map((b, i) => (
      <Sequence key={i} from={f(b.at)} durationInFrames={f(b.dur)} name={b.kind === "type" ? "type" : b.kind}>
        {b.kind === "scene" ? (
          <>
            <Sequence from={-f(b.from)}>
              <b.comp />
            </Sequence>
            {b.label && <Label text={b.label} />}
          </>
        ) : b.kind === "type" ? (
          <TypeCard lines={b.lines} />
        ) : b.kind === "logo" ? (
          <LogoCard />
        ) : (
          <ProofCard />
        )}
        {i > 0 && <CutFlash />}
      </Sequence>
    ))}
    <Audio src={staticFile("music/teaser.wav")} volume={musicVolume} />
    {VO.map((v) => (
      <Sequence key={v.file} from={f(v.at)} layout="none">
        <Audio src={staticFile(v.file)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

/** A quick mint flash on every cut, so the edit hits with the drums. */
const CutFlash: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 5], [0.16, 0], CLAMP);
  return o > 0 ? <AbsoluteFill style={{ background: C.mint, opacity: o, pointerEvents: "none" }} /> : null;
};

const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1100px 650px at 50% 50%, #10201a 0%, ${C.bg} 70%)`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: sans,
        color: C.text,
      }}
    >
      <div style={{ transform: `scale(${1 + frame * 0.0012})` }}>{children}</div>
    </AbsoluteFill>
  );
};

/** Big type, one word at a time. A line wrapped in [ ] is the mint accent. */
const TypeCard: React.FC<{ lines: (string | [string])[] }> = ({ lines }) => {
  const frame = useCurrentFrame();
  let k = 0;
  const twoLines = lines.length > 1 && typeof lines[0] === "string" && !lines[0].endsWith(" ");
  return (
    <Backdrop>
      <div style={{ textAlign: "center", fontSize: twoLines ? 128 : 150, fontWeight: 700, letterSpacing: -5, lineHeight: 1.04 }}>
        {(twoLines ? lines.map((l) => [l]) : [lines]).map((row, r) => (
          <div key={r}>
            {row.map((part) => {
              const accent = Array.isArray(part);
              const text = accent ? part[0] : part;
              return text
                .split(/(\s+)/)
                .filter(Boolean)
                .map((w, j) => {
                  if (/^\s+$/.test(w)) return <span key={`${r}-${j}`}> </span>;
                  const s = spring({ frame: frame - 2 * k++, fps: FPS, config: { damping: 15, mass: 0.5 } });
                  return (
                    <span
                      key={`${r}-${j}`}
                      style={{ display: "inline-block", color: accent ? C.mint : C.text, opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 50}px)` }}
                    >
                      {w}
                    </span>
                  );
                });
            })}
          </div>
        ))}
      </div>
    </Backdrop>
  );
};

const LogoCard: React.FC = () => {
  const frame = useCurrentFrame();
  const p = pop(frame, 0, 13);
  const tip = interpolate(frame, [6, 20], [0, 1], { ...CLAMP, easing: Easing.out(Easing.back(2)) });
  const sub = ramp(frame, 0.45, 0.4);
  return (
    <Backdrop>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36, transform: `scale(${0.8 + 0.2 * p})`, opacity: Math.min(1, p * 1.4) }}>
          <LogoMark size={190} tip={tip} />
          <div style={{ fontSize: 196, fontWeight: 700, letterSpacing: -6 }}>Domino</div>
        </div>
        <div style={{ marginTop: 18, fontSize: 46, color: C.muted, opacity: sub, transform: `translateY(${(1 - sub) * 14}px)` }}>
          The liquidation-cascade lab for <span style={{ color: C.text, fontWeight: 600 }}>Strike Finance</span>
        </div>
      </div>
    </Backdrop>
  );
};

const ProofCard: React.FC = () => {
  const frame = useCurrentFrame();
  const total = facts.validation.total;
  const n = Math.round(interpolate(frame, [2, 26], [0, facts.validation.matched], { ...CLAMP, easing: Easing.out(Easing.cubic) }));
  const done = n === total;
  const badge = pop(frame, 0.95, 12);
  return (
    <Backdrop>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: mono, fontSize: 230, fontWeight: 600, lineHeight: 1, color: done ? C.mint : C.text, letterSpacing: -6 }}>
          {n}
          <span style={{ color: C.dim, fontSize: 120 }}> / {total}</span>
        </div>
        <div style={{ marginTop: 24, fontSize: 46, color: C.muted }}>Strike liquidation prices, recomputed from public data</div>
        {frame >= f(0.95) && (
          <div
            style={{
              marginTop: 28,
              fontSize: 54,
              fontWeight: 700,
              color: C.bg,
              background: C.mint,
              borderRadius: 14,
              padding: "6px 26px",
              transform: `scale(${0.8 + 0.2 * badge})`,
              opacity: Math.min(1, badge * 1.4),
            }}
          >
            Exactly.
          </div>
        )}
      </div>
    </Backdrop>
  );
};

/** The product name in the band under the footage. */
const Label: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const p = ramp(frame, 0.1, 0.35);
  const [name, rest] = text.split(" · ");
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 34, pointerEvents: "none" }}>
      <div
        style={{
          fontFamily: sans,
          fontSize: 34,
          padding: "10px 26px",
          borderRadius: 999,
          background: "rgba(10,10,10,0.85)",
          border: `1px solid ${C.mint}55`,
          opacity: p,
          transform: `translateY(${(1 - p) * 14}px)`,
        }}
      >
        <span style={{ color: C.mint, fontWeight: 700 }}>{name}</span>
        {rest && <span style={{ color: C.muted }}> · {rest}</span>}
      </div>
    </AbsoluteFill>
  );
};
