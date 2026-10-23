import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { CLAMP, f, ramp } from "../anim";
import { C } from "../theme";

/** A camera keyframe: at `t` seconds, zoom `scale` towards the point (`x`, `y`), as fractions of the footage. */
export interface Cam {
  t: number;
  scale: number;
  x: number;
  y: number;
}

// The app footage sits in a window above the caption band.
export const WIN = { x: 135, y: 30, w: 1650, h: 928 };

/** Map a point in footage fractions to composition pixels for a given camera state (for overlays that track the UI). */
export function project(cam: { scale: number; x: number; y: number }, px: number, py: number): [number, number] {
  const ox = cam.x * WIN.w;
  const oy = cam.y * WIN.h;
  return [WIN.x + ox + (px * WIN.w - ox) * cam.scale, WIN.y + oy + (py * WIN.h - oy) * cam.scale];
}

export function camAt(cams: Cam[], frame: number): { scale: number; x: number; y: number } {
  if (frame <= f(cams[0].t)) return cams[0];
  for (let i = 1; i < cams.length; i++) {
    const a = cams[i - 1];
    const b = cams[i];
    if (frame <= f(b.t)) {
      const u = interpolate(frame, [f(a.t), f(b.t)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
      return { scale: a.scale + (b.scale - a.scale) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return cams[cams.length - 1];
}

export const Footage: React.FC<{ src: string; cams: Cam[]; children?: React.ReactNode; overlay?: (cam: { scale: number; x: number; y: number }) => React.ReactNode }> = ({
  src,
  cams,
  children,
  overlay,
}) => {
  const frame = useCurrentFrame();
  const cam = camAt(cams, frame);
  const enter = ramp(frame, 0, 0.5);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.h,
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${C.line}`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(78,250,176,0.05), 0 0 120px rgba(78,250,176,0.07)",
          opacity: enter,
          transform: `scale(${0.97 + 0.03 * enter})`,
        }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          muted
          style={{ width: "100%", height: "100%", transformOrigin: `${cam.x * 100}% ${cam.y * 100}%`, transform: `scale(${cam.scale})` }}
        />
      </div>
      {overlay?.(cam)}
      {children}
    </AbsoluteFill>
  );
};

/** A glowing frame around a region of the footage (in footage fractions) that follows the camera. */
export const Spotlight: React.FC<{ cam: { scale: number; x: number; y: number }; box: [number, number, number, number]; at: number; until: number; color: string; label?: string }> = ({
  cam,
  box,
  at,
  until,
  color,
  label,
}) => {
  const frame = useCurrentFrame();
  const inn = ramp(frame, at, 0.4);
  const out = interpolate(frame, [f(until) - 9, f(until)], [1, 0], CLAMP);
  if (inn <= 0 || out <= 0) return null;
  const [x0, y0] = project(cam, box[0], box[1]);
  const [x1, y1] = project(cam, box[2], box[3]);
  const grow = (1 - inn) * 14;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x0 - grow,
          top: y0 - grow,
          width: x1 - x0 + 2 * grow,
          height: y1 - y0 + 2 * grow,
          borderRadius: 14,
          border: `2px solid ${color}`,
          boxShadow: `0 0 0 9999px rgba(0,0,0,${0.38 * inn * out}), 0 0 40px ${color}55, inset 0 0 30px ${color}22`,
          opacity: inn * out,
        }}
      />
      {label && (
        <div
          style={{
            position: "absolute",
            left: x0,
            top: y1 + 14,
            fontFamily: "inherit",
            fontSize: 24,
            fontWeight: 600,
            color: C.bg,
            background: color,
            borderRadius: 8,
            padding: "6px 14px",
            opacity: inn * out,
            transform: `translateY(${(1 - inn) * 10}px)`,
          }}
        >
          {label}
        </div>
      )}
    </>
  );
};
