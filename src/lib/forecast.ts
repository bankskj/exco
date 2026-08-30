// Cashflow forecast engine.
//
// Given categorised line items, monthly values (actual/forecast), an opening
// cash balance and scenario knobs, it produces a month-by-month projection:
// per-category values, income/cost/net totals, running cash balance, and the
// executive KPIs (burn rate, runway, projected & lowest balance) — under base,
// best and worst scenarios.

import { addMonths, maxPeriod, minPeriod, monthsBetween, rangeInclusive } from "./period";

export type CFCategory = {
  id: string;
  name: string;
  kind: "income" | "cost";
  grp: string | null;
  is_recurring: number;
  sort_order: number;
};

export type CFEntry = {
  category_id: string;
  period: string;
  amount: number;
  status: "actual" | "forecast";
};

export type CFSettings = {
  opening_balance: number;
  opening_period: string;
  horizon_months: number;
  best_income_pct: number;
  best_cost_pct: number;
  worst_income_pct: number;
  worst_cost_pct: number;
};

export type MonthCell = {
  amount: number;
  source: "actual" | "manual" | "recurring" | "trend" | "none";
};

export type MonthColumn = {
  period: string;
  isForecast: boolean;
  income: number;
  cost: number;
  net: number;
  balance: number; // running, base scenario
  cells: Record<string, MonthCell>; // categoryId -> cell
};

export type ScenarioSeries = {
  name: "base" | "best" | "worst";
  columns: { period: string; isForecast: boolean; income: number; cost: number; net: number; balance: number }[];
  endBalance: number;
  lowest: { period: string; balance: number };
  runwayPeriod: string | null; // first period balance goes < 0, or null if never
  runwayMonths: number | null; // months from last actual to runwayPeriod
};

export type Forecast = {
  timeline: string[];
  lastActual: string | null;
  base: MonthColumn[];
  scenarios: Record<"base" | "best" | "worst", ScenarioSeries>;
  kpis: {
    currentCash: number;
    avgMonthlyNet: number; // trailing actual months (negative = burn)
    avgMonthlyCost: number;
    runwayMonths: number | null; // null = cash-positive / never crosses zero
    runwayPeriod: string | null;
    projectedEndBalance: number;
    lowest: { period: string; balance: number };
  };
};

function trailingAvg(values: number[], n: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function computeForecast(cats: CFCategory[], entries: CFEntry[], s: CFSettings): Forecast {
  // Index entries by category+period.
  const byCatPeriod = new Map<string, CFEntry>();
  const actualPeriods: string[] = [];
  const forecastPeriods: string[] = [];
  for (const e of entries) {
    byCatPeriod.set(`${e.category_id}|${e.period}`, e);
    if (e.status === "actual") actualPeriods.push(e.period);
    else forecastPeriods.push(e.period);
  }
  const lastActual = maxPeriod(actualPeriods);
  const earliest = minPeriod([...actualPeriods, s.opening_period]) ?? s.opening_period;

  // Timeline: opening period (or earliest actual) → last actual + horizon,
  // extended to cover any manual forecast entries beyond the horizon.
  const start = earliest < s.opening_period ? earliest : s.opening_period;
  const forecastAnchor = lastActual ?? addMonths(s.opening_period, -1);
  let end = addMonths(forecastAnchor, Math.max(1, s.horizon_months));
  const maxForecast = maxPeriod(forecastPeriods);
  if (maxForecast && maxForecast > end) end = maxForecast;
  const timeline = rangeInclusive(start, end);

  // Per-category actual history (in timeline order) for trend projection.
  const actualHistory = new Map<string, number[]>();

  // Resolve a cell value for (cat, period).
  const resolve = (cat: CFCategory, period: string): MonthCell => {
    const direct = byCatPeriod.get(`${cat.id}|${period}`);
    const isForecastPeriod = lastActual == null ? period >= s.opening_period : period > lastActual;
    if (direct && direct.status === "actual") {
      return { amount: direct.amount, source: "actual" };
    }
    if (!isForecastPeriod) {
      // Past period, no actual recorded → treat as 0 actual.
      return { amount: direct ? direct.amount : 0, source: direct ? "actual" : "none" };
    }
    // Forecast period:
    if (direct && direct.status === "forecast") return { amount: direct.amount, source: "manual" };
    if (cat.is_recurring) {
      const hist = actualHistory.get(cat.id) ?? [];
      const last = hist.length ? hist[hist.length - 1] : 0;
      return { amount: last, source: "recurring" };
    }
    const hist = actualHistory.get(cat.id) ?? [];
    return { amount: trailingAvg(hist, 3), source: "trend" };
  };

  // Build base columns.
  const base: MonthColumn[] = [];
  let balance = s.opening_balance;
  for (const period of timeline) {
    const isForecast = lastActual == null ? period >= s.opening_period : period > lastActual;
    const cells: Record<string, MonthCell> = {};
    let income = 0;
    let cost = 0;
    for (const cat of cats) {
      const cell = resolve(cat, period);
      cells[cat.id] = cell;
      if (cat.kind === "income") income += cell.amount;
      else cost += cell.amount;
      // Record actuals into history for later trend/recurring projection.
      if (!isForecast && cell.source === "actual") {
        const arr = actualHistory.get(cat.id) ?? [];
        arr.push(cell.amount);
        actualHistory.set(cat.id, arr);
      }
    }
    const net = income - cost;
    balance += net;
    base.push({ period, isForecast, income, cost, net, balance, cells });
  }

  // Scenario builder: reuse base income/cost, adjust only forecast months.
  const buildScenario = (name: "base" | "best" | "worst"): ScenarioSeries => {
    let bal = s.opening_balance;
    let lowest = { period: timeline[0] ?? s.opening_period, balance: Infinity };
    let runwayPeriod: string | null = null;
    const columns = base.map((col) => {
      let income = col.income;
      let cost = col.cost;
      if (col.isForecast && name === "best") {
        income *= 1 + s.best_income_pct / 100;
        cost *= 1 - s.best_cost_pct / 100;
      } else if (col.isForecast && name === "worst") {
        income *= 1 - s.worst_income_pct / 100;
        cost *= 1 + s.worst_cost_pct / 100;
      }
      const net = income - cost;
      bal += net;
      if (bal < lowest.balance) lowest = { period: col.period, balance: bal };
      if (runwayPeriod == null && bal < 0 && col.isForecast) runwayPeriod = col.period;
      return { period: col.period, isForecast: col.isForecast, income, cost, net, balance: bal };
    });
    return {
      name,
      columns,
      endBalance: columns.length ? columns[columns.length - 1].balance : s.opening_balance,
      lowest,
      runwayPeriod,
      runwayMonths: runwayPeriod && lastActual ? monthsBetween(lastActual, runwayPeriod) : null,
    };
  };

  const scenarios = {
    base: buildScenario("base"),
    best: buildScenario("best"),
    worst: buildScenario("worst"),
  };

  // KPIs from the base scenario + trailing actuals.
  const actualCols = base.filter((c) => !c.isForecast);
  const currentCash = actualCols.length ? actualCols[actualCols.length - 1].balance : s.opening_balance;
  const avgMonthlyNet = trailingAvg(actualCols.map((c) => c.net), 3);
  const avgMonthlyCost = trailingAvg(actualCols.map((c) => c.cost), 3);

  return {
    timeline,
    lastActual,
    base,
    scenarios,
    kpis: {
      currentCash,
      avgMonthlyNet,
      avgMonthlyCost,
      runwayMonths: scenarios.base.runwayMonths,
      runwayPeriod: scenarios.base.runwayPeriod,
      projectedEndBalance: scenarios.base.endBalance,
      lowest: scenarios.base.lowest,
    },
  };
}
