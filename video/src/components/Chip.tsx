import { interpolate, useCurrentFrame } from "remotion";
import { CLAMP, f, pop } from "../anim";
import { C, mono, sans } from "../theme";
import { Sfx } from "./Sfx";

/** A floating stat card that springs in at `at` seconds and fades out at `until`. */
export const Chip: React.FC<{
  x: number;
  y: number;
  at: number;
  until?: number;
  label: string;
  value: string;
  color?: string;
  width?: number;
  align?: "left" | "right";
}> = ({ x, y, at, until, label, value, color = C.mint, width = 340, align = "left" }) => {
  const frame = useCurrentFrame();
  const s = pop(frame, at);
  const out = until === undefined ? 1 : interpolate(frame, [f(until) - 8, f(until)], [1, 0], CLAMP);
  const sfx = <Sfx src="sfx/pop.wav" at={at} volume={0.22} />;
  if (frame < f(at)) return sfx;
  return (
    <>
    {sfx}
    <div
      style={{
        position: "absolute",
        left: align === "left" ? x : x - width,
        top: y,
        width,
        padding: "18px 22px",
        borderRadius: 14,
        background: "rgba(17,17,17,0.94)",
        border: `1px solid ${color}55`,
        boxShadow: `0 18px 50px rgba(0,0,0,0.55), 0 0 40px ${color}22`,
        transform: `translateY(${(1 - s) * 24}px) scale(${0.9 + 0.1 * s})`,
        opacity: Math.min(1, s * 1.4) * out,
        fontFamily: sans,
      }}
    >
      <div style={{ fontSize: 17, letterSpacing: 1.4, textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 44, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</div>
    </div>
    </>
  );
};
