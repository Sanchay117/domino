// Shared setup: load a snapshot (live, or a saved fixture for reproducible runs) and build the API client.

import { readFileSync } from "node:fs";
import { generateApiWallet, loadSnapshot, MAINNET, normalizeSnapshot, StrikeClient, TESTNET, type ApiWallet, type NormalizedSnapshot, type RawSnapshot } from "@domino/engine";
import { c } from "./term.ts";

export interface CommonOptions {
  network: "mainnet" | "testnet";
  fixture?: string;
  quiet?: boolean;
}

export const apiBase = (network: CommonOptions["network"]) => (network === "testnet" ? TESTNET : MAINNET);

export async function load(o: CommonOptions, betas?: Record<string, number>): Promise<NormalizedSnapshot> {
  if (o.fixture) return normalizeSnapshot(JSON.parse(readFileSync(o.fixture, "utf8")) as RawSnapshot);
  const progress = (done: number, total: number) => {
    if (!o.quiet && process.stderr.isTTY) process.stderr.write(`\r${c.dim(`reading Strike ${o.network}… ${done}/${total}`)}   `);
  };
  // Candles (for betas) cost one request per market, so watch loops reuse the betas from the first load.
  const snap = await loadSnapshot({ base: apiBase(o.network), withCandles: !betas, onProgress: progress });
  if (!o.quiet && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  if (betas) snap.betas = betas;
  return snap;
}

/** The API wallet from STRIKE_API_PUBLIC_KEY / STRIKE_API_PRIVATE_KEY, if both are set. */
export function envWallet(): ApiWallet | null {
  const publicKeyHex = process.env.STRIKE_API_PUBLIC_KEY?.trim();
  const privateKeyHex = process.env.STRIKE_API_PRIVATE_KEY?.trim();
  return publicKeyHex && privateKeyHex ? { publicKeyHex, privateKeyHex } : null;
}

/**
 * A client for signing orders. Dry runs without keys sign with a throwaway key so the full request
 * can still be shown; live runs require the real API wallet.
 */
export function makeClient(o: CommonOptions & { live?: boolean; builderFee?: number }): { client: StrikeClient; demoKey: boolean } {
  const wallet = envWallet();
  if (o.live && !wallet) throw new Error("--live needs STRIKE_API_PUBLIC_KEY and STRIKE_API_PRIVATE_KEY (create an API wallet in the Strike app).");
  return { client: new StrikeClient(apiBase(o.network), wallet ?? generateApiWallet(), { builderFeeBps: o.builderFee }), demoKey: !wallet };
}
