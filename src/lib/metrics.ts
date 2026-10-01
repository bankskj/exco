// Canonical financial metrics — the single source for every executive KPI.
// Every card on the Overview, Finance Overview and Data Quality pages reads
// from this snapshot; no page computes its own version of these figures.

import type { DerivedCashflow } from "./cashflow_engine";
import { fiscalYearOf, addMonths } from "./period";
import type { CfActual } from "../data/cashflow";
import type { ActualTxn } from "../data/actuals";
import type { Commission, CommissionLine } from "../data/commissions";
import { commissionOf } from "../data/commissions";
import type { RecurringExpense } from "../data/expenses";
import { monthlyEquivalent } from "../data/expenses";
import type { Employee, PayrollEntry } from "../data/payroll";
import type { HrEmployee } from "../data/hr";

export type CashRisk = "healthy" | "watch" | "funding" | "overdrawn";

export type Snapshot = {
  asAt: string; // ISO timestamp of computation
  lastSync: string | null; // ISO of last Xero sync
  boundary: string; // books complete through (YYYY-MM)
  profit: {
    fy: number;
    periodStart: string;
    periodEnd: string; // last month included
    revenue: number;
    expenses: number;
    netProfit: number;
    netMarginPct: number;
    lossMonths: number;
    monthsCounted: number;
  };
  cash: {
    bankEstimate: number; // modelled balance at the current month — an ESTIMATE
    asAtMonth: string;
    lowest: { month: string; balance: number };
    fundingMonth: string | null; // first forecast month below zero
    risk: CashRisk;
    next30Net: number; // next forecast month's net movement
  };
  facility: { used: number; limit: number | null; available: number | null };
  liquidity: number | null; // bank estimate + undrawn facility
  receivables: {
    outstanding: number;
    overdue30: number; // open balances on invoices older than 30 days
    dueSoon: number; // open balances on invoices raised in the last 30 days
    openInvoices: number;
    collectedThisMonth: number; // cash received this month (cash P&L)
    creditNotesNote: boolean; // credit notes are not netted — always true for now
  };
  costs: { recurringMonthly: number; activeN: number };
  payroll: { month: string | null; gross: number; paye: number; nett: number; paid: number };
  people: { hrActive: number; payrollActive: number; contractors: number; payrollPaid: number };
  pipeline: {
    potential: number; // quotes
    committed: number; // POs
    billed: number; // invoiced, not yet paid
    collected: number; // paid deals
    commissionEstimated: number; // quote/PO stage
    commissionEarned: number; // invoiced (nett captured) + paid
  };
};

export type SnapshotInputs = {
  cf: DerivedCashflow;
  actuals: Map<string, CfActual>;
  boundary: string;
  revolvingOwed: number;
  facilityLimit: number | null;
  txns: ActualTxn[]; // raw Xero docs (for receivables)
  deals: Commission[];
  dealLines: CommissionLine[];
  expenses: RecurringExpense[];
  payrollEmployees: Employee[];
  payrollEntries: PayrollEntry[];
  hrEmployees: HrEmployee[];
  lastSync: string | null;
  now?: Date;
};

/** The value a deal represents: captured nett, else the sum of its invoice lines. */
export function dealValue(d: Commission, linesInvoiced: Map<string, number>): number {
  return d.invoice_nett ?? linesInvoiced.get(d.id) ?? 0;
}

/**
 * Commission state machine — commission is never "due" before its trigger:
 *   quote/po  → estimated
 *   invoice   → earned (requires a real invoice nett)
 *   paid      → payable
 */
export function commissionState(d: Commission): "none" | "estimated" | "earned" | "payable" {
  const c = commissionOf(d);
  if (c == null || c === 0) return "none";
  if (d.stage === "quote" || d.stage === "po") return "estimated";
  if ((d.invoice_nett ?? 0) <= 0) return "estimated"; // invoiced stage without a nett — not earned yet
  return d.stage === "paid" ? "payable" : "earned";
}

export function buildSnapshot(i: SnapshotInputs): Snapshot {
  const now = i.now ?? new Date();
  const nowMonth = now.toISOString().slice(0, 7);
  const nowDate = now.toISOString().slice(0, 10);

  // ---- Profit (accrual P&L, completed months only — the in-progress month is
  // still being invoiced/reconciled and would distort the standing)
  const lastCompleted = addMonths(nowMonth, -1);
  const profitEnd = i.boundary < lastCompleted ? i.boundary : lastCompleted;
  const fy = fiscalYearOf(profitEnd);
  const fyStart = `${fy - 1}-03`;
  let revenue = 0;
  let expenses = 0;
  let lossMonths = 0;
  let monthsCounted = 0;
  for (const [m, a] of i.actuals) {
    if (m < fyStart || m > profitEnd) continue;
    const exp = a.staff_accr + a.dev_accr + a.other_accr;
    revenue += a.income_accr;
    expenses += exp;
    if (a.income_accr - exp < 0) lossMonths++;
    monthsCounted++;
  }
  const netProfit = revenue - expenses;

  // ---- Cash & risk (from the one forecast engine), confined to the current FY
  // so the executive headline doesn't roam into next year's horizon.
  const colNow = i.cf.columns.find((c) => c.month === nowMonth);
  const bankEstimate = colNow?.balance ?? i.cf.kpis.currentCash;
  const fyCap = `${fiscalYearOf(nowMonth)}-02`;
  const fyCols = i.cf.columns.filter((c) => c.month <= fyCap);
  const lowestFy = fyCols.reduce(
    (low, c) => (c.balance < low.balance ? { month: c.month, balance: c.balance } : low),
    { month: nowMonth, balance: bankEstimate },
  );
  const forecastCols = i.cf.columns.filter((c) => c.isForecast);
  const fundingMonth =
    bankEstimate < 0 ? nowMonth : forecastCols.find((c) => c.month <= fyCap && c.balance < 0)?.month ?? null;
  const risk: CashRisk =
    bankEstimate < 0 ? "overdrawn"
    : fundingMonth != null ? "funding"
    : lowestFy.balance < 0 ? "watch"
    : "healthy";
  const nextForecast = forecastCols[0];

  // ---- Facility & liquidity
  const facility = {
    used: i.revolvingOwed,
    limit: i.facilityLimit,
    available: i.facilityLimit != null ? Math.max(0, i.facilityLimit - i.revolvingOwed) : null,
  };
  const liquidity = facility.available != null ? bankEstimate + facility.available : null;

  // ---- Receivables (open balances on Xero sales invoices; credit notes not netted)
  const openSales = i.txns.filter((t) => t.kind === "sale" && t.amount_due > 0.005);
  const cutoff30 = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const outstanding = openSales.reduce((s, t) => s + t.amount_due, 0);
  const overdue30 = openSales.filter((t) => t.txn_date < cutoff30).reduce((s, t) => s + t.amount_due, 0);
  const collectedThisMonth = i.actuals.get(nowMonth)?.income ?? 0;

  // ---- Costs (recurring operating costs — tax/SARS is tracked separately)
  const activeRec = i.expenses.filter((e) => e.active && !/^SARS\b/i.test(e.name));
  const recurringMonthly = activeRec.reduce((s, e) => s + monthlyEquivalent(e), 0);

  // ---- Payroll (latest completed period with data, never a future month)
  const totals = new Map<string, { gross: number; paye: number; paid: number }>();
  for (const pe of i.payrollEntries) {
    if (pe.gross <= 0) continue;
    const t = totals.get(pe.period) ?? { gross: 0, paye: 0, paid: 0 };
    t.gross += pe.gross;
    t.paye += pe.paye;
    t.paid++;
    totals.set(pe.period, t);
  }
  const payMonth = [...totals.keys()].filter((m) => m <= nowMonth).sort().pop() ?? null;
  const pay = payMonth ? totals.get(payMonth)! : { gross: 0, paye: 0, paid: 0 };

  // ---- People populations (HR employees vs payroll incl. contractors)
  const hrActive = i.hrEmployees.filter((e) => !e.end_date).length;
  const active = i.payrollEmployees.filter(
    (e) => e.status === "active" || (e.inactive_date && nowMonth <= e.inactive_date.slice(0, 7)),
  );
  const contractors = active.filter((e) => e.type !== "za").length;

  // ---- Pipeline (by certainty)
  const linesInvoiced = new Map<string, number>();
  for (const l of i.dealLines) linesInvoiced.set(l.commission_id, (linesInvoiced.get(l.commission_id) ?? 0) + l.invoice);
  const stageSum = (stage: string) => i.deals.filter((d) => d.stage === stage).reduce((s, d) => s + dealValue(d, linesInvoiced), 0);
  let commissionEstimated = 0;
  let commissionEarned = 0;
  for (const d of i.deals) {
    const st = commissionState(d);
    const c = commissionOf(d) ?? 0;
    if (st === "estimated") commissionEstimated += c;
    if (st === "earned" || st === "payable") commissionEarned += c;
  }

  return {
    asAt: now.toISOString(),
    lastSync: i.lastSync,
    boundary: i.boundary,
    profit: {
      fy,
      periodStart: fyStart,
      periodEnd: profitEnd,
      revenue,
      expenses,
      netProfit,
      netMarginPct: revenue ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
      lossMonths,
      monthsCounted,
    },
    cash: {
      bankEstimate,
      asAtMonth: nowMonth,
      lowest: lowestFy,
      fundingMonth,
      risk,
      next30Net: nextForecast?.net ?? 0,
    },
    facility,
    liquidity,
    receivables: {
      outstanding,
      overdue30,
      dueSoon: outstanding - overdue30,
      openInvoices: openSales.length,
      collectedThisMonth,
      creditNotesNote: true,
    },
    costs: { recurringMonthly, activeN: activeRec.length },
    payroll: { month: payMonth, gross: pay.gross, paye: pay.paye, nett: pay.gross - pay.paye, paid: pay.paid },
    people: { hrActive, payrollActive: active.length, contractors, payrollPaid: pay.paid },
    pipeline: {
      potential: stageSum("quote"),
      committed: stageSum("po"),
      billed: stageSum("invoice"),
      collected: stageSum("paid"),
      commissionEstimated,
      commissionEarned,
    },
  };
}
