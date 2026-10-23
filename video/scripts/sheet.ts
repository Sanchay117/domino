// Review helper: grabs frames from the rendered video at the given times and tiles them 2×2 into one image.
// Usage: tsx scripts/sheet.ts <name> <scene> <t1> [t2 t3 t4]   (times in seconds from the scene's start)
//        tsx scripts/sheet.ts <name> teaser <t1> [t2 t3 t4]  (times in seconds into out/teaser.mp4)

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const [name, sceneId, ...times] = process.argv.slice(2);
const timing = JSON.parse(readFileSync(new URL("../src/generated/timing.json", import.meta.url), "utf8")) as { scenes: { id: string; start: number }[] };
const scene = sceneId === "teaser" ? { start: 0 } : timing.scenes.find((s) => s.id === sceneId);
if (!scene || !times.length) throw new Error("usage: sheet.ts <name> <scene|teaser> <t1> [t2 t3 t4]");

const video = new URL(sceneId === "teaser" ? "../out/teaser.mp4" : "../out/domino.mp4", import.meta.url).pathname;
const dir = new URL("../build/review/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const frames = times.map((t) => Math.round((scene.start + Number(t)) * 30));
const select = frames.map((n) => `eq(n\\,${n})`).join("+");
const tiles = frames.length === 1 ? "1x1" : frames.length === 2 ? "2x1" : "2x2";
const scale = frames.length === 1 ? "1920:1080" : "960:540";
const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `select='${select}',scale=${scale},tile=${tiles}`, "-frames:v", "1", "-vsync", "0", `${dir}${name}.png`], { stdio: "inherit" });
if (r.status !== 0) process.exit(1);
console.log(`${dir}${name}.png  frames ${frames.join(", ")}`);
