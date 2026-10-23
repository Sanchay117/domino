// Listens to the final mix (voice + music + effects) with Deepgram speech-to-text and reports how much of the
// script is heard, to catch music or effects masking the narration.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SCRIPT } from "../src/narration.ts";

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const key = env.match(/^\s*DEEPGRAM_API_KEY\s*=\s*"?([^"\n\r]+)"?/m)?.[1]?.trim();
if (!key) throw new Error("DEEPGRAM_API_KEY missing from .env");

const video = new URL(`../out/${process.argv[2] ?? "domino-final.mp4"}`, import.meta.url).pathname;
const wav = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", "-"], { maxBuffer: 1 << 28 });
if (wav.status !== 0) throw new Error("ffmpeg failed");

const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
  method: "POST",
  headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
  body: wav.stdout,
});
const j = (await r.json()) as { results: { channels: { alternatives: { transcript: string }[] }[] } };
const heard = j.results.channels[0].alternatives[0].transcript;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const said = SCRIPT.flatMap((s) => s.lines.map((l) => l.text)).join(" ");
const heardSet = new Map<string, number>();
for (const w of words(heard)) heardSet.set(w, (heardSet.get(w) ?? 0) + 1);
let hit = 0;
const missed: string[] = [];
for (const w of words(said)) {
  const n = heardSet.get(w) ?? 0;
  if (n > 0) {
    hit++;
    heardSet.set(w, n - 1);
  } else missed.push(w);
}
console.log(heard);
console.log(`\nscript words heard: ${hit}/${hit + missed.length} (${((100 * hit) / (hit + missed.length)).toFixed(1)}%)`);
console.log(`not heard as written: ${missed.join(" ")}`);
