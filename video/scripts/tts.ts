// Narration audio from Deepgram Aura-2: one WAV per line, plus a timing manifest the composition and
// the footage capture both read. The API key is read from ../.env and never printed.
// Writes public/audio/<scene>-<n>.wav and src/generated/timing.json. Lines whose text is unchanged are reused.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SCRIPT, VOICE } from "../src/narration.ts";

const FPS = 30;
const GAP = 0.32; // seconds between lines

function apiKey(): string {
  const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const key = env.match(/^\s*DEEPGRAM_API_KEY\s*=\s*"?([^"\n\r]+)"?/m)?.[1]?.trim();
  if (!key) throw new Error("DEEPGRAM_API_KEY missing from .env");
  return key;
}

/** Duration of a PCM WAV from its fmt and data chunks. */
function wavSeconds(buf: Buffer): number {
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      // Streamed WAVs can carry a placeholder size; fall back to the rest of the file.
      if (size === 0 || size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8;
      return size / byteRate;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

async function speak(key: string, text: string): Promise<Buffer> {
  const url = `https://api.deepgram.com/v1/speak?model=${VOICE}&encoding=linear16&sample_rate=48000&container=wav`;
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (attempt >= 3) throw new Error(`Deepgram ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1500 * attempt));
  }
}

const key = apiKey();
const audioDir = new URL("../public/audio/", import.meta.url);
const genDir = new URL("../src/generated/", import.meta.url);
mkdirSync(audioDir, { recursive: true });
mkdirSync(genDir, { recursive: true });
const cachePath = new URL("tts-cache.json", genDir);
const cache: Record<string, string> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const scenes = [];
let start = 0;
for (const scene of SCRIPT) {
  const lead = scene.lead ?? 0.4;
  const tail = scene.tail ?? 0.8;
  let t = lead;
  const lines = [];
  for (const [i, line] of scene.lines.entries()) {
    const file = `${scene.id}-${i + 1}.wav`;
    const say = line.say ?? line.text;
    const hash = createHash("sha256").update(`${VOICE}|${say}`).digest("hex").slice(0, 16);
    const path = new URL(file, audioDir);
    let buf: Buffer;
    if (cache[file] === hash && existsSync(path)) buf = readFileSync(path);
    else {
      buf = await speak(key, say);
      writeFileSync(path, buf);
      cache[file] = hash;
      console.log(`spoke ${file}`);
    }
    const seconds = wavSeconds(buf);
    lines.push({ file: `audio/${file}`, text: line.text, start: t, seconds });
    t += seconds + GAP;
  }
  const seconds = t - GAP + tail;
  const frames = Math.ceil(seconds * FPS);
  scenes.push({ id: scene.id, start, seconds: frames / FPS, frames, lines });
  start += frames / FPS;
}

writeFileSync(cachePath, JSON.stringify(cache, null, 2));
writeFileSync(new URL("timing.json", genDir), JSON.stringify({ fps: FPS, total: start, scenes }, null, 2));
for (const s of scenes) console.log(`${s.id.padEnd(9)} ${s.seconds.toFixed(1).padStart(5)}s  ${s.lines.map((l) => l.seconds.toFixed(1)).join(" + ")}`);
console.log(`total ${start.toFixed(1)}s`);
