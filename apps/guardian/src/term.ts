// Terminal output helpers: colours (off when piped or NO_COLOR is set), number formats, aligned tables.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string | number) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  magenta: paint("35"),
  cyan: paint("36"),
};

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

export function usd(x: number, digits = 0): string {
  return (x < 0 ? "−$" : "$") + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function usdShort(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? "−$" : "$";
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${a.toFixed(0)}`;
}

export const pct = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)}%`;

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
export const base = (symbol: string) => symbol.replace(/-USD$/, "");

/** Print rows as an aligned table. Columns whose header starts with ">" are right-aligned. */
export function table(headers: string[], rows: string[][]): void {
  const right = headers.map((h) => h.startsWith(">"));
  const head = headers.map((h) => (h.startsWith(">") ? h.slice(1) : h));
  const widths = head.map((h, i) => Math.max(visible(h).length, ...rows.map((r) => visible(r[i] ?? "").length)));
  const line = (cells: string[]) =>
    "  " +
    cells
      .map((cell, i) => {
        const pad = " ".repeat(Math.max(0, widths[i] - visible(cell).length));
        return right[i] ? pad + cell : cell + pad;
      })
      .join("  ");
  console.log(c.dim(line(head)));
  for (const r of rows) console.log(line(r));
}

export const heading = (s: string) => console.log(`\n${c.bold(s)}`);
