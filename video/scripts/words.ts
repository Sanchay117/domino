// Word-level timestamps for every narration line (Deepgram nova-3), so motion graphics can land on the
// exact word being spoken. Cached by audio file hash. Writes src/generated/words.json:
// { "<scene>-<n>": [{ w, start, end }] } with times in seconds from the start of that line's audio.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const key = env.match(/^\s*DEEPGRAM_API_KEY\s*=\s*"?([^"\n\r]+)"?/m)?.[1]?.trim();
if (!key) throw new Error("DEEPGRAM_API_KEY missing from .env");

const timing = JSON.parse(readFileSync(new URL("../src/generated/timing.json", import.meta.url), "utf8")) as {
  scenes: { id: string; lines: { file: string }[] }[];
};
const outUrl = new URL("../src/generated/words.json", import.meta.url);
const cacheUrl = new URL("../src/generated/words-cache.json", import.meta.url);
const cache: Record<string, Word[]> = existsSync(cacheUrl) ? JSON.parse(readFileSync(cacheUrl, "utf8")) : {};

interface Word {
  w: string;
  start: number;
  end: number;
}

const out: Record<string, Word[]> = {};
for (const scene of timing.scenes) {
  for (const [i, line] of scene.lines.entries()) {
    const audio = readFileSync(new URL(`../public/${line.file}`, import.meta.url));
    const hash = createHash("sha256").update(audio).digest("hex");
    if (!cache[hash]) {
      const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
        body: audio,
      });
      if (!r.ok) throw new Error(`Deepgram ${r.status} for ${line.file}`);
      const j = (await r.json()) as { results: { channels: { alternatives: { words: { punctuated_word: string; start: number; end: number }[] }[] }[] } };
      cache[hash] = j.results.channels[0].alternatives[0].words.map((x) => ({ w: x.punctuated_word, start: x.start, end: x.end }));
    }
    out[`${scene.id}-${i + 1}`] = cache[hash];
  }
}
writeFileSync(cacheUrl, JSON.stringify(cache));
writeFileSync(outUrl, JSON.stringify(out, null, 1));
for (const [k, ws] of Object.entries(out)) console.log(k.padEnd(12), ws.map((x) => `${x.w}@${x.start.toFixed(2)}`).join(" "));
