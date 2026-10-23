// Listens to the generated narration with Deepgram speech-to-text, to catch mispronounced abbreviations
// and numbers without a human in the loop. Prints script vs. transcript per line.

import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const key = env.match(/^\s*DEEPGRAM_API_KEY\s*=\s*"?([^"\n\r]+)"?/m)?.[1]?.trim();
if (!key) throw new Error("DEEPGRAM_API_KEY missing from .env");

const timing = JSON.parse(readFileSync(new URL("../src/generated/timing.json", import.meta.url), "utf8")) as {
  scenes: { id: string; lines: { file: string; text: string }[] }[];
};
const only = process.argv[2];

for (const scene of timing.scenes) {
  if (only && scene.id !== only) continue;
  for (const line of scene.lines) {
    const audio = readFileSync(new URL(`../public/${line.file}`, import.meta.url));
    const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
      body: audio,
    });
    const j = (await r.json()) as { results?: { channels: { alternatives: { transcript: string }[] }[] } };
    const heard = j.results?.channels[0]?.alternatives[0]?.transcript ?? `(error ${r.status})`;
    console.log(`${line.file}\n  script: ${line.text}\n  heard:  ${heard}`);
  }
}
