import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { CLAMP, f } from "./anim";
import { Captions } from "./components/Captions";
import { timing, type TimedScene } from "./data";
import { Engine } from "./scenes/Engine";
import { Catch, Lab, Radar, XRay } from "./scenes/FootageScenes";
import { Guardian } from "./scenes/Guardian";
import { Mcp } from "./scenes/Mcp";
import { Open } from "./scenes/Open";
import { Outro } from "./scenes/Outro";
import { Proof } from "./scenes/Proof";
import { C, FPS } from "./theme";

const SCENES: Record<string, React.FC> = {
  open: Open,
  engine: Engine,
  proof: Proof,
  radar: Radar,
  lab: Lab,
  catch: Catch,
  xray: XRay,
  guardian: Guardian,
  mcp: Mcp,
  outro: Outro,
};

/** Fades each scene in and out over a few frames so cuts between them dip softly through the background. */
const Fade: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 7, frames - 7, frames], [0, 1, 1, 0], CLAMP);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// Lines whose words are already on screen as a headline.
const NO_CAPTION = new Set(["audio/outro-2.wav"]);

const STARTS = timing.scenes.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + timing.scenes[i - 1].frames], []);
const VOICE = timing.scenes.flatMap((s, i) => s.lines.map((l) => [STARTS[i] / FPS + l.start, STARTS[i] / FPS + l.start + l.seconds] as const));
const LAST_WORD = VOICE[VOICE.length - 1][1];

/** Music sits under the voice: ducked while a line is spoken, up a little in the gaps and after the last line. */
function musicVolume(frame: number): number {
  const t = frame / FPS;
  let duck = 0;
  for (const [a, b] of VOICE) {
    if (t < a - 0.35 || t > b + 0.5) continue;
    duck = Math.max(duck, Math.min(1, (t - (a - 0.35)) / 0.35, (b + 0.5 - t) / 0.5));
  }
  const tail = interpolate(t, [LAST_WORD, LAST_WORD + 1], [0, 1], CLAMP);
  return 0.15 - 0.08 * duck + 0.08 * tail;
}

const Scene: React.FC<{ scene: TimedScene }> = ({ scene }) => {
  const Comp = SCENES[scene.id];
  return (
    <>
      <Fade frames={scene.frames}>
        <Comp />
      </Fade>
      <Captions scene={scene} skip={NO_CAPTION} />
      {scene.lines.map((l) => (
        <Sequence key={l.file} from={f(l.start)} layout="none">
          <Audio src={staticFile(l.file)} />
        </Sequence>
      ))}
    </>
  );
};

export const Video: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {timing.scenes.map((s, i) => (
      <Sequence key={s.id} from={STARTS[i]} durationInFrames={s.frames} name={s.id}>
        <Scene scene={s} />
      </Sequence>
    ))}
    {/* A soft whoosh across each cut */}
    {STARTS.slice(1).map((st) => (
      <Sequence key={st} from={st - f(0.45)} durationInFrames={f(0.9)} layout="none">
        <Audio src={staticFile("sfx/whoosh.wav")} volume={0.12} />
      </Sequence>
    ))}
    <Audio src={staticFile("music/bed.wav")} volume={musicVolume} />
  </AbsoluteFill>
);

export const TOTAL_FRAMES = timing.scenes.reduce((n, s) => n + s.frames, 0);
