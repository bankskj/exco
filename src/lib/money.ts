// ZAR formatting. South African convention: space as the thousands separator,
// "R" prefix, comma decimal. e.g. R 1 009 223,27

export function formatZAR(n: number | null | undefined, opts?: { decimals?: number }): string {
  const decimals = opts?.decimals ?? 0;
  const value = Number.isFinite(n as number) ? (n as number) : 0;
  const neg = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " "); // non-breaking space
  const body = decPart ? `${grouped},${decPart}` : grouped;
  return `${neg ? "-" : ""}R ${body}`;
}

/** Compact form for chart axes / tight cells: R 1,01m, R 704k. */
export function formatZARCompact(n: number | null | undefined): string {
  const value = Number.isFinite(n as number) ? (n as number) : 0;
  const neg = value < 0;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) body = (abs / 1_000_000).toFixed(2).replace(".", ",") + "m";
  else if (abs >= 1_000) body = Math.round(abs / 1_000) + "k";
  else body = Math.round(abs).toString();
  return `${neg ? "-" : ""}R ${body}`;
}

/** Parse a loosely-formatted money string ("R 1 009 223,27", "1,009,223.27") to a number. */
export function parseMoney(input: string | null | undefined): number {
  if (input == null) return 0;
  let s = String(input).trim().replace(/[Rr\s ]/g, "");
  if (s === "") return 0;
  // If both separators present, the last one is the decimal separator.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Comma only: treat as decimal if it looks like one (2 trailing digits), else thousands.
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
