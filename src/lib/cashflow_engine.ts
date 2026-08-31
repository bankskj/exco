// Derived cashflow engine — interlocked with the rest of the platform:
//   Actual months  : Xero P&L buckets (income / staff / dev / other), the same
//                    numbers as the Income dashboard.
//   Forecast months: staff & dev from the Payroll grid where captured (the
//                    grid runs into the future), everything else from the
//                    average of the last 3 ACTUAL months — so an un-captured
//                    month (books not reconciled yet) never skews the model.
// The actuals/forecast boundary is the user's "books complete through" month.

import { addMonths, rangeInclusive, monthsBetween } from "./period";
import type { CfActual } from "../data/cashflow";
import type { CFSettings } from "./forecast";

export type CfSource = "pnl" | "payroll" | "avg" | "manual";

export type DerivedColumn = {
  month: string;
  isForecast: boolean;
  income: number;
  people: number; // salaries + contractors/freelancers — one consistent series
  other: number;
  recurring: number; // manual recurring expenses (not in Xero)
  sars: number; // SARS cash payments (VAT/PAYE settlements — not in the P&L)
  adjIncome: number; // additional income rows (projects/pipeline) — forecast months
  adjCost: number; // additional cost rows — forecast months
  cost: number; // people + other + recurring + sars + adjCost
  net: number;
  balance: number;
  incomeSrc: CfSource;
  peopleSrc: CfSource;
  otherSrc: CfSource;
};

/** Per-month overrides of the modelled forecast values (blank = use model). */
export type CfOverrides = Map<string, { income?: number; people?: number; other?: number }>;
/** Additional user rows (e.g. outstanding project income), applied to forecast months. */
export type CfAdjustmentRow = { id: string; name: string; kind: "income" | "cost"; values: Map<string, number> };

export type DerivedScenario = {
  name: "base" | "best" | "worst";
  balances: number[];
  endBalance: number;
  lowest: { month: string; balance: number };
  runwayMonth: string | null;
  runwayMonths: number | null;
};

export type DerivedCashflow = {
  months: string[];
  columns: DerivedColumn[];
  scenarios: Record<"base" | "best" | "worst", DerivedScenario>;
  kpis: {
    currentCash: number;
    avgMonthlyNet: number;
    runwayMonths: number | null;
    runwayMonth: string | null;
    projectedEndBalance: number;
    lowest: { month: string; balance: number };
  };
  avgBasis: string[]; // the actual months used for 3-month averages
};

const avg = (vals: number[]): number => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

export function buildDerivedCashflow(
  actuals: Map<string, CfActual>,
  payrollByMonth: Map<string, number>, // total gross: staff + contractors + freelancers
  recurringManualMonthly: number,
  s: CFSettings,
  overrides: CfOverrides = new Map(),
  adjustments: CfAdjustmentRow[] = [],
  sarsByMonth: Map<string, number> = new Map(),
): DerivedCashflow {
  const start = s.opening_period;
  const boundary = s.actuals_through; // books complete through (inclusive)
  const end = addMonths(boundary, Math.max(1, s.horizon_months));
  const months = rangeInclusive(start, end);

  // 3-month average basis: the last 3 actual months (they are complete books).
  const actualMonths = months.filter((m) => m <= boundary);
  const avgBasis = actualMonths.slice(-3);
  const basisVals = (pick: (a: CfActual) => number): number[] =>
    avgBasis.map((m) => actuals.get(m)).filter((a): a is CfActual => !!a).map(pick);
  const incomeAvg = avg(basisVals((a) => a.income));
  const peopleAvg = avg(basisVals((a) => a.staff + a.dev));
  const otherAvg = avg(basisVals((a) => a.other));
  const sarsAvg = avg(avgBasis.map((m) => sarsByMonth.get(m) ?? 0));

  const columns: DerivedColumn[] = [];
  let balance = s.opening_balance;
  for (const month of months) {
    const isForecast = month > boundary;
    let income: number, people: number, other: number;
    let incomeSrc: CfSource = "pnl";
    let peopleSrc: CfSource = "pnl";
    let otherSrc: CfSource = "pnl";
    let adjIncome = 0;
    let adjCost = 0;
    if (!isForecast) {
      const a = actuals.get(month);
      income = a?.income ?? 0;
      people = (a?.staff ?? 0) + (a?.dev ?? 0); // salaries + contractors
      other = a?.other ?? 0;
    } else {
      const ov = overrides.get(month) ?? {};
      if (ov.income != null) { income = ov.income; incomeSrc = "manual"; }
      else { income = incomeAvg; incomeSrc = "avg"; }
      if (ov.people != null) { people = ov.people; peopleSrc = "manual"; }
      else {
        const p = payrollByMonth.get(month) ?? 0;
        people = p > 0 ? p : peopleAvg;
        peopleSrc = p > 0 ? "payroll" : "avg";
      }
      if (ov.other != null) { other = ov.other; otherSrc = "manual"; }
      else { other = otherAvg; otherSrc = "avg"; }
      for (const row of adjustments) {
        const v = row.values.get(month) ?? 0;
        if (row.kind === "income") adjIncome += v;
        else adjCost += v;
      }
    }
    // Manual recurring items are by definition outside Xero — additive always.
    const recurring = recurringManualMonthly;
    const sars = isForecast ? sarsAvg : sarsByMonth.get(month) ?? 0;
    const cost = people + other + recurring + sars + adjCost;
    const net = income + adjIncome - cost;
    balance += net;
    columns.push({ month, isForecast, income, people, other, recurring, sars, adjIncome, adjCost, cost, net, balance, incomeSrc, peopleSrc, otherSrc });
  }

  const buildScenario = (name: "base" | "best" | "worst"): DerivedScenario => {
    let bal = s.opening_balance;
    let lowest = { month: months[0] ?? start, balance: Infinity };
    let runwayMonth: string | null = null;
    const balances = columns.map((c) => {
      let income = c.income + c.adjIncome;
      let cost = c.cost;
      if (c.isForecast && name === "best") {
        income *= 1 + s.best_income_pct / 100;
        cost *= 1 - s.best_cost_pct / 100;
      } else if (c.isForecast && name === "worst") {
        income *= 1 - s.worst_income_pct / 100;
        cost *= 1 + s.worst_cost_pct / 100;
      }
      bal += income - cost;
      if (bal < lowest.balance) lowest = { month: c.month, balance: bal };
      if (runwayMonth == null && bal < 0 && c.isForecast) runwayMonth = c.month;
      return bal;
    });
    return {
      name,
      balances,
      endBalance: balances.length ? balances[balances.length - 1] : s.opening_balance,
      lowest,
      runwayMonth,
      runwayMonths: runwayMonth ? monthsBetween(boundary, runwayMonth) : null,
    };
  };

  const scenarios = { base: buildScenario("base"), best: buildScenario("best"), worst: buildScenario("worst") };
  const actualCols = columns.filter((c) => !c.isForecast);
  const currentCash = actualCols.length ? actualCols[actualCols.length - 1].balance : s.opening_balance;
  return {
    months,
    columns,
    scenarios,
    kpis: {
      currentCash,
      avgMonthlyNet: avg(actualCols.slice(-3).map((c) => c.net)),
      runwayMonths: scenarios.base.runwayMonths,
      runwayMonth: scenarios.base.runwayMonth,
      projectedEndBalance: scenarios.base.endBalance,
      lowest: scenarios.base.lowest,
    },
    avgBasis,
  };
}
