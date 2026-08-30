// Minimal server-rendered SVG charts. Return raw SVG strings (inject with
// dangerouslySetInnerHTML). No client JS, no external libraries.

import { formatZARCompact } from "./money";

const AXIS = "#2a3140";
const GRID = "#20262f";
const TEXT = "#9aa7b4";
const ACCENT = "#4f8cff";
const GREEN = "#3fb984";
const RED = "#ff6b6b";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Pt = { label: string; value: number; forecast?: boolean };

function niceScale(min: number, max: number): { lo: number; hi: number } {
  if (min === max) {
    if (min === 0) return { lo: 0, hi: 1 };
    return { lo: Math.min(0, min * 1.2), hi: Math.max(0, max * 1.2) };
  }
  const pad = (max - min) * 0.1;
  return { lo: Math.min(0, min - pad), hi: max + pad };
}

/**
 * Line chart with an actual→forecast split (solid then dashed), a highlighted
 * zero baseline (used to read cash-runway crossover), and sparse x labels.
 */
export function lineChart(points: Pt[], opts?: { width?: number; height?: number; color?: string }): string {
  const W = opts?.width ?? 720;
  const H = opts?.height ?? 240;
  const color = opts?.color ?? ACCENT;
  const m = { t: 16, r: 16, b: 28, l: 64 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  if (points.length === 0) return emptyChart(W, H);

  const values = points.map((p) => p.value);
  const { lo, hi } = niceScale(Math.min(...values), Math.max(...values));
  const x = (i: number) => m.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  // Gridlines + y labels (4 steps)
  let grid = "";
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = lo + ((hi - lo) * s) / steps;
    const yy = y(v);
    grid += `<line x1="${m.l}" y1="${yy.toFixed(1)}" x2="${W - m.r}" y2="${yy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`;
    grid += `<text x="${m.l - 8}" y="${(yy + 4).toFixed(1)}" fill="${TEXT}" font-size="11" text-anchor="end">${esc(formatZARCompact(v))}</text>`;
  }
  // Zero baseline (emphasised)
  let zero = "";
  if (lo < 0 && hi > 0) {
    const yz = y(0);
    zero = `<line x1="${m.l}" y1="${yz.toFixed(1)}" x2="${W - m.r}" y2="${yz.toFixed(1)}" stroke="${RED}" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.8"/>`;
  }

  // Build path, splitting solid (actual) vs dashed (forecast) at first forecast point.
  const coords = points.map((p, i) => ({ x: x(i), y: y(p.value), forecast: !!p.forecast }));
  const firstForecast = coords.findIndex((c) => c.forecast);
  const solidPts = firstForecast === -1 ? coords : coords.slice(0, firstForecast + 1);
  const dashPts = firstForecast === -1 ? [] : coords.slice(Math.max(0, firstForecast - 1));
  const toPath = (cs: { x: number; y: number }[]) =>
    cs.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

  // Area under the solid part
  let area = "";
  if (solidPts.length > 1) {
    const base = y(Math.max(lo, 0));
    area = `<path d="${toPath(solidPts)} L${solidPts[solidPts.length - 1].x.toFixed(1)} ${base.toFixed(1)} L${solidPts[0].x.toFixed(1)} ${base.toFixed(1)} Z" fill="${color}" opacity="0.10"/>`;
  }
  const solidLine = solidPts.length ? `<path d="${toPath(solidPts)}" fill="none" stroke="${color}" stroke-width="2.5"/>` : "";
  const dashLine = dashPts.length > 1 ? `<path d="${toPath(dashPts)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 4" opacity="0.85"/>` : "";

  // Dots
  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.forecast ? 2.5 : 3}" fill="${c.forecast ? "#0e1116" : color}" stroke="${color}" stroke-width="1.5"/>`)
    .join("");

  // X labels (sparse: ~6)
  const every = Math.max(1, Math.ceil(points.length / 6));
  let xlabels = "";
  points.forEach((p, i) => {
    if (i % every === 0 || i === points.length - 1) {
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" fill="${TEXT}" font-size="11" text-anchor="middle">${esc(p.label)}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" font-family="-apple-system,Segoe UI,Roboto,sans-serif" role="img">${grid}${zero}${area}${solidLine}${dashLine}${dots}${xlabels}</svg>`;
}

/** Income (up, green) vs Cost (down, red) bars per month, plus a net line. */
export function comboBars(
  rows: { label: string; income: number; cost: number; net: number; forecast?: boolean }[],
  opts?: { width?: number; height?: number },
): string {
  const W = opts?.width ?? 720;
  const H = opts?.height ?? 260;
  const m = { t: 16, r: 16, b: 28, l: 64 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  if (rows.length === 0) return emptyChart(W, H);

  const maxUp = Math.max(0, ...rows.map((r) => r.income), ...rows.map((r) => r.net));
  const maxDn = Math.max(0, ...rows.map((r) => r.cost), ...rows.map((r) => -r.net));
  const hi = maxUp * 1.1 || 1;
  const lo = -(maxDn * 1.1 || 1);
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const band = iw / rows.length;
  const bw = Math.min(28, band * 0.34);

  let grid = "";
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = lo + ((hi - lo) * s) / steps;
    const yy = y(v);
    grid += `<line x1="${m.l}" y1="${yy.toFixed(1)}" x2="${W - m.r}" y2="${yy.toFixed(1)}" stroke="${GRID}"/>`;
    grid += `<text x="${m.l - 8}" y="${(yy + 4).toFixed(1)}" fill="${TEXT}" font-size="11" text-anchor="end">${esc(formatZARCompact(v))}</text>`;
  }
  const y0 = y(0);
  let bars = "";
  let netPts: { x: number; y: number; forecast?: boolean }[] = [];
  rows.forEach((r, i) => {
    const cx = m.l + band * i + band / 2;
    const op = r.forecast ? 0.45 : 0.9;
    // income up
    const iy = y(r.income);
    bars += `<rect x="${(cx - bw - 1).toFixed(1)}" y="${iy.toFixed(1)}" width="${bw}" height="${Math.max(0, y0 - iy).toFixed(1)}" fill="${GREEN}" opacity="${op}" rx="2"/>`;
    // cost down
    const cyv = y(-r.cost);
    bars += `<rect x="${(cx + 1).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw}" height="${Math.max(0, cyv - y0).toFixed(1)}" fill="${RED}" opacity="${op}" rx="2"/>`;
    netPts.push({ x: cx, y: y(r.net), forecast: r.forecast });
  });
  const netPath = netPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const netLine = `<path d="${netPath}" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>`;
  const netDots = netPts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${ACCENT}"/>`).join("");

  const every = Math.max(1, Math.ceil(rows.length / 6));
  let xlabels = "";
  rows.forEach((r, i) => {
    if (i % every === 0 || i === rows.length - 1) {
      const cx = m.l + band * i + band / 2;
      xlabels += `<text x="${cx.toFixed(1)}" y="${H - 8}" fill="${TEXT}" font-size="11" text-anchor="middle">${esc(r.label)}</text>`;
    }
  });
  const axis = `<line x1="${m.l}" y1="${y0.toFixed(1)}" x2="${W - m.r}" y2="${y0.toFixed(1)}" stroke="${AXIS}" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" font-family="-apple-system,Segoe UI,Roboto,sans-serif" role="img">${grid}${bars}${axis}${netLine}${netDots}${xlabels}</svg>`;
}

/** Horizontal bar list for breakdowns (e.g. cost per mentor, income per source). */
export function hBars(items: { label: string; value: number }[], opts?: { width?: number; color?: string }): string {
  const W = opts?.width ?? 360;
  const color = opts?.color ?? ACCENT;
  const rowH = 30;
  const H = Math.max(rowH, items.length * rowH) + 8;
  const labelW = 130;
  const barMax = W - labelW - 90;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  let out = "";
  items.forEach((it, i) => {
    const yy = 6 + i * rowH;
    const w = (Math.abs(it.value) / max) * barMax;
    out += `<text x="0" y="${yy + 15}" fill="${TEXT}" font-size="12">${esc(it.label.slice(0, 18))}</text>`;
    out += `<rect x="${labelW}" y="${yy + 4}" width="${w.toFixed(1)}" height="16" rx="3" fill="${color}" opacity="0.85"/>`;
    out += `<text x="${labelW + w + 6}" y="${yy + 16}" fill="#e6edf3" font-size="11">${esc(formatZARCompact(it.value))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" font-family="-apple-system,Segoe UI,Roboto,sans-serif" role="img">${out}</svg>`;
}

function emptyChart(W: number, H: number): string {
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><text x="${W / 2}" y="${H / 2}" fill="${TEXT}" font-size="13" text-anchor="middle">No data yet</text></svg>`;
}
