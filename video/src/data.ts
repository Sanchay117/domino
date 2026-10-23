import factsJson from "./generated/facts.json";
import timingJson from "./generated/timing.json";

export interface TimedLine {
  file: string;
  text: string;
  start: number;
  seconds: number;
}

export interface TimedScene {
  id: string;
  start: number;
  seconds: number;
  frames: number;
  lines: TimedLine[];
}

export const timing = timingJson as { fps: number; total: number; scenes: TimedScene[] };
export const facts = factsJson;

export const sceneById = (id: string) => timing.scenes.find((s) => s.id === id)!;

import wordsJson from "./generated/words.json";

const words = wordsJson as Record<string, { w: string; start: number; end: number }[]>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$]/g, "");

/** Scene-relative seconds at which `word` (its `nth` occurrence, prefix match) is spoken in line `line` (0-based). */
export function wordAt(sceneId: string, line: number, word: string, nth = 0): number {
  const scene = sceneById(sceneId);
  const list = words[`${sceneId}-${line + 1}`] ?? [];
  const hits = list.filter((x) => norm(x.w).startsWith(norm(word)));
  const hit = hits[nth];
  if (!hit) throw new Error(`"${word}" not found in ${sceneId}-${line + 1}`);
  return scene.lines[line].start + hit.start;
}
