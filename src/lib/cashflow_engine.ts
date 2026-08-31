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
  staff: number;
  dev: number;
  other: number;
  recurring: number; // manual recurring expenses (not in Xero)
  cost: number; // staff + dev + other + recurring
  net: number;
  balance: number;
  staffSrc: CfSource;
  devSrc: CfSource;
};

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
  payrollStaffByMonth: Map<string, number>, // gross: za + international
  payrollDevByMonth: Map<string, number>, // gross: freelancer
  recurringManualMonthly: number,
  s: CFSettings,
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
  const staffAvg = avg(basisVals((a) => a.staff));
  const devAvg = avg(basisVals((a) => a.dev));
  const otherAvg = avg(basisVals((a) => a.other));

  const columns: DerivedColumn[] = [];
  let balance = s.opening_balance;
  for (const month of months) {
    const isForecast = month > boundary;
    let income: number, staff: number, dev: number, other: number, recurring: number;
    let staffSrc: CfSource = "pnl";
    let devSrc: CfSource = "pnl";
    if (!isForecast) {
      const a = actuals.get(month);
      income = a?.income ?? 0;
      staff = a?.staff ?? 0;
      dev = a?.dev ?? 0;
      other = a?.other ?? 0;
      // Manual recurring items are by definition outside Xero, so they're
      // additive in actual months too.
      recurring = recurringManualMonthly;
    } else {
      income = incomeAvg;
      const pStaff = payrollStaffByMonth.get(month) ?? 0;
      const pDev = payrollDevByMonth.get(month) ?? 0;
      staff = pStaff > 0 ? pStaff : staffAvg;
      staffSrc = pStaff > 0 ? "payroll" : "avg";
      dev = pDev > 0 ? pDev : devAvg;
      devSrc = pDev > 0 ? "payroll" : "avg";
      other = otherAvg;
      recurring = recurringManualMonthly;
    }
    const cost = staff + dev + other + recurring;
    const net = income - cost;
    balance += net;
    columns.push({ month, isForecast, income, staff, dev, other, recurring, cost, net, balance, staffSrc, devSrc });
  }

  const buildScenario = (name: "base" | "best" | "worst"): DerivedScenario => {
    let bal = s.opening_balance;
    let lowest = { month: months[0] ?? start, balance: Infinity };
    let runwayMonth: string | null = null;
    const balances = columns.map((c) => {
      let income = c.income;
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
