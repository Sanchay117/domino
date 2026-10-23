import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { CLAMP, f, pop, ramp } from "../anim";
import { KeyClicks, Sfx } from "../components/Sfx";
import { facts, sceneById, wordAt } from "../data";
import guardian from "../generated/guardian.json";
import { C, mono, sans } from "../theme";

// Terminal geometry (composition pixels).
const T = { x: 135, y: 46, w: 1650, h: 880, bar: 46, padX: 38, padY: 30 };
const FONT = 24;
const LH = 36;
const CH = FONT * 0.6; // IBM Plex Mono advance width

const short = (s: string) => s.replace(/[0-9a-f]{40,}/g, (h) => `${h.slice(0, 14)}…${h.slice(-8)}`);
const addr = facts.xray.address as string;
const CMD = [
  `npm run guardian -- protect --address ${addr.slice(0, 12)}…${addr.slice(-7)} \\`,
  `    --survive 15 --watch 30 --builder-fee 5 --max-order 50000`,
];

type Kind = "title" | "thead" | "row" | "note" | "http" | "header" | "json" | "watch" | "blank";
interface Out {
  kind: Kind;
  text: string;
}

/** The real CLI output, split into display rows: hex shortened, the JSON body spread over three rows. */
function outputRows(): Out[] {
  const rows: Out[] = [];
  for (const raw of (guardian.text as string).split("\n")) {
    const line = raw.trimEnd();
    if (!line) rows.push({ kind: "blank", text: "" });
    else if (line.startsWith("Guardian")) rows.push({ kind: "title", text: line });
    else if (line.trim().startsWith("market")) rows.push({ kind: "thead", text: line });
    else if (line.trim().startsWith("WTI")) rows.push({ kind: "row", text: line });
    else if (line.startsWith("Signed")) rows.push({ kind: "note", text: line });
    else if (line.startsWith("POST")) rows.push({ kind: "http", text: line });
    else if (/^[A-Za-z-]+: /.test(line)) rows.push({ kind: "header", text: short(line) });
    else if (line.startsWith("{")) {
      const o = JSON.parse(line) as Record<string, unknown>;
      const kv = (k: string) => `"${k}": ${JSON.stringify(o[k])}`;
      rows.push({ kind: "json", text: `{${kv("symbol")}, ${kv("side")}, ${kv("type")},` });
      rows.push({ kind: "json", text: ` ${kv("size")}, ${kv("reduce_only")},` });
      rows.push({ kind: "json", text: ` ${kv("client_order_id")}}` });
    } else rows.push({ kind: "watch", text: line });
  }
  return rows;
}

const ROWS = outputRows();
const rowIndex = (pred: (r: Out) => boolean) => ROWS.findIndex(pred);
const iRow = rowIndex((r) => r.kind === "row");
const iSig = rowIndex((r) => r.text.startsWith("X-API-Wallet-Signature"));
const iFee = rowIndex((r) => r.text.startsWith("X-Builder-Fee-Bps"));
const iWatch = rowIndex((r) => r.kind === "watch");

// Output rows start two rows below the command.
const rowY = (i: number) => T.y + T.bar + T.padY + (CMD.length + 1 + i) * LH;
const colX = (c: number) => T.x + T.padX + c * CH;

export const Guardian: React.FC = () => {
  const frame = useCurrentFrame();
  const s = sceneById("guardian");
  const typeStart = s.lines[0].start + 0.05;
  const typeEnd = s.lines[0].start + 1.85;
  const enter = wordAt("guardian", 0, "bot") + 0.2;
  const tReduce = wordAt("guardian", 1, "reduce") - 0.15;
  const tSigned = wordAt("guardian", 1, "with") - 0.1;
  const tFee = wordAt("guardian", 1, "builder") - 0.15;
  const tWatch = wordAt("guardian", 1, "keeps") - 0.15;

  // When each output row is printed: a fast burst, as a CLI would.
  const printedAt = (i: number) => (i <= iRow ? enter + 0.1 + i * 0.09 : i < iWatch - 1 ? enter + 0.55 + (i - iRow) * 0.06 : tWatch);

  const win = ramp(frame, 0, 0.45);
  const cmdChars = CMD.join("").length;
  const typed = Math.floor(interpolate(frame, [f(typeStart), f(typeEnd)], [0, cmdChars], CLAMP));
  const drift = interpolate(frame, [0, s.frames], [1, 1.035]);

  let left = typed;
  const cmdShown = CMD.map((l) => {
    const n = Math.max(0, Math.min(l.length, left));
    left -= l.length;
    return l.slice(0, n);
  });
  const cursorRow = typed < CMD[0].length ? 0 : 1;
  const ran = frame >= f(enter);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 50% 45%, #0f1713 0%, ${C.bg} 75%)` }}>
      <AbsoluteFill style={{ transform: `scale(${drift})`, transformOrigin: "40% 40%" }}>
        {/* Window */}
        <div
          style={{
            position: "absolute",
            left: T.x,
            top: T.y,
            width: T.w,
            height: T.h,
            borderRadius: 16,
            background: "#0c0c0c",
            border: `1px solid ${C.line}`,
            boxShadow: "0 30px 90px rgba(0,0,0,0.65), 0 0 120px rgba(78,250,176,0.06)",
            opacity: win,
            transform: `translateY(${(1 - win) * 20}px)`,
            overflow: "hidden",
          }}
        >
          <div style={{ height: T.bar, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", borderBottom: `1px solid ${C.line}`, background: C.panel }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c, opacity: 0.85 }} />
            ))}
            <div style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: 17, color: C.muted, marginRight: 60 }}>domino · guardian</div>
          </div>
        </div>

        {/* Command */}
        <div style={{ position: "absolute", left: T.x + T.padX, top: T.y + T.bar + T.padY, fontFamily: mono, fontSize: FONT, lineHeight: `${LH}px`, whiteSpace: "pre", opacity: win }}>
          {cmdShown.map((l, i) => (
            <div key={i} style={{ height: LH }}>
              {i === 0 && <span style={{ color: C.mint }}>$ </span>}
              {i === 1 && <span>{"  "}</span>}
              {colorCmd(l)}
              {!ran && i === cursorRow && <Cursor frame={frame} />}
            </div>
          ))}
        </div>

        {/* Output */}
        {ROWS.map((r, i) => {
          const at = printedAt(i);
          if (frame < f(at) || r.kind === "blank") return null;
          return (
            <div key={i} style={{ position: "absolute", left: T.x + T.padX, top: rowY(i), fontFamily: mono, fontSize: FONT, lineHeight: `${LH}px`, whiteSpace: "pre", color: C.text }}>
              {renderRow(r, i, frame, at)}
            </div>
          );
        })}

        {/* Highlights behind the rows the narration is about */}
        <Highlight frame={frame} at={tReduce} x={colX(ROWS[iRow].text.indexOf("reduce"))} y={rowY(iRow)} w={CH * "reduce 362.11 (35.2%, $36k)".length} color={C.mint} />
        <Highlight frame={frame} at={tSigned} x={colX(0)} y={rowY(iSig)} w={CH * ROWS[iSig].text.length} color={C.violet} />
        <Highlight frame={frame} at={tFee} x={colX(0)} y={rowY(iFee)} w={CH * ROWS[iFee].text.length} color={C.amber} />

        {/* Callouts */}
        <Callout frame={frame} at={tReduce + 0.1} x={1290} y={rowY(iRow) + 70} from={[colX(ROWS[iRow].text.indexOf("reduce")) + 200, rowY(iRow) + LH]} color={C.mint} label="Reduce-only market order" value="cut 35% of the WTI long" />
        <Callout frame={frame} at={tSigned + 0.1} x={1290} y={rowY(iSig) + 8} from={[colX(ROWS[iSig].text.length) + 14, rowY(iSig) + LH / 2]} color={C.violet} label="Ed25519 signature" value="your Strike API wallet" />
        <Callout frame={frame} at={tFee + 0.1} x={1290} y={rowY(iFee) - 18} from={[colX(ROWS[iFee].text.length) + 14, rowY(iFee) + LH / 2]} color={C.amber} label="Builder fee" value="5 bps on every order" />
        <Callout
          frame={frame}
          at={tWatch + 0.15}
          x={1290}
          y={rowY(iWatch) - 68}
          from={[colX(ROWS[iWatch].text.length + 2) + 14, rowY(iWatch) + LH / 2]}
          color={C.mint}
          label="Watch mode"
          value={`re-checks in ${Math.max(0, 30 - Math.floor((frame - f(tWatch)) / 30))}s`}
        />
      </AbsoluteFill>

      <KeyClicks from={typeStart} to={typeEnd} />
      <Sfx src="sfx/key.wav" at={enter - 0.05} volume={0.4} />
      {[tReduce, tSigned, tFee, tWatch + 0.05].map((t, i) => (
        <Sfx key={i} src="sfx/pop.wav" at={t + 0.1} volume={0.12} />
      ))}
    </AbsoluteFill>
  );
};

const Cursor: React.FC<{ frame: number }> = ({ frame }) => <span style={{ background: C.mint, color: C.mint, opacity: frame % 30 < 16 ? 1 : 0 }}>▌</span>;

function colorCmd(l: string): React.ReactNode[] {
  return l.split(/(\s+)/).map((tok, k) => {
    const color = tok.startsWith("--") ? C.violet : /^\d+$/.test(tok) ? C.amber : tok.startsWith("addr1") ? C.mint : tok === "\\" ? C.dim : C.text;
    return (
      <span key={k} style={{ color }}>
        {tok}
      </span>
    );
  });
}

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const HEX = "0123456789abcdef";

function renderRow(r: Out, i: number, frame: number, at: number): React.ReactNode {
  switch (r.kind) {
    case "title": {
      const [head, mode] = r.text.split(/ (dry run|live)$/);
      return (
        <>
          <span style={{ color: C.mint, fontWeight: 600 }}>{head.slice(0, 8)}</span>
          <span style={{ color: C.muted }}>{head.slice(8)}</span>
          <span style={{ color: C.bg, background: C.amber, borderRadius: 6, padding: "1px 8px", marginLeft: 12, fontSize: FONT - 3 }}>{mode}</span>
        </>
      );
    }
    case "thead":
      return <span style={{ color: C.dim }}>{r.text}</span>;
    case "row":
      return r.text.split(/(−[\d.]+%|reduce .*$)/).map((p, k) => (
        <span key={k} style={{ color: p.startsWith("−") ? C.red : p.startsWith("reduce") ? C.mint : C.text, fontWeight: p.startsWith("reduce") ? 600 : 400 }}>
          {p}
        </span>
      ));
    case "note":
      return <span style={{ color: C.amber }}>{r.text}</span>;
    case "http": {
      const [verb, url] = r.text.split(" ");
      return (
        <>
          <span style={{ color: C.violet, fontWeight: 600 }}>{verb}</span> <span>{url}</span>
        </>
      );
    }
    case "header": {
      const k = r.text.indexOf(": ");
      let value = r.text.slice(k + 2);
      // The signature "computes" for a moment before settling.
      if (r.text.startsWith("X-API-Wallet-Signature")) {
        const settle = interpolate(frame, [f(at), f(at + 0.7)], [0, value.length], CLAMP);
        value = [...value].map((ch, j) => (j < settle || ch === "…" ? ch : HEX[Math.floor(random(`h${j}-${frame}`) * 16)])).join("");
      }
      return (
        <>
          <span style={{ color: C.muted }}>{r.text.slice(0, k + 1)}</span> <span style={{ color: C.text }}>{value}</span>
        </>
      );
    }
    case "json":
      return r.text.split(/("[^"]*"(?=:)|"[^"]*"|true|false)/).map((p, k, all) => {
        const isKey = p.startsWith('"') && all[k + 1]?.startsWith(":");
        const color = isKey ? C.violet : p.startsWith('"') ? C.mint : p === "true" || p === "false" ? C.amber : C.muted;
        return (
          <span key={k} style={{ color }}>
            {p}
          </span>
        );
      });
    case "watch": {
      const n = Math.max(0, 30 - Math.floor((frame - f(at)) / 30));
      return (
        <span style={{ color: C.muted }}>
          <span style={{ color: C.mint }}>{SPIN[Math.floor(frame / 3) % SPIN.length]} </span>
          {r.text.replace("30s", `${n}s`)}
        </span>
      );
    }
    default:
      return null;
  }
}

const Highlight: React.FC<{ frame: number; at: number; x: number; y: number; w: number; color: string }> = ({ frame, at, x, y, w, color }) => {
  const u = ramp(frame, at, 0.45);
  if (u <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x - 8,
        top: y + 1,
        width: (w + 16) * u,
        height: LH - 2,
        borderRadius: 6,
        background: `${color}1f`,
        borderBottom: `2px solid ${color}aa`,
        mixBlendMode: "screen",
      }}
    />
  );
};

/** An annotation card on the right with an elbow connector back to the row it explains. */
const Callout: React.FC<{ frame: number; at: number; x: number; y: number; from: [number, number]; color: string; label: string; value: string }> = ({
  frame,
  at,
  x,
  y,
  from,
  color,
  label,
  value,
}) => {
  if (frame < f(at)) return null;
  const p = pop(frame, at);
  const draw = ramp(frame, at, 0.35);
  const H = 92;
  const ty = y + H / 2;
  const d = `M${from[0]},${from[1]} L${from[0] + 24},${from[1]} L${from[0] + 24},${ty} L${x},${ty}`;
  const len = Math.abs(ty - from[1]) + (x - from[0]);
  return (
    <>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
        <path d={d} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={2} strokeDasharray={len + 30} strokeDashoffset={(len + 30) * (1 - draw)} />
        <circle cx={from[0]} cy={from[1]} r={4} fill={color} opacity={draw} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: 430,
          height: H,
          boxSizing: "border-box",
          padding: "14px 20px",
          borderRadius: 14,
          background: "rgba(17,17,17,0.96)",
          border: `1px solid ${color}66`,
          boxShadow: `0 16px 40px rgba(0,0,0,0.5), 0 0 36px ${color}22`,
          opacity: Math.min(1, p * 1.4),
          transform: `translateX(${(1 - p) * 26}px)`,
          fontFamily: sans,
        }}
      >
        <div style={{ fontSize: 16, letterSpacing: 1.3, textTransform: "uppercase", color: C.muted }}>{label}</div>
        <div style={{ fontSize: 30, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
      </div>
    </>
  );
};
