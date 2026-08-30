// Period helpers. A period is a calendar month as 'YYYY-MM'.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isPeriod(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function splitPeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split("-").map(Number);
  return { year: y, month: m };
}

export function makePeriod(year: number, month1to12: number): string {
  const y = year + Math.floor((month1to12 - 1) / 12);
  const m = ((((month1to12 - 1) % 12) + 12) % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function addMonths(period: string, delta: number): string {
  const { year, month } = splitPeriod(period);
  return makePeriod(year, month + delta);
}

/** Number of months from a→b (b - a). */
export function monthsBetween(a: string, b: string): number {
  const pa = splitPeriod(a);
  const pb = splitPeriod(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

/** Inclusive list of periods from start to end. */
export function rangeInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const n = monthsBetween(start, end);
  if (n < 0) return out;
  for (let i = 0; i <= n; i++) out.push(addMonths(start, i));
  return out;
}

/** N periods beginning at start. */
export function seq(start: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => addMonths(start, i));
}

/** 'Mar 2025' */
export function label(period: string): string {
  const { year, month } = splitPeriod(period);
  return `${MONTHS[month - 1]} ${year}`;
}

/** "Mar '25" — compact for chart axes. */
export function shortLabel(period: string): string {
  const { year, month } = splitPeriod(period);
  return `${MONTHS[month - 1]} '${String(year).slice(2)}`;
}

export function comparePeriod(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxPeriod(periods: string[]): string | null {
  return periods.length ? periods.reduce((m, p) => (p > m ? p : m)) : null;
}

export function minPeriod(periods: string[]): string | null {
  return periods.length ? periods.reduce((m, p) => (p < m ? p : m)) : null;
}
