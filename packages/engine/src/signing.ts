// Strike API-wallet authentication (Ed25519) and a small REST client.
// Message: {METHOD}:{PATH?QUERY}:{TIMESTAMP}:{NONCE}:{SHA256(BODY)} — docs.strikefinance.org/api/getting-started

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface ApiWallet {
  publicKeyHex: string;
  privateKeyHex: string;
}

export function generateApiWallet(): ApiWallet {
  const priv = ed.utils.randomPrivateKey();
  return { privateKeyHex: bytesToHex(priv), publicKeyHex: bytesToHex(ed.getPublicKey(priv)) };
}

/** Accepts a 32-byte seed or a 64-byte expanded key (first 32 bytes are the seed). */
function seedOf(privateKeyHex: string): Uint8Array {
  const b = hexToBytes(privateKeyHex.trim().toLowerCase());
  return b.length === 64 ? b.subarray(0, 32) : b;
}

export function signatureMessage(method: string, pathWithQuery: string, timestamp: number, nonce: string, body = ""): string {
  return `${method.toUpperCase()}:${pathWithQuery}:${timestamp}:${nonce}:${bytesToHex(sha256(utf8ToBytes(body)))}`;
}

export function signRequest(wallet: ApiWallet, method: string, pathWithQuery: string, body: string | undefined, timestamp: number, nonce: string): Record<string, string> {
  const message = signatureMessage(method, pathWithQuery, timestamp, nonce, body ?? "");
  const signature = ed.sign(utf8ToBytes(message), seedOf(wallet.privateKeyHex));
  return {
    "X-API-Wallet-Public-Key": wallet.publicKeyHex.toLowerCase(),
    "X-API-Wallet-Signature": bytesToHex(signature),
    "X-API-Wallet-Timestamp": String(timestamp),
    "X-API-Wallet-Nonce": nonce,
  };
}

export function verifyRequest(publicKeyHex: string, headers: Record<string, string>, method: string, pathWithQuery: string, body = ""): boolean {
  const message = signatureMessage(method, pathWithQuery, Number(headers["X-API-Wallet-Timestamp"]), headers["X-API-Wallet-Nonce"], body);
  return ed.verify(hexToBytes(headers["X-API-Wallet-Signature"]), utf8ToBytes(message), hexToBytes(publicKeyHex));
}

export interface OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market" | "stop" | "stop_limit" | "take_profit" | "take_profit_limit";
  size: string;
  price?: string;
  stop_price?: string;
  time_in_force?: "GTC" | "IOC" | "FOK";
  reduce_only?: boolean;
  post_only?: boolean;
  client_order_id?: string;
}

export interface PreparedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export class StrikeClient {
  private offsetMs = 0;
  constructor(
    readonly base: string,
    private readonly wallet?: ApiWallet,
    private readonly opts: { builderFeeBps?: number; fetch?: typeof fetch } = {},
  ) {}

  private get f(): typeof fetch {
    return this.opts.fetch ?? fetch;
  }

  /** Align with server time; signed timestamps must never be in the future. */
  async syncClock(): Promise<number> {
    const t0 = Date.now();
    const { serverTime } = (await (await this.f(`${this.base}/v2/time`)).json()) as { serverTime: number };
    this.offsetMs = serverTime - Math.round((t0 + Date.now()) / 2);
    return this.offsetMs;
  }

  prepare(method: string, path: string, body?: unknown): PreparedRequest {
    if (!this.wallet) throw new Error("API wallet keys required for signed requests");
    const bodyStr = body === undefined ? undefined : JSON.stringify(body);
    const timestamp = Math.floor((Date.now() + this.offsetMs - 1000) / 1000);
    const headers = signRequest(this.wallet, method, path, bodyStr, timestamp, crypto.randomUUID());
    if (bodyStr !== undefined) headers["Content-Type"] = "application/json";
    if (this.opts.builderFeeBps !== undefined && method === "POST" && path.startsWith("/v2/order")) headers["X-Builder-Fee-Bps"] = String(this.opts.builderFeeBps);
    return { method, url: this.base + path, path, headers, body: bodyStr };
  }

  async send<T = unknown>(req: PreparedRequest): Promise<{ status: number; body: T }> {
    const r = await this.f(req.url, { method: req.method, headers: req.headers, body: req.body });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: r.status, body: parsed as T };
  }

  async get<T = unknown>(path: string) {
    return this.send<T>(this.prepare("GET", path));
  }

  async publicGet<T = unknown>(path: string): Promise<T> {
    const r = await this.f(this.base + path);
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  placeOrderRequest(order: OrderRequest): PreparedRequest {
    return this.prepare("POST", "/v2/order", order);
  }
}
