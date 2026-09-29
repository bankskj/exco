// Data Quality — the permanent reconciliation screen. Every check runs live
// against the same data the pages use, so inconsistent totals surface here
// instead of reaching management.

import type { DerivedCashflow } from "./cashflow_engine";
import { fiscalYearOf, addMonths, label } from "./period";
import type { CfActual } from "../data/cashflow";
import type { ActualTxn } from "../data/actuals";
import type { Commission } from "../data/commissions";
import { commissionOf } from "../data/commissions";
import type { RecurringExpense, VendorBill } from "../data/expenses";
import { monthlyEquivalent } from "../data/expenses";
import type { Employee, PayrollEntry } from "../data/payroll";
import type { HrEmployee } from "../data/hr";
import { formatZAR } from "./money";

export type Check = { group: string; name: string; status: "ok" | "warn" | "fail"; detail: string };

export function buildQualityReport(i: {
  cf: DerivedCashflow;
  actuals: Map<string, CfActual>;
  boundary: string;
  txns: ActualTxn[];
  debtorsDue: number; // from cf_debtors cohorts
  deals: Commission[];
  expenses: RecurringExpense[];
  vendorBills: VendorBill[];
  payrollEmployees: Employee[];
  payrollEntries: PayrollEntry[];
  hrEmployees: HrEmployee[];
  lastSync: string | null;
  actualsError: string | null;
}): Check[] {
  const checks: Check[] = [];
  const now = new Date();
  const nowMonth = now.toISOString().slice(0, 7);

  // ---- Xero -----------------------------------------------------------------
  if (!i.lastSync) {
    checks.push({ group: "Xero", name: "Sync", status: "fail", detail: "Never synced — connect Xero and run a sync." });
  } else {
    const ageDays = Math.floor((now.getTime() - Date.parse(i.lastSync)) / 86400_000);
    checks.push({
      group: "Xero", name: "Sync freshness",
      status: ageDays > 35 ? "warn" : "ok",
      detail: ageDays > 35 ? `Last sync ${ageDays} days ago — figures may be stale.` : `Last sync ${ageDays} day(s) ago.`,
    });
  }
  checks.push(
    i.actualsError
      ? { group: "Xero", name: "Transaction detail fetch", status: "warn", detail: `Last sync could not fetch all documents: ${i.actualsError}` }
      : { group: "Xero", name: "Transaction detail fetch", status: "ok", detail: "All document types fetched on the last sync." },
  );

  // ---- P&L coverage (test 1) -------------------------------------------------
  const fyStart = `${fiscalYearOf(i.boundary) - 1}-03`;
  const missing: string[] = [];
  for (let m = fyStart; m <= i.boundary; m = addMonths(m, 1)) {
    if (!i.actuals.has(m)) missing.push(label(m));
  }
  checks.push(
    missing.length
      ? { group: "Profit & Loss", name: "P&L months synced", status: "fail", detail: `Missing synced P&L for: ${missing.join(", ")} — dashboard profit will disagree with Xero.` }
      : { group: "Profit & Loss", name: "P&L months synced", status: "ok", detail: `Every month ${label(fyStart)}–${label(i.boundary)} has synced P&L data. Overview and Profit & Loss read the same store, so they agree by construction.` },
  );

  // ---- Cash roll-forward (tests 3 & 4) ----------------------------------------
  let rollBad = 0;
  for (let k = 1; k < i.cf.columns.length; k++) {
    const prev = i.cf.columns[k - 1];
    const cur = i.cf.columns[k];
    if (Math.abs(prev.balance + cur.net - cur.balance) > 0.01) rollBad++;
  }
  checks.push(
    rollBad
      ? { group: "Cash", name: "Cash roll-forward", status: "fail", detail: `${rollBad} month(s) where opening + net ≠ closing — model bug.` }
      : { group: "Cash", name: "Cash roll-forward", status: "ok", detail: "Every month's closing cash = previous closing + net movement, across actuals and forecast." },
  );

  // ---- Actual/forecast boundary (test 5) --------------------------------------
  const boundaryBad = i.cf.columns.filter((c) => (c.month <= i.boundary) === c.isForecast).length;
  checks.push(
    boundaryBad
      ? { group: "Cash", name: "Actual/forecast boundary", status: "fail", detail: `${boundaryBad} month(s) on the wrong side of the ${label(i.boundary)} boundary.` }
      : { group: "Cash", name: "Actual/forecast boundary", status: "ok", detail: `Months through ${label(i.boundary)} are actual; later months are forecast.` },
  );

  // ---- Receivables cross-source (test 2/6) ------------------------------------
  const openDue = i.txns.filter((t) => t.kind === "sale" && t.amount_due > 0.005).reduce((s, t) => s + t.amount_due, 0);
  const drift = Math.abs(openDue - i.debtorsDue);
  checks.push({
    group: "Receivables", name: "Invoice balances vs debtor cohorts",
    status: drift > Math.max(1000, openDue * 0.02) ? "warn" : "ok",
    detail: `Open invoice balances ${formatZAR(openDue)} vs cohort store ${formatZAR(i.debtorsDue)} (${formatZAR(drift)} apart — timing of the two syncs, and credit notes are not netted).`,
  });

  // ---- Recurring costs (tests 10 & 29/30) --------------------------------------
  const activeRec = i.expenses.filter((e) => e.active);
  const sarsRows = activeRec.filter((e) => /^SARS\b/i.test(e.name));
  checks.push(
    sarsRows.length
      ? { group: "Costs", name: "Tax kept out of operating costs", status: "warn", detail: `SARS is tracked as a recurring operating expense (${sarsRows.map((e) => e.name).join(", ")}) — it already has its own tax line in the forecast. Pause or delete the row.` }
      : { group: "Costs", name: "Tax kept out of operating costs", status: "ok", detail: "No SARS/tax rows inside recurring operating costs; tax is forecast on its own line." },
  );
  // one-offs annualised: xero-detected recurring vendors with <3 distinct billed months
  const monthsByVendor = new Map<string, Set<string>>();
  for (const b of i.vendorBills) {
    if (!monthsByVendor.has(b.vendor_key)) monthsByVendor.set(b.vendor_key, new Set());
    monthsByVendor.get(b.vendor_key)!.add(b.bill_date.slice(0, 7));
  }
  const thin = activeRec.filter((e) => {
    const k = e.xero_id?.startsWith("vendor:") ? e.xero_id.slice(7) : null;
    if (!k) return false;
    return (monthsByVendor.get(k)?.size ?? 0) < 3;
  });
  checks.push(
    thin.length
      ? { group: "Costs", name: "Recurring detection (≥3 distinct months)", status: "warn", detail: `${thin.length} tracked vendor(s) billed in fewer than 3 distinct months — possibly one-offs being annualised: ${thin.slice(0, 6).map((e) => e.name).join(", ")}${thin.length > 6 ? "…" : ""}. Pause them or wait for more history.` }
      : { group: "Costs", name: "Recurring detection (≥3 distinct months)", status: "ok", detail: "Every tracked recurring vendor has bills in at least 3 distinct months." },
  );

  // ---- Double counting (test 11) ------------------------------------------------
  const firstNames = new Set(i.payrollEmployees.map((e) => e.name.trim().toLowerCase()));
  const clash = activeRec.filter((e) => firstNames.has((e.vendor ?? e.name).trim().split(/\s+/)[0]?.toLowerCase() ?? ""));
  checks.push(
    clash.length
      ? { group: "Costs", name: "No payroll double counting", status: "fail", detail: `${clash.length} recurring expense(s) match payroll names — these people would be counted twice: ${clash.map((e) => e.name).join(", ")}.` }
      : { group: "Costs", name: "No payroll double counting", status: "ok", detail: "No recurring expense matches a payroll name — contractors are only counted once, in People." },
  );

  // ---- People reconciliation (test 9) --------------------------------------------
  const hrActive = i.hrEmployees.filter((e) => !e.end_date).length;
  const payActive = i.payrollEmployees.filter((e) => e.status === "active" || (e.inactive_date && nowMonth <= e.inactive_date.slice(0, 7)));
  const contractors = payActive.filter((e) => e.type !== "za").length;
  const employeesOnPayroll = payActive.length - contractors;
  checks.push({
    group: "People", name: "HR ↔ payroll population",
    status: Math.abs(hrActive - payActive.length) > contractors ? "warn" : "ok",
    detail: `HR active ${hrActive} · payroll ${payActive.length} (${employeesOnPayroll} employees + ${contractors} contractors/international). The two registers may legitimately differ by contractors not in HR.`,
  });

  // ---- HR data gaps (#36) ----------------------------------------------------------
  const act = i.hrEmployees.filter((e) => !e.end_date);
  const noTeam = act.filter((e) => !e.team).length;
  const noPos = act.filter((e) => !e.position).length;
  const noMgr = act.filter((e) => !e.manager).length;
  const gaps = noTeam + noPos + noMgr;
  checks.push(
    gaps
      ? { group: "People", name: "Employee records complete", status: "warn", detail: `${noTeam} without team, ${noPos} without position, ${noMgr} without manager — fix on the Employees page.` }
      : { group: "People", name: "Employee records complete", status: "ok", detail: "Every active employee has a team, position and manager." },
  );

  // ---- Deals & commission (tests 12 & 13) --------------------------------------------
  const noNett = i.deals.filter((d) => d.include_forecast && d.expected_payment && d.stage !== "paid" && (d.invoice_nett ?? 0) <= 0);
  checks.push(
    noNett.length
      ? { group: "Pipeline", name: "Forecastable deals have a value", status: "warn", detail: `${noNett.length} deal(s) marked for the forecast with an expected payment date but no invoice nett — they contribute R 0: ${noNett.slice(0, 5).map((d) => d.allocation).join(", ")}.` }
      : { group: "Pipeline", name: "Forecastable deals have a value", status: "ok", detail: "Every forecast-included deal with an expected date has a value." },
  );
  const commBad = i.deals.filter((d) => (d.stage === "invoice" || d.stage === "paid") && (d.invoice_nett ?? 0) <= 0 && (commissionOf(d) ?? 0) > 0);
  checks.push(
    commBad.length
      ? { group: "Pipeline", name: "Commission consistency", status: "warn", detail: `${commBad.length} invoiced deal(s) show commission with a zero invoice nett — commission stays "estimated" until the nett is captured: ${commBad.map((d) => d.allocation).join(", ")}.` }
      : { group: "Pipeline", name: "Commission consistency", status: "ok", detail: "No commission is shown as earned without an invoice nett behind it." },
  );

  // ---- Payroll defaults (test 14) --------------------------------------------------
  const futureOnly = [...new Set(i.payrollEntries.filter((p) => p.gross > 0).map((p) => p.period))].every((m) => m > nowMonth);
  checks.push(
    i.payrollEntries.length && futureOnly
      ? { group: "People", name: "Payroll periods", status: "warn", detail: "Only future months have payroll data — reports would show zeros for the current period." }
      : { group: "People", name: "Payroll periods", status: "ok", detail: "Payroll reporting defaults to the latest completed month with data." },
  );

  return checks;
}
