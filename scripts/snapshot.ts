// Capture a live Strike mainnet snapshot into fixtures/ (used by tests, offline demo mode and the MCP server).
import { writeFileSync } from "node:fs";
import { fetchRawSnapshot, normalizeSnapshot, validateAgainstServed } from "@domino/engine";

const out = process.argv[2] ?? "fixtures/snapshot.json";
const raw = await fetchRawSnapshot({ onProgress: (d, t) => process.stdout.write(`\r${d}/${t}`) });
writeFileSync(out, JSON.stringify(raw));
const snap = normalizeSnapshot(raw);
const v = validateAgainstServed(snap);
const positions = snap.accounts.reduce((s, a) => s + a.positions.length, 0);
console.log(`\nwrote ${out}: ${Object.keys(snap.markets).length} markets, ${snap.accounts.length} accounts, ${positions} positions`);
console.log(`liquidation prices reproduced: ${v.matched}/${v.total} (worst error ${(v.worst * 100).toFixed(4)}%)`);
