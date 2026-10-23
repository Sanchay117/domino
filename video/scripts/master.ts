// Final mastering: two-pass EBU R128 loudness normalisation of the rendered video's audio to −16 LUFS
// (true peak −1.5 dBTP), video stream copied untouched. out/<name>.mp4 → out/<name>-final.mp4, name defaults to domino.

import { spawnSync } from "node:child_process";

const name = process.argv[2] ?? "domino";
const input = new URL(`../out/${name}.mp4`, import.meta.url).pathname;
const output = new URL(`../out/${name}-final.mp4`, import.meta.url).pathname;
const TARGET = "I=-16:TP=-1.5:LRA=11";

const measure = spawnSync("ffmpeg", ["-hide_banner", "-i", input, "-af", `loudnorm=${TARGET}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const json = measure.stderr.slice(measure.stderr.lastIndexOf("{"), measure.stderr.lastIndexOf("}") + 1);
const m = JSON.parse(json) as Record<string, string>;
console.log(`measured: ${m.input_i} LUFS, true peak ${m.input_tp} dBTP, LRA ${m.input_lra}`);

const filter = `loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const r = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af", filter, "-ar", "48000", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(1);

const check = spawnSync("ffmpeg", ["-hide_banner", "-i", output, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
const summary = check.stderr.slice(check.stderr.lastIndexOf("Summary:"));
console.log(`wrote ${output}\n${summary.split("\n").filter((l) => /I:|Peak:/.test(l)).join("\n")}`);
