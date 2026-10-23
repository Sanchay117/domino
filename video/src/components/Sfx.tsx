import { Audio, Sequence, staticFile } from "remotion";
import { f } from "../anim";

/** A one-shot sound at `at` seconds (relative to the enclosing scene). */
export const Sfx: React.FC<{ src: string; at: number; volume?: number }> = ({ src, at, volume = 1 }) => (
  <Sequence from={f(at)} layout="none">
    <Audio src={staticFile(src)} volume={volume} />
  </Sequence>
);

/** One of the five domino-click pitches, picked by a stable index. */
export const tock = (i: number) => `sfx/tock-${(((i * 7) % 5) + 5) % 5 + 1}.wav`;

/** Soft key clicks every `every` frames between two times, for text being typed. */
export const KeyClicks: React.FC<{ from: number; to: number; every?: number; volume?: number }> = ({ from, to, every = 2, volume = 0.14 }) => {
  const out: React.ReactNode[] = [];
  for (let fr = f(from), k = 0; fr < f(to); fr += every, k++) {
    out.push(
      <Sequence key={fr} from={fr} layout="none">
        <Audio src={staticFile("sfx/key.wav")} volume={volume * (k % 3 === 0 ? 1 : k % 3 === 1 ? 0.7 : 0.85)} />
      </Sequence>,
    );
  }
  return <>{out}</>;
};
