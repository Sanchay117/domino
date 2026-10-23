import { usdShort } from "../anim";
import { Chip } from "../components/Chip";
import { Sfx } from "../components/Sfx";
import { Footage, Spotlight, type Cam } from "../components/Footage";
import { facts, sceneById, wordAt } from "../data";
import { C, sans } from "../theme";

const at = (id: string, line: number, offset = 0) => sceneById(id).lines[line].start + offset;
const end = (id: string) => sceneById(id).seconds;
const FULL = { scale: 1, x: 0.5, y: 0.5 };
// When the capture script clicked, in seconds from the clip's start (see scripts/capture.ts).
const CLICKS = { lab: [1.47], xray: [1.0, 1.9] };

export const Radar: React.FC = () => {
  const l2 = at("radar", 1);
  const l3 = at("radar", 2);
  const cams: Cam[] = [
    { t: 0, ...FULL },
    { t: l2 - 0.4, ...FULL },
    { t: l2 + 0.8, scale: 1.55, x: 0.3, y: 0.62 },
    { t: l3 - 0.6, scale: 1.55, x: 0.3, y: 0.62 },
    { t: l3 + 0.4, ...FULL },
    { t: l3 + 1.9, ...FULL },
    { t: l3 + 3.0, scale: 1.12, x: 0.5, y: 0.2 },
  ];
  const b = facts.btc20;
  return (
    <Footage src="clips/radar.mp4" cams={cams}>
      <Chip x={1740} y={150} at={l2 + 2.6} until={l3 - 0.4} align="right" label="Accounts hit" value={String(b.accountsHit)} color={C.text} />
      <Chip x={1740} y={320} at={l2 + 4.6} until={l3 - 0.4} align="right" label="Through the order book" value={usdShort(b.liquidatedNotional)} color={C.mint} />
      <Chip x={1740} y={490} at={l2 + 8.0} until={l3 - 0.4} align="right" label="Onto the SLP backstop" value={usdShort(b.insuranceNotional)} color={C.amber} />
    </Footage>
  );
};

export const Lab: React.FC = () => {
  const l1 = at("lab", 0);
  const l2 = at("lab", 1);
  const l3 = at("lab", 2);
  const cams: Cam[] = [
    { t: 0, ...FULL },
    { t: l1 + 1.6, ...FULL },
    { t: l1 + 2.3, scale: 1.3, x: 0.62, y: 0.1 },
    { t: l1 + 3.3, scale: 1.3, x: 0.62, y: 0.1 },
    { t: l1 + 4.2, ...FULL },
    { t: l2 + 0.2, ...FULL },
    { t: l2 + 1.4, scale: 1.18, x: 0.62, y: 0.8 },
    { t: l3 - 0.6, scale: 1.18, x: 0.62, y: 0.8 },
    { t: l3 + 0.4, ...FULL },
  ];
  return (
    <Footage src="clips/lab.mp4" cams={cams}>
      <Sfx src="sfx/key.wav" at={CLICKS.lab[0]} volume={0.5} />
    </Footage>
  );
};

export const Catch: React.FC = () => {
  const l2 = at("catch", 1);
  const l3 = at("catch", 2);
  const click = l3 + 1.5;
  const cams: Cam[] = [
    { t: 0, ...FULL },
    { t: 1.9, ...FULL },
    { t: l2 + 0.2, scale: 1.65, x: 0.19, y: 0.55 },
    // A slow push while the plan is explained.
    { t: click - 0.1, scale: 1.78, x: 0.19, y: 0.53 },
    { t: click + 0.9, ...FULL },
    { t: click + 1.8, ...FULL },
    { t: click + 2.6, scale: 1.3, x: 0.62, y: 0.12 },
  ];
  const c = facts.catch;
  return (
    <Footage
      src="clips/catch.mp4"
      cams={cams}
      overlay={(cam) => (
        <div style={{ fontFamily: sans }}>
          <Spotlight cam={cam} box={[0.099, 0.393, 0.293, 0.596]} at={wordAt("catch", 1, "prices") - 0.1} until={click - 0.25} color={C.mint} label="post-only bids at the unfilled IOC limits" />
        </div>
      )}
    >
      <Sfx src="sfx/pop.wav" at={wordAt("catch", 1, "prices") - 0.1} volume={0.22} />
      <Sfx src="sfx/key.wav" at={click} volume={0.5} />
      <Chip
        x={1740}
        y={520}
        at={click + 2.9}
        align="right"
        width={470}
        label={`SLP absorbs, with ${usdShort(c.budget)} of bids`}
        value={`${usdShort(c.before.insuranceNotional)} → ${usdShort(c.after.insuranceNotional)}`}
        color={C.amber}
      />
      <Chip
        x={1740}
        y={700}
        at={click + 3.6}
        align="right"
        width={470}
        label="Moved back onto the book"
        value={usdShort(c.after.liquidatedNotional - c.before.liquidatedNotional)}
        color={C.mint}
      />
    </Footage>
  );
};

export const XRay: React.FC = () => {
  const l2 = at("xray", 1);
  const cams: Cam[] = [
    { t: 0, ...FULL },
    { t: l2 + 1.3, ...FULL },
    { t: l2 + 2.0, scale: 1.35, x: 0.7, y: 0.32 },
    { t: l2 + 3.9, scale: 1.35, x: 0.7, y: 0.32 },
    { t: l2 + 4.8, scale: 1.45, x: 0.28, y: 0.58 },
    { t: end("xray"), scale: 1.5, x: 0.28, y: 0.58 },
  ];
  return (
    <Footage src="clips/xray.mp4" cams={cams}>
      {CLICKS.xray.map((t) => (
        <Sfx key={t} src="sfx/key.wav" at={t} volume={0.5} />
      ))}
    </Footage>
  );
};
