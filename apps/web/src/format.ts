export const usd = (x: number, digits = 0) =>
  (x < 0 ? "−$" : "$") + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function usdShort(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? "−$" : "$";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${a.toFixed(0)}`;
}

export const pct = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)}%`;

/** Price with precision appropriate to its magnitude. */
export function price(x: number): string {
  if (!Number.isFinite(x) || x === 0) return "—";
  const a = Math.abs(x);
  const d = a >= 10000 ? 0 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7;
  return x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}

export function size(x: number): string {
  const a = Math.abs(x);
  const d = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 0.1 ? 4 : 5;
  return x.toLocaleString("en-US", { maximumFractionDigits: d });
}

export const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** Display name for a margin account: its wallet, or the vault's name for vault accounts. */
export function accountLabel(a: { address: string; vaultId: string }, vaults: { vault_id: string; name: string }[] = []): string {
  if (a.address) return shortAddr(a.address);
  const v = vaults.find((x) => x.vault_id === a.vaultId);
  return v ? `${v.name} vault` : `vault ${a.vaultId.slice(0, 8)}`;
}

/** The X-Ray query that finds this account. */
export const accountQuery = (a: { address: string; vaultId: string; accountId: string }) => a.address || a.vaultId || a.accountId;

export const base = (symbol: string) => symbol.replace(/-USD$/, "");

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
