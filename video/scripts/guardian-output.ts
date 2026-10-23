// Real Guardian output for the terminal scene: a dry run of `protect` on the showcase wallet, signed by a
// freshly generated test API wallet (so the CLI takes the same path as with a user's own keys).
// Writes src/generated/guardian.json ({ text }).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { generateApiWallet } from "../../packages/engine/src/index.ts";

const facts = JSON.parse(readFileSync(new URL("../src/generated/facts.json", import.meta.url), "utf8"));
const wallet = generateApiWallet();
const root = new URL("../../", import.meta.url).pathname;
const args = ["tsx", "apps/guardian/src/cli.ts", "protect", "--fixture", "fixtures/snapshot.json", "--address", facts.xray.address, "--survive", "15", "--builder-fee", "5", "--max-order", "50000"];
const r = spawnSync("npx", args, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1", STRIKE_API_PUBLIC_KEY: wallet.publicKeyHex, STRIKE_API_PRIVATE_KEY: wallet.privateKeyHex },
});
if (r.status !== 0) throw new Error(r.stderr);
// With --watch the loop then prints this line and sleeps; the scene shows the command with --watch 30.
const out = `${r.stdout.trim()}\n\nnext check in 30s · Ctrl-C to stop\n`;
writeFileSync(new URL("../src/generated/guardian.json", import.meta.url), JSON.stringify({ text: out }, null, 1));
console.log(out);
