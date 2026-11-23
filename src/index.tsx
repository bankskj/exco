import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Bindings } from "./types";
import { checkPassword, startSession, endSession, isAuthed, requireAuth } from "./auth";
import { Landing, Login } from "./views/pages";
import { Dashboard } from "./views/dashboard";
import { HrDashboard, HrEmployeePage, tenure } from "./views/hr";
import {
  listHrEmployees,
  getHrEmployee,
  createHrEmployee,
  updateHrEmployee,
  listNotes,
  createNote,
  updateNote,
  getNote,
  deleteNote,
  warningCounts,
  documentsForNotes,
  registerDocument,
  getDocument,
  deleteDocumentsForNote,
  NOTE_KINDS,
} from "./data/hr";

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

import { ExpensesPage } from "./views/expenses";
import { listExpenses, createExpense, toggleExpense, deleteExpense, setExpenseFrequency, upsertXeroExpenses, monthlyEquivalent, FREQUENCIES, listVendorRules, setVendorRule, clearVendorRule, deleteExpenseByXeroId, replaceVendorBills, listVendorBills, listAllVendorBills, billingPatterns } from "./data/expenses";
import { VendorReviewPage, type AnnotatedVendor } from "./views/vendors";
import { SpendDetailPage, type SpendVendorRow, type SpendDoc } from "./views/monthly_expenses";
import { IncomePage, type ExpenseBucket } from "./views/income";
import { CashLiquidityPage } from "./views/cashflow_derived";
import { CommissionsPage } from "./views/commissions";
import { listCommissions, createCommission, setCommissionStage, setCommissionAmounts, updateCommissionDetails, deleteCommission, setIncludeForecast, listAllLines, addLine, deleteLine, COMM_STAGES, commissionOf } from "./data/commissions";
import { buildDerivedCashflow } from "./lib/cashflow_engine";
import { listRepeatingSchedules, replaceRepeatingSchedules } from "./data/repeating";
import { RecurringPage } from "./views/recurring";
import { projectSchedules, groupByDueMonth, RECURRING_HORIZON_MONTHS } from "./lib/recurring";
import { authUrl, exchangeCode, persistTokens, ensureAccessToken, fetchConnections, fetchRepeatingBills, fetchRepeatingRaw, toSchedules, fetchVendorBillSummary, vendorToBill, fetchProfitAndLoss, fetchDebtorCohorts, fetchActualTxns, fetchVatOwing, type PnL, type PnLRow } from "./lib/xero";
import { getAllMeta } from "./data/db";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { PayrollReportPage, PayrollCapturePage, buildPayrollReport } from "./views/payroll";
import { ForecastPage, type EntryMap, type ForecastTab } from "./views/cashflow_edit";
import { FinanceOverviewPage } from "./views/finance_overview";
import { ReceivablesPage, type CustomerRow } from "./views/receivables";
import { AdminPage, DataQualityPage } from "./views/admin";
import { buildSnapshot, type Snapshot } from "./lib/metrics";
import { buildQualityReport } from "./lib/quality";
import { ActualsPage } from "./views/actuals";
import { replaceXeroTxns, replaceSalesTxns, listXeroTxns, vendorSpendTotals, listOpenSales, openSalesByMonth, listSalesForMatching, invoiceReplacements, salesReceivedInMonth } from "./data/actuals";
// --- Client Billing & Cost Allocation (docs/client-billing.md) -------------
import { computePeriod } from "./lib/allocation";
import { firstMatchingRule } from "./lib/billing_rules";
import type { PeriodResult, ClientResult, ProjectResult, CostRule, StaffAllocation, BillingProject, StaffPiece, GroupAmount, SupplierAmount, TargetKind as BillingTargetKind, Treatment as GlTreatment, OverheadBasis } from "./lib/billing_types";
import {
  BillingError, getBillingPeriod, listBillingPeriods, setOverheadBasis, closePeriod, reopenPeriod, getSnapshot, getSnapshots,
  loadPeriodInput, loadPeriodInputs, syncBillingLedgers, mapContact, deleteContactMapping, addStaffPayee, deleteStaffPayee, listStaffPayees,
  setEmployeeBillingSettings, seedNameAliases, listClients, createClient, listBillingProjects, createProject, updateProject,
  closeProject, listCategories as listGlCategories, setCategoryTreatment, listContactMappings, setFixedShares,
  saveAllocations, copyAllocationsForward, clearAllocations, listDefaultAllocations, applyDefaultAllocations,
  listRevenueLinesForPeriods, listCostLinesForPeriods,
  setRevenueProjectOverride, setCostSplits, importCsv, listRules, saveRule, deleteRule, rulePreview, listAudit,
  type AllocationInput, type CostLineView,
} from "./data/billing";
import { getActor } from "./auth";
import { ClientsSummaryPage, ClientTrackerPage, ProjectViewPage, type BillingPeriodKey, type TrackerAggregate } from "./views/clients";
import { AllocationsPage, type AllocationsPageProps } from "./views/allocations";
import { CostInboxPage, CostRulesPage, type CostInboxTab, type CostInboxLine, type CostRuleListRow, type CostRuleEditing, type CostRulePreviewRow } from "./views/costs";
import { RevenueLinesPage, type RevenueLineRow } from "./views/revenue_lines";
import { ClientsSettingsPage, type SettingsClient } from "./views/clients_settings";
import { ClientClosePage, type CloseCheck } from "./views/clients_close";
import {
  listEmployees,
  listPayrollEntries,
  upsertPayrollField,
  pruneEntryIfEmpty,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  setEmployeeType,
  fillPayeFromDefaults,
  pruneEntriesAfter,
  EMPLOYEE_TYPES,
} from "./data/payroll";
import {
  listCategories,
  listEntries,
  upsertEntry,
  createCategory,
  deleteCategory,
  getSettings,
  saveSettings,
  upsertCfActuals,
  updateCfAccruals,
  listCfActuals,
  replaceCfDebtors,
  listCfDebtors,
  type CfActual,
} from "./data/cashflow";
import { getMeta, setMeta } from "./data/db";
import { computeForecast, type CFEntry } from "./lib/forecast";
import { parseMoney, formatZAR } from "./lib/money";
import { isPeriod, label, seq, fiscalYearOf, fyLabel, formatDMY, formatDMYTime, parseDateInput, addMonths, rangeInclusive } from "./lib/period";

/** Parse ?fy= against the FYs present in a timeline. Returns [allFys, selected|null]. */
function parseFy(timeline: string[], raw: string | undefined): [number[], number | null] {
  const fys = [...new Set(timeline.map(fiscalYearOf))].sort((a, b) => a - b);
  const n = Number(raw);
  return [fys, Number.isFinite(n) && fys.includes(n) ? n : null];
}

const app = new Hono<AppEnv>();
app.use("*", secureHeaders());

// --- Public --------------------------------------------------------------

app.get("/", (c) => c.html(<Landing />));

app.get("/login", async (c) => {
  if (await isAuthed(c)) return c.redirect("/app");
  return c.html(<Login error={c.req.query("error") === "1"} />);
});

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  if (await checkPassword(password, c)) {
    await startSession(c, typeof body.actor === "string" ? body.actor : "");
    return c.redirect("/app");
  }
  return c.redirect("/login?error=1");
});

app.post("/logout", (c) => {
  endSession(c);
  return c.redirect("/");
});

app.get("/healthz", (c) => c.json({ ok: true }));


// --- Protected -----------------------------------------------------------

app.use("/app", requireAuth);
app.use("/app/*", requireAuth);

app.get("/app", async (c) => {
  const { derived, snapshot } = await loadSnapshot(c.env);
  const msg = c.req.query("msg") ? decodeURIComponent(String(c.req.query("msg"))) : undefined;
  const vatRaw = await getMeta(c.env.DB, "vat_owing");
  const vatErr = (await getMeta(c.env.DB, "vat_error")) || null;
  const vat = vatRaw != null && vatRaw !== "" && !vatErr
    ? { amount: Number(vatRaw) || 0, accounts: (await getMeta(c.env.DB, "vat_owing_accounts")) || "VAT control", asAt: (await getMeta(c.env.DB, "vat_owing_asat")) || null }
    : null;
  return c.html(<Dashboard s={snapshot} vat={vat} vatError={vatErr} lastSyncLabel={derived.lastSync ? formatDMYTime(derived.lastSync) : null} msg={msg} />);
});

// ---------- Finance overview ----------

app.get("/app/finance", async (c) => {
  const { derived, snapshot } = await loadSnapshot(c.env);
  // FY-to-date cash movement and invoicing over the SAME completed-month
  // window as the profit block, so the bridge compares like-for-like.
  const fyStart = snapshot.profit.periodStart;
  const fyEnd = snapshot.profit.periodEnd;
  let cashReceivedFy = 0;
  let cashPaidFy = 0;
  let invoicedFy = 0;
  for (const [m, a] of derived.actuals) {
    if (m < fyStart || m > fyEnd) continue;
    cashReceivedFy += a.income;
    invoicedFy += a.income_accr;
  }
  for (const col of derived.cf.columns) {
    if (col.month < fyStart || col.month > fyEnd) continue;
    cashPaidFy += col.cost;
  }
  return c.html(
    <FinanceOverviewPage s={snapshot} cashReceivedFy={cashReceivedFy} cashPaidFy={cashPaidFy} invoicedFy={invoicedFy}
      lastSyncLabel={derived.lastSync ? formatDMYTime(derived.lastSync) : null} />,
  );
});

// ---------- Receivables ----------

app.get("/app/finance/receivables", async (c) => {
  const [txns, debtors, actuals, lastSync] = await Promise.all([
    listXeroTxns(c.env.DB),
    listCfDebtors(c.env.DB),
    listCfActuals(c.env.DB),
    getMeta(c.env.DB, "xero_last_sync"),
  ]);
  const openSales = txns.filter((t) => t.kind === "sale" && t.amount_due > 0.005).sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
  const now = Date.now();
  // Aging by invoice date (Xero due dates aren't synced).
  const aging = [
    { bucket: "0–30 days", lo: 0, hi: 30, value: 0 },
    { bucket: "31–60 days", lo: 31, hi: 60, value: 0 },
    { bucket: "61–90 days", lo: 61, hi: 90, value: 0 },
    { bucket: "90+ days", lo: 91, hi: Infinity, value: 0 },
  ];
  for (const t of openSales) {
    const days = Math.floor((now - Date.parse(t.txn_date)) / 86400_000);
    const b = aging.find((x) => days >= x.lo && days <= x.hi) ?? aging[3];
    b.value += t.amount_due;
  }
  // Customer table across the synced window.
  const byCustomer = new Map<string, CustomerRow>();
  for (const t of txns) {
    if (t.kind !== "sale") continue;
    if (!byCustomer.has(t.contact)) byCustomer.set(t.contact, { customer: t.contact, invoiced: 0, outstanding: 0, oldestOpen: null, daysOverdue: 0, openCount: 0 });
    const r = byCustomer.get(t.contact)!;
    r.invoiced += t.sub_total;
    if (t.amount_due > 0.005) {
      r.outstanding += t.amount_due;
      r.openCount++;
      if (!r.oldestOpen || t.txn_date < r.oldestOpen) r.oldestOpen = t.txn_date;
    }
  }
  const customers = [...byCustomer.values()]
    .map((r) => ({ ...r, daysOverdue: r.oldestOpen ? Math.floor((now - Date.parse(r.oldestOpen)) / 86400_000) : 0 }))
    .sort((a, b) => b.outstanding - a.outstanding || b.invoiced - a.invoiced);
  // Collections by billing month (accrual invoiced vs cash received vs live still-due).
  const collections = [...actuals.entries()]
    .filter(([, a]) => a.income_accr !== 0 || a.income !== 0)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 12)
    .map(([m, a]) => ({ month: m, invoiced: a.income_accr, received: a.income, stillDue: debtors.get(m)?.due ?? null }));
  const nowMonth = new Date().toISOString().slice(0, 7);
  const openCustomer = c.req.query("c")?.trim() || null;
  return c.html(
    <ReceivablesPage openSales={openSales} customers={customers} aging={aging.map(({ bucket, value }) => ({ bucket, value }))}
      collectedThisMonth={actuals.get(nowMonth)?.income ?? 0} collections={collections} openCustomer={openCustomer}
      lastSyncLabel={lastSync ? formatDMYTime(lastSync) : null} />,
  );
});

// ---------- Admin ----------

app.get("/app/admin", async (c) => {
  const xero = await xeroState(c);
  const msg = c.req.query("msg") ? decodeURIComponent(String(c.req.query("msg"))) : undefined;
  return c.html(<AdminPage xero={xero} msg={msg} lastSyncLabel={xero.lastSync ? formatDMYTime(xero.lastSync) : null} />);
});

app.get("/app/admin/quality", async (c) => {
  const { derived, snapshot, txns, hrEmployees } = await loadSnapshot(c.env);
  const [dealLines, vendorBills, debtors, actualsError] = await Promise.all([
    listAllLines(c.env.DB),
    listAllVendorBills(c.env.DB),
    listCfDebtors(c.env.DB),
    getMeta(c.env.DB, "xero_actuals_error"),
  ]);
  void dealLines;
  const checks = buildQualityReport({
    cf: derived.cf,
    actuals: derived.actuals,
    boundary: snapshot.boundary,
    txns,
    debtorsDue: [...debtors.values()].reduce((t, d) => t + d.due, 0),
    deals: derived.deals,
    expenses: derived.allExpenses,
    vendorBills,
    payrollEmployees: derived.payrollEmps,
    payrollEntries: derived.payrollEntries,
    hrEmployees,
    lastSync: derived.lastSync,
    actualsError: actualsError || null,
  });
  return c.html(<DataQualityPage checks={checks} lastSyncLabel={derived.lastSync ? formatDMYTime(derived.lastSync) : null} />);
});

// ---------- Projects (retired — replaced by Client Billing) ----------
// The old Xero-Projects reporting moved to /app/clients; xero_project*
// tables stay read-only for one quarter before a drop migration.

app.get("/app/projects", (c) => c.redirect("/app/clients"));
app.post("/app/projects/import", (c) => c.redirect("/app/clients"));

// ---------- Payroll ----------

async function loadPayroll(db: D1Database) {
  const [employees, entries] = await Promise.all([listEmployees(db), listPayrollEntries(db)]);
  const report = buildPayrollReport(employees, entries);
  return { employees, entries, report };
}

app.get("/app/payroll", async (c) => {
  const [employees, entries] = await Promise.all([listEmployees(c.env.DB), listPayrollEntries(c.env.DB)]);
  const m = c.req.query("m");
  const report = buildPayrollReport(employees, entries, m && isPeriod(m) ? m : null);
  return c.html(<PayrollReportPage employees={employees} report={report} />);
});

app.get("/app/payroll/capture", async (c) => {
  const { employees, report } = await loadPayroll(c.env.DB);
  // Default window: 6 months starting two months back (today Sep → from Jul).
  const defaultFrom = addMonths(new Date().toISOString().slice(0, 7), -2);
  const fromRaw = c.req.query("from");
  const from = fromRaw && isPeriod(fromRaw) ? fromRaw : defaultFrom;
  const monthsRaw = Number(c.req.query("months"));
  const months = Number.isFinite(monthsRaw) ? Math.max(1, Math.min(24, Math.trunc(monthsRaw))) : 6;
  const mRaw = c.req.query("metric");
  const metric = mRaw === "paye" || mRaw === "nett" ? mRaw : "gross";
  const tRaw = c.req.query("type");
  const typeFilter = EMPLOYEE_TYPES.includes(tRaw as any) ? (tRaw as (typeof EMPLOYEE_TYPES)[number]) : null;
  const gridPeriods = seq(from, months);
  const imp = c.req.query("import");
  let importMsg: string | undefined;
  if (imp === "err") importMsg = "Import failed — upload a CSV with at least a Name column (use the export as a template).";
  else if (imp) {
    const m = imp.match(/^(\d+)u-(\d+)c$/);
    if (m) importMsg = `Import complete: ${m[1]} employee(s) updated, ${m[2]} created.`;
  }
  return c.html(
    <PayrollCapturePage employees={employees} report={report} gridPeriods={gridPeriods} from={from} months={months} metric={metric} typeFilter={typeFilter} saved={c.req.query("saved") === "1"} importMsg={importMsg} />,
  );
});

app.post("/app/payroll/save", async (c) => {
  const body = await c.req.parseBody();
  // Nett is derived, never saved. Save whichever field the grid was showing.
  const field = String(body.metric) === "paye" ? "paye" : "gross";
  const prefix = field === "gross" ? "g_" : "t_";
  const current = await listPayrollEntries(c.env.DB);
  const cur = new Map<string, number>();
  for (const e of current) cur.set(`${e.employee_id}|${e.period}`, field === "gross" ? e.gross : e.paye);

  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith(prefix) || typeof raw !== "string") continue;
    const rest = key.slice(2);
    const idx = rest.lastIndexOf("_");
    const employeeId = rest.slice(0, idx);
    const period = rest.slice(idx + 1);
    if (!isPeriod(period)) continue;
    const trimmed = raw.trim();
    // A typed 0 is a real value ("paid nothing"); a cleared cell means "no
    // entry" and returns the cell to the planned prefill.
    const newVal = trimmed === "" ? null : parseMoney(trimmed);
    const hadRow = cur.has(`${employeeId}|${period}`);
    const oldVal = hadRow ? cur.get(`${employeeId}|${period}`)! : null;
    if (newVal == null) {
      if (!hadRow) continue;
      await upsertPayrollField(c.env.DB, employeeId, period, field, null);
      await pruneEntryIfEmpty(c.env.DB, employeeId, period);
      continue;
    }
    if (oldVal != null && Math.abs(newVal - oldVal) < 0.005) continue;
    await upsertPayrollField(c.env.DB, employeeId, period, field, newVal);
  }
  const keep = new URLSearchParams({ metric: field, saved: "1" });
  if (EMPLOYEE_TYPES.includes(String(body.type) as any)) keep.set("type", String(body.type));
  if (isPeriod(String(body.from))) keep.set("from", String(body.from));
  if (/^\d{1,2}$/.test(String(body.months))) keep.set("months", String(body.months));
  return c.redirect(`/app/payroll/capture?${keep.toString()}`);
});

app.post("/app/payroll/employee", async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? "").trim();
  const type = EMPLOYEE_TYPES.includes(String(b.type) as any) ? String(b.type) : "za";
  if (name) {
    await createEmployee(c.env.DB, {
      name,
      type,
      mentor: String(b.mentor ?? "").trim() || null,
      ctc: b.ctc ? parseMoney(String(b.ctc)) : null,
      paye_default: b.paye_default ? parseMoney(String(b.paye_default)) : 0,
      status: String(b.status ?? "active"),
    });
  }
  return c.redirect("/app/payroll/capture");
});

app.post("/app/payroll/employees/save", async (c) => {
  const b = await c.req.parseBody();
  const employees = await listEmployees(c.env.DB);
  for (const e of employees) {
    const name = b[`en_${e.id}`];
    if (typeof name !== "string") continue; // row not present in this submit
    const trimmedName = name.trim();
    if (!trimmedName) continue; // never blank a name
    const type = EMPLOYEE_TYPES.includes(String(b[`et_${e.id}`]) as any) ? String(b[`et_${e.id}`]) : e.type;
    const mentor = String(b[`em_${e.id}`] ?? "").trim() || null;
    const ctcRaw = String(b[`ec_${e.id}`] ?? "").trim();
    const ctc = ctcRaw === "" ? null : parseMoney(ctcRaw);
    const payeRaw = String(b[`ep_${e.id}`] ?? "").trim();
    const paye_default = payeRaw === "" ? 0 : parseMoney(payeRaw);
    const status = String(b[`es_${e.id}`]) === "inactive" ? "inactive" : "active";
    // Last paid month is editable (future months allowed — staff leaving later);
    // it defaults to the current month on the transition, clears on reactivation.
    const eiRaw = String(b[`ei_${e.id}`] ?? "").trim();
    const eiMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(eiRaw) ? eiRaw : null;
    let inactive_date = e.inactive_date;
    if (status === "inactive") {
      if (eiMonth) inactive_date = `${eiMonth}-01`;
      else if (e.status === "active") inactive_date = new Date().toISOString().slice(0, 10);
    }
    if (status === "active") inactive_date = null;
    const changed =
      trimmedName !== e.name || type !== e.type || mentor !== (e.mentor ?? null) ||
      (ctc ?? null) !== (e.ctc ?? null) || paye_default !== e.paye_default || status !== e.status ||
      inactive_date !== e.inactive_date;
    if (changed) {
      await updateEmployee(c.env.DB, e.id, { name: trimmedName, mentor, ctc, paye_default, type, status, inactive_date });
      if (status === "inactive" && inactive_date) await pruneEntriesAfter(c.env.DB, e.id, inactive_date.slice(0, 7));
    }
  }
  return c.redirect("/app/payroll/capture?saved=1");
});

app.get("/app/payroll/employees.csv", async (c) => {
  const employees = await listEmployees(c.env.DB);
  const lines = ["ID,Name,Type,Mentor,CTC,Default PAYE,Default Nett,Status"];
  for (const e of employees) {
    const nett = e.ctc != null ? e.ctc - e.paye_default : null;
    lines.push(
      [
        e.id,
        csv(e.name),
        e.type,
        csv(e.mentor ?? ""),
        e.ctc != null ? e.ctc.toFixed(2) : "",
        e.paye_default ? e.paye_default.toFixed(2) : "",
        nett != null ? nett.toFixed(2) : "",
        e.status,
      ].join(","),
    );
  }
  return csvResponse(c, "employees.csv", lines.join("\n"));
});

app.post("/app/payroll/employees/import", async (c) => {
  const body = await c.req.parseBody();
  const f = body.file;
  if (!(f instanceof File)) return c.redirect("/app/payroll/capture?import=err");
  let text = await f.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseCsv(text);
  if (rows.length < 2) return c.redirect("/app/payroll/capture?import=err");

  // Map columns by header name (case/space tolerant).
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iId = col("id");
  const iName = col("name", "employee");
  const iType = col("type");
  const iMentor = col("mentor", "mentor / director", "director");
  const iCtc = col("ctc", "ctc / gross", "gross", "ctc (monthly)");
  const iPaye = col("default paye", "paye");
  const iNett = col("default nett", "nett");
  const iStatus = col("status");
  if (iName === -1) return c.redirect("/app/payroll/capture?import=err");

  const employees = await listEmployees(c.env.DB);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const byName = new Map(employees.map((e) => [e.name.trim().toLowerCase(), e]));
  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");
  const normType = (raw: string, fallback: string): string => {
    const t = raw.toLowerCase();
    if (t.startsWith("za")) return "za";
    if (t.startsWith("int")) return "international";
    if (t.startsWith("free")) return "freelancer";
    return fallback;
  };

  let updated = 0;
  let created = 0;
  for (const r of rows.slice(1)) {
    const name = cell(r, iName);
    if (!name) continue;
    const existing = byId.get(cell(r, iId)) ?? byName.get(name.toLowerCase()) ?? null;
    const type = normType(cell(r, iType), existing?.type ?? "za");
    const mentor = iMentor >= 0 ? cell(r, iMentor) || null : existing?.mentor ?? null;
    const ctcRaw = cell(r, iCtc);
    const ctc = ctcRaw !== "" ? parseMoney(ctcRaw) : existing?.ctc ?? null;
    // PAYE precedence: explicit PAYE cell > derived from nett (CTC - nett) > existing.
    const payeRaw = cell(r, iPaye);
    const nettRaw = cell(r, iNett);
    let paye_default = existing?.paye_default ?? 0;
    if (payeRaw !== "") paye_default = Math.max(0, parseMoney(payeRaw));
    else if (nettRaw !== "" && ctc != null) paye_default = Math.max(0, ctc - parseMoney(nettRaw));
    const statusRaw = cell(r, iStatus).toLowerCase();
    const status = statusRaw === "inactive" ? "inactive" : statusRaw === "active" ? "active" : existing?.status ?? "active";

    if (existing) {
      let inactive_date = existing.inactive_date;
      if (status === "inactive" && existing.status === "active") inactive_date = new Date().toISOString().slice(0, 10);
      if (status === "active") inactive_date = null;
      await updateEmployee(c.env.DB, existing.id, { name, mentor, ctc, paye_default, type, status, inactive_date });
      if (status === "inactive" && inactive_date) await pruneEntriesAfter(c.env.DB, existing.id, inactive_date.slice(0, 7));
      updated++;
    } else {
      await createEmployee(c.env.DB, { name, mentor, ctc, paye_default, type, status });
      created++;
    }
  }
  return c.redirect(`/app/payroll/capture?import=${updated}u-${created}c`);
});

app.post("/app/payroll/paye/fill", async (c) => {
  const b = await c.req.parseBody();
  const from = isPeriod(String(b.from)) ? String(b.from) : "2026-01";
  const monthsN = Number(b.months);
  const months = Number.isFinite(monthsN) ? Math.max(1, Math.min(24, Math.trunc(monthsN))) : 14;
  await fillPayeFromDefaults(c.env.DB, seq(from, months));
  return c.redirect(`/app/payroll/capture?metric=paye&from=${from}&months=${months}&saved=1`);
});

app.post("/app/payroll/employee/type", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  const type = EMPLOYEE_TYPES.includes(String(b.type) as any) ? String(b.type) : "za";
  if (id) await setEmployeeType(c.env.DB, id, type);
  return c.redirect("/app/payroll/capture");
});

app.post("/app/payroll/employee/delete", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  if (id) await deleteEmployee(c.env.DB, id);
  return c.redirect("/app/payroll/capture");
});

app.get("/app/payroll/export.csv", async (c) => {
  const { employees, report } = await loadPayroll(c.env.DB);
  // Long format: one row per employee-month with gross/PAYE/nett — best for analysis.
  const head = ["Employee", "Type", "Mentor", "Month", "Gross", "PAYE", "Nett"];
  const lines = [head.join(",")];
  for (const e of employees) {
    const row = report.matrix.get(e.id);
    if (!row) continue;
    for (const p of report.periods) {
      const cell = row.get(p);
      if (!cell || (cell.gross === 0 && cell.paye === 0)) continue;
      const nett = cell.gross - cell.paye;
      lines.push(
        [csv(e.name), e.type, csv(e.mentor ?? ""), p, cell.gross.toFixed(2), cell.paye.toFixed(2), nett.toFixed(2)].join(","),
      );
    }
  }
  return csvResponse(c, "payroll.csv", lines.join("\n"));
});

// ---------- Accounts / Cashflow ----------

async function loadCashflow(db: D1Database) {
  const [categories, entries, settings] = await Promise.all([listCategories(db), listEntries(db), getSettings(db)]);
  const at = settings.actuals_through;
  // Apply the actuals-through boundary so status reflects the current lock point.
  const normalized: CFEntry[] = entries.map((e) => ({
    ...e,
    status: e.period <= at ? "actual" : "forecast",
  }));
  const forecast = computeForecast(categories, normalized, settings);
  return { categories, entries, settings, actualsThrough: at, forecast };
}

/** One call that produces the canonical KPI snapshot every summary page uses. */
async function loadSnapshot(env: Bindings) {
  const derived = await loadDerived(env, "cash");
  const [txns, dealLines, hrEmployees] = await Promise.all([
    listXeroTxns(env.DB),
    listAllLines(env.DB),
    listHrEmployees(env.DB),
  ]);
  const snapshot = buildSnapshot({
    cf: derived.cf,
    actuals: derived.actuals,
    boundary: derived.settings.actuals_through,
    revolvingOwed: derived.position.revolving,
    facilityLimit: derived.facilityLimit,
    txns,
    deals: derived.deals,
    dealLines,
    expenses: derived.allExpenses,
    payrollEmployees: derived.payrollEmps,
    payrollEntries: derived.payrollEntries,
    hrEmployees,
    lastSync: derived.lastSync,
  });
  return { derived, snapshot, txns, hrEmployees };
}

const OVERRIDE_GRP = "__override__";
const OVERRIDE_NAMES = ["Income", "People", "Other expenses"];

async function loadDerived(env: Bindings, basis: "cash" | "accrual" = "cash") {
  const [settings, actuals, payrollEntries, payrollEmps, allExpenses, categories, entries, synced] = await Promise.all([
    getSettings(env.DB),
    listCfActuals(env.DB),
    listPayrollEntries(env.DB),
    listEmployees(env.DB),
    listExpenses(env.DB),
    listCategories(env.DB),
    listEntries(env.DB),
    getMeta(env.DB, "cf_actuals_synced"),
  ]);
  // Total payroll gross by month — the grid covers salaried staff AND the
  // contractors/freelancers who appear in Xero as Developer/Contractor bills.
  // Months after an employee's inactive date don't count.
  const empById = new Map(payrollEmps.map((e) => [e.id, e]));
  const payrollByMonth = new Map<string, number>();
  const payrollCount = new Map<string, number>();
  for (const pe of payrollEntries) {
    const emp = empById.get(pe.employee_id);
    if (emp?.status === "inactive" && emp.inactive_date && pe.period > emp.inactive_date.slice(0, 7)) continue;
    payrollByMonth.set(pe.period, (payrollByMonth.get(pe.period) ?? 0) + pe.gross);
    payrollCount.set(pe.period, (payrollCount.get(pe.period) ?? 0) + 1);
  }
  // Fallback people cost beyond the grid: CTC of everyone on payroll that
  // month — active staff plus future-dated leavers until their last month.
  const activeEmps = payrollEmps.filter((e) => e.status === "active");
  const activeCtcFor = (month: string): number =>
    payrollEmps.reduce((t, e) => {
      const on = e.status === "active" || (e.status === "inactive" && !!e.inactive_date && month <= e.inactive_date.slice(0, 7));
      return on ? t + (e.ctc ?? 0) : t;
    }, 0);
  // A partially captured month (fewer than half the active staff, e.g. one
  // early cell) is not a usable people forecast — drop it so the engine
  // falls back to active CTC instead of a near-empty grid total.
  const payrollThreshold = Math.max(1, Math.ceil(activeEmps.length / 2));
  for (const [m, n] of payrollCount) {
    if (n < payrollThreshold) payrollByMonth.delete(m);
  }
  const manualMonthly = allExpenses
    .filter((e) => e.source === "manual" && e.active)
    .reduce((sum, e) => sum + monthlyEquivalent(e), 0);
  // SARS cash payments by month (tracked from the bank feed by reference).
  const { results: sarsRows } = await env.DB
    .prepare("SELECT substr(bill_date,1,7) m, SUM(amount) t FROM vendor_bills WHERE vendor_name = 'SARS (tax)' GROUP BY m")
    .all<{ m: string; t: number }>();
  const sarsByMonth = new Map((sarsRows ?? []).map((r) => [r.m, r.t]));
  // Grid layer: override categories replace model values; the rest add on top.
  const overrideCats = categories.filter((cat) => cat.grp === OVERRIDE_GRP);
  const adjCats = categories.filter((cat) => cat.grp !== OVERRIDE_GRP);
  const overrides: import("./lib/cashflow_engine").CfOverrides = new Map();
  const adjRows: import("./lib/cashflow_engine").CfAdjustmentRow[] = adjCats.map((cat) => ({ id: cat.id, name: cat.name, kind: cat.kind, values: new Map() }));
  const adjById = new Map(adjRows.map((r) => [r.id, r]));
  const ovKind = new Map(overrideCats.map((cat) => [cat.id, /income/i.test(cat.name) ? "income" : /people/i.test(cat.name) ? "people" : "other"] as const));
  for (const e of entries) {
    const ok = ovKind.get(e.category_id);
    if (ok) {
      const ov = overrides.get(e.period) ?? {};
      (ov as any)[ok] = e.amount;
      overrides.set(e.period, ov);
    } else {
      adjById.get(e.category_id)?.values.set(e.period, e.amount);
    }
  }
  // A typed income amount for a customer stops counting once Xero has a real
  // invoice landing in that month (open or paid) — the invoice counts instead.
  // The typed value stays saved; it is only ignored while the invoice exists.
  const replaced = invoiceReplacements(
    adjRows.filter((r) => r.kind === "income"),
    await listSalesForMatching(env.DB),
    new Date().toISOString().slice(0, 7),
  );
  for (const [rowId, months] of replaced) {
    for (const m of months.keys()) adjById.get(rowId)?.values.delete(m);
  }
  // Deals pipeline: unpaid, forecast-included deals with an expected payment date land as forecast income.
  const deals = await listCommissions(env.DB);
  const dealValues = new Map<string, number>();
  for (const d of deals) {
    if (d.stage === "paid" || !d.include_forecast || !d.expected_payment || d.invoice_nett == null) continue;
    const m = d.expected_payment.slice(0, 7);
    dealValues.set(m, (dealValues.get(m) ?? 0) + d.invoice_nett);
  }
  if (dealValues.size > 0) {
    adjRows.push({ id: "__deals__", name: "Deals — expected payments", kind: "income", values: dealValues });
  }
  // Commission owed to staff goes out as cash when the deal pays — forecast it
  // as a cost in the same month as the deal's expected payment.
  const dealCommValues = new Map<string, number>();
  for (const d of deals) {
    if (d.stage === "paid" || !d.include_forecast || !d.expected_payment) continue;
    const comm = commissionOf(d);
    if (!comm) continue;
    const m = d.expected_payment.slice(0, 7);
    dealCommValues.set(m, (dealCommValues.get(m) ?? 0) + comm);
  }
  if (dealCommValues.size > 0) {
    adjRows.push({ id: "__deal_comm__", name: "Commission owed (deals)", kind: "cost", values: dealCommValues });
  }
  // Xero repeating schedules → scheduled recurring income / committed bills,
  // projected fresh from today. Forecast is in ZAR, so other currencies are
  // listed on the Recurring page but kept out of the totals.
  const schedules = (await listRepeatingSchedules(env.DB)).filter((s) => s.currency === "ZAR");
  const today = new Date().toISOString().slice(0, 10);
  // Project schedules to the end of the engine window (never less than the
  // default 12 months), so no forecast month is left with zero income.
  const engineEnd = addMonths(settings.actuals_through, Math.max(1, settings.horizon_months));
  const recurringMonths = Math.max(RECURRING_HORIZON_MONTHS, monthsBetweenIncl(today.slice(0, 7), engineEnd));
  const projected = projectSchedules(schedules, today, recurringMonths);
  const recurringByMonth = groupByDueMonth(projected, schedules, today);
  const openInvoices = openSalesByMonth(await listOpenSales(env.DB), today.slice(0, 7));
  const scheduled: import("./lib/cashflow_engine").CfScheduled = {
    income: recurringByMonth.income,
    bills: recurringByMonth.bills,
    incomeRunRate: recurringByMonth.incomeRunRate,
    billRunRate: recurringByMonth.billRunRate,
    openInvoices,
    received: new Map([[today.slice(0, 7), await salesReceivedInMonth(env.DB, today.slice(0, 7))]]),
    coveredFrom: today.slice(0, 7),
    coveredThrough: addMonths(today.slice(0, 7), recurringMonths - 1),
  };
  // Until the first sync after deploy the schedules table is empty: keep the
  // trend estimate for income rather than showing a collapsed forecast.
  const repeatingSynced = await getMeta(env.DB, "xero_repeating_synced");
  const actualsForBasis = basis === "cash"
    ? actuals
    : new Map([...actuals.entries()].map(([m, a]) => [m, { ...a, income: a.income_accr, staff: a.staff_accr, dev: a.dev_accr, other: a.other_accr }]));
  const cf = buildDerivedCashflow(actualsForBasis, payrollByMonth, manualMonthly, settings, overrides, adjRows, basis === "cash" ? sarsByMonth : new Map(), activeCtcFor, repeatingSynced ? scheduled : null);
  // Collections gap: invoiced (accrual) vs received (cash) per complete month,
  // plus invoice-cohort truth: how much of that month's billing is unpaid TODAY.
  const debtors = await listCfDebtors(env.DB);
  const collections = cf.months
    .filter((m) => m <= settings.actuals_through)
    .map((m) => {
      const a = actuals.get(m);
      const invoiced = a?.income_accr ?? 0;
      const received = a?.income ?? 0;
      const d = debtors.get(m);
      return { month: m, invoiced, received, gap: invoiced - received, stillDue: d?.due ?? null };
    })
    .filter((r) => r.invoiced !== 0 || r.received !== 0);
  const syncNote = actuals.size === 0
    ? (synced ? "P&L actuals are empty — run a Xero sync on the Expenses tab." : "No P&L actuals yet — reconnect Xero (report scope) and run a sync on the Expenses tab to populate the model.")
    : !repeatingSynced
      ? "Recurring invoices have not been synced yet, so forecast income is still the trend estimate. Run a Xero sync on the Expenses tab."
      : undefined;
  const debtorsDue = [...debtors.values()].reduce((t, d) => t + d.due, 0);
  const revolving = Number((await getMeta(env.DB, "cf_revolving_owed")) ?? 0) || 0;
  const facilityLimitRaw = await getMeta(env.DB, "cf_facility_limit");
  const facilityLimit = facilityLimitRaw != null && facilityLimitRaw !== "" ? Number(facilityLimitRaw) || 0 : null;
  const lastSync = await getMeta(env.DB, "xero_last_sync");
  const nowMonth2 = new Date().toISOString().slice(0, 7);
  const bankToday = cf.columns.find((col) => col.month === nowMonth2)?.balance ?? cf.kpis.currentCash;
  const position = { bankToday, debtorsDue, revolving, month: nowMonth2 };
  return { settings, cf, actuals, syncNote, overrideCats, adjCats, entries, collections, position, dealValues, dealCommValues, deals, facilityLimit, lastSync, payrollEmps, payrollEntries, allExpenses, scheduled, replaced };
}

app.get("/app/finance/cash", async (c) => {
  // Cash & Liquidity is cash-basis only: the accrual P&L that matches Xero lives on Profit & Loss.
  const { derived, snapshot } = await loadSnapshot(c.env);
  const { settings, cf, syncNote } = derived;
  const fyRaw = c.req.query("fy");
  let [fys, fy] = parseFy(cf.months, fyRaw);
  if (fy == null && fyRaw !== "all") {
    const curFy = fiscalYearOf(new Date().toISOString().slice(0, 7));
    if (fys.includes(curFy)) fy = curFy;
  }
  const msg = c.req.query("msg") ? decodeURIComponent(String(c.req.query("msg"))) : undefined;
  return c.html(
    <CashLiquidityPage cf={cf} settings={settings} fy={fy} fys={fys}
      bankEstimate={snapshot.cash.bankEstimate} facility={snapshot.facility} liquidity={snapshot.liquidity}
      risk={snapshot.cash.risk} fundingMonth={snapshot.cash.fundingMonth} next30Net={snapshot.cash.next30Net}
      receivablesOutstanding={snapshot.receivables.outstanding} commissionOwed={snapshot.pipeline.commissionEarned}
      syncNote={syncNote} lastSync={derived.lastSync ? formatDMYTime(derived.lastSync) : null} msg={msg} />,
  );
});
app.get("/app/accounts", (c) => c.redirect(`/app/finance/cash${c.req.query("fy") ? `?fy=${c.req.query("fy")}` : ""}`));
app.get("/app/accounts/income", (c) => c.redirect("/app/finance/pnl"));
app.get("/app/accounts/actuals", (c) => c.redirect("/app/finance/transactions"));
app.get("/app/expenses", (c) => c.redirect("/app/finance/costs"));
app.get("/app/expenses/monthly", (c) => c.redirect("/app/finance/costs/monthly"));
app.get("/app/expenses/vendors", (c) => c.redirect("/app/admin/vendors"));

app.get("/app/finance/forecast", async (c) => {
  // Ensure the three override rows exist (idempotent).
  const existing = await listCategories(c.env.DB);
  for (const name of OVERRIDE_NAMES) {
    if (!existing.some((cat) => cat.grp === OVERRIDE_GRP && cat.name === name)) {
      await createCategory(c.env.DB, { name, kind: name === "Income" ? "income" : "cost", grp: OVERRIDE_GRP });
    }
  }
  const { derived, snapshot } = await loadSnapshot(c.env);
  const { settings, cf, overrideCats, adjCats, entries, dealValues, dealCommValues, scheduled, replaced } = derived;
  const map: EntryMap = new Map();
  for (const e of entries) {
    if (!map.has(e.category_id)) map.set(e.category_id, new Map());
    map.get(e.category_id)!.set(e.period, { amount: e.amount, status: "forecast" });
  }
  const tRaw = String(c.req.query("t") ?? "overview");
  const tab: ForecastTab = tRaw === "monthly" || tRaw === "assumptions" ? tRaw : "overview";
  return c.html(
    <ForecastPage cf={cf} settings={settings} overrideCats={overrideCats} adjCats={adjCats} entries={map}
      dealValues={dealValues} dealCommValues={dealCommValues} currentMonth={scheduled.coveredFrom} replaced={replaced} boundary={settings.actuals_through} tab={tab}
      facility={{ used: snapshot.facility.used, limit: snapshot.facility.limit }} bankEstimate={snapshot.cash.bankEstimate}
      lastSync={derived.lastSync ? formatDMYTime(derived.lastSync) : null}
      line={c.req.query("line")} saved={c.req.query("saved") === "1"} />,
  );
});
app.get("/app/accounts/edit", (c) => c.redirect("/app/finance/forecast?t=monthly"));

app.get("/app/finance/recurring", async (c) => {
  const [schedules, synced, error] = await Promise.all([
    listRepeatingSchedules(c.env.DB),
    getMeta(c.env.DB, "xero_repeating_synced"),
    getMeta(c.env.DB, "xero_repeating_error"),
  ]);
  const projected = projectSchedules(schedules.filter((s) => s.currency === "ZAR"));
  return c.html(
    <RecurringPage schedules={schedules} projected={projected} horizonMonths={RECURRING_HORIZON_MONTHS}
      synced={synced ? formatDMYTime(synced) : null} error={error || null} />,
  );
});

app.post("/app/accounts/save", async (c) => {
  const body = await c.req.parseBody();
  const at = (await getMeta(c.env.DB, "cf_actuals_through")) || "";
  const current = await listEntries(c.env.DB);
  const cur = new Map<string, number>();
  for (const e of current) cur.set(`${e.category_id}|${e.period}`, e.amount);

  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith("e_") || typeof raw !== "string") continue;
    const rest = key.slice(2);
    const idx = rest.lastIndexOf("_");
    const categoryId = rest.slice(0, idx);
    const period = rest.slice(idx + 1);
    if (!isPeriod(period)) continue;
    const trimmed = raw.trim();
    const newVal = trimmed === "" ? null : parseMoney(trimmed);
    const oldVal = cur.get(`${categoryId}|${period}`);
    if (newVal == null && oldVal == null) continue;
    if (newVal != null && oldVal != null && Math.abs(newVal - oldVal) < 0.005) continue;
    const status = period <= at ? "actual" : "forecast";
    await upsertEntry(c.env.DB, categoryId, period, newVal, status);
  }
  // Keep the details drawer open when the save came from it.
  const line = String(body.line ?? "");
  return c.redirect(`/app/finance/forecast?t=monthly&saved=1${line && /^[a-z_0-9-]+$/i.test(line) ? `&line=${line}` : ""}`);
});

app.post("/app/accounts/actuals-through", async (c) => {
  const b = await c.req.parseBody();
  const p = String(b.actuals_through ?? "");
  if (isPeriod(p)) {
    await setMeta(c.env.DB, "cf_actuals_through", p);
    // Keep stored entry statuses consistent with the new boundary.
    await c.env.DB.prepare("UPDATE cf_entries SET status = CASE WHEN period <= ? THEN 'actual' ELSE 'forecast' END").bind(p).run();
  }
  return c.redirect("/app/finance/forecast?t=assumptions&saved=1");
});

app.post("/app/accounts/category", async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? "").trim();
  const kind = String(b.kind ?? "cost") === "income" ? "income" : "cost";
  if (name) {
    await createCategory(c.env.DB, {
      name,
      kind,
      grp: String(b.grp ?? "").trim() || null,
      is_recurring: String(b.is_recurring ?? "0") === "1",
    });
  }
  return c.redirect("/app/finance/forecast?t=monthly&saved=1");
});

app.post("/app/accounts/category/delete", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  if (id) await deleteCategory(c.env.DB, id);
  return c.redirect("/app/finance/forecast?t=monthly&saved=1");
});

app.post("/app/accounts/settings", async (c) => {
  const b = await c.req.parseBody();
  const n = (v: unknown, d: number) => {
    const x = Number(String(v ?? ""));
    return Number.isFinite(x) ? x : d;
  };
  const s = await getSettings(c.env.DB);
  await saveSettings(c.env.DB, {
    opening_balance: parseMoney(String(b.opening_balance ?? s.opening_balance)),
    opening_period: isPeriod(String(b.opening_period)) ? String(b.opening_period) : s.opening_period,
    actuals_through: isPeriod(String(b.actuals_through)) ? String(b.actuals_through) : s.actuals_through,
    horizon_months: Math.max(1, Math.min(60, n(b.horizon_months, s.horizon_months))),
    best_income_pct: n(b.best_income_pct, s.best_income_pct),
    best_cost_pct: n(b.best_cost_pct, s.best_cost_pct),
    worst_income_pct: n(b.worst_income_pct, s.worst_income_pct),
    worst_cost_pct: n(b.worst_cost_pct, s.worst_cost_pct),
  });
  if (b.revolving_owed != null) await setMeta(c.env.DB, "cf_revolving_owed", String(parseMoney(String(b.revolving_owed))));
  if (b.facility_limit != null) {
    const lim = String(b.facility_limit).trim();
    await setMeta(c.env.DB, "cf_facility_limit", lim === "" ? "" : String(parseMoney(lim)));
  }
  return c.redirect("/app/finance/forecast?t=assumptions&saved=1");
});

app.get("/app/accounts/export.csv", async (c) => {
  const { categories, forecast } = await loadCashflow(c.env.DB); // legacy manual grid export
  const [, fy] = parseFy(forecast.timeline, c.req.query("fy"));
  const periods = fy == null ? forecast.timeline : forecast.timeline.filter((p) => fiscalYearOf(p) === fy);
  const col = new Map(forecast.base.map((x) => [x.period, x]));
  const head = ["Line item", "Type", ...periods.map(label)];
  const lines = [head.map(csv).join(",")];
  const emit = (kind: "income" | "cost") => {
    for (const cat of categories.filter((x) => x.kind === kind)) {
      const cells = periods.map((p) => {
        const v = col.get(p)?.cells[cat.id]?.amount ?? 0;
        return v ? v.toFixed(2) : "";
      });
      lines.push([csv(cat.name), kind, ...cells].join(","));
    }
  };
  emit("income");
  lines.push(["Total income", "", ...periods.map((p) => (col.get(p)?.income ?? 0).toFixed(2))].map(csv).join(","));
  emit("cost");
  lines.push(["Total cost", "", ...periods.map((p) => (col.get(p)?.cost ?? 0).toFixed(2))].map(csv).join(","));
  lines.push(["Net", "", ...periods.map((p) => (col.get(p)?.net ?? 0).toFixed(2))].map(csv).join(","));
  lines.push(["Cash balance", "", ...periods.map((p) => (col.get(p)?.balance ?? 0).toFixed(2))].map(csv).join(","));
  return csvResponse(c, "cashflow.csv", lines.join("\n"));
});

// ---------- HR ----------

app.get("/app/hr", async (c) => {
  const [employees, warnings] = await Promise.all([listHrEmployees(c.env.DB), warningCounts(c.env.DB)]);
  const showRaw = c.req.query("show");
  const show = showRaw === "left" || showRaw === "all" ? showRaw : "active";
  return c.html(<HrDashboard employees={employees} warnings={warnings} now={new Date()} show={show} />);
});

app.post("/app/hr/employee", async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? "").trim();
  if (name) {
    const id = await createHrEmployee(c.env.DB, {
      name,
      email: String(b.email ?? "").trim() || null,
      position: String(b.position ?? "").trim() || null,
      team: String(b.team ?? "").trim() || null,
      manager: String(b.manager ?? "").trim() || null,
      start_date: parseDateInput(String(b.start_date)),
    });
    return c.redirect(`/app/hr/${id}`);
  }
  return c.redirect("/app/hr");
});

app.get("/app/hr/export.csv", async (c) => {
  const employees = await listHrEmployees(c.env.DB);
  const now = new Date();
  const lines = ["Name,Email,Position,Team,Manager,Start date,Last working day,Tenure,Status"];
  for (const e of employees) {
    lines.push(
      [
        csv(e.name), csv(e.email ?? ""), csv(e.position ?? ""), csv(e.team ?? ""), csv(e.manager ?? ""),
        e.start_date ? formatDMY(e.start_date) : "", e.end_date ? formatDMY(e.end_date) : "", tenure(e, now).label, e.end_date ? "left" : "active",
      ].join(","),
    );
  }
  return csvResponse(c, "headcount.csv", lines.join("\n"));
});

// Serve an HR attachment from R2 (session-protected like everything under /app).
app.get("/app/hr/file/:docId", async (c) => {
  const doc = await getDocument(c.env.DB, c.req.param("docId"));
  if (!doc) return c.notFound();
  const obj = await c.env.UPLOADS.get(doc.r2_key);
  if (!obj) return c.notFound();
  const isImage = doc.content_type?.startsWith("image/") ?? false;
  const isPdf = doc.content_type === "application/pdf";
  return new Response(obj.body, {
    headers: {
      "content-type": doc.content_type ?? "application/octet-stream",
      "content-disposition": `${isImage || isPdf ? "inline" : "attachment"}; filename="${doc.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=3600",
    },
  });
});

app.get("/app/hr/:id", async (c) => {
  const emp = await getHrEmployee(c.env.DB, c.req.param("id"));
  if (!emp) return c.redirect("/app/hr");
  const notes = await listNotes(c.env.DB, emp.id);
  const docs = await documentsForNotes(c.env.DB, notes.map((n) => n.id));
  // Payroll link: payroll uses first names, HR full names — match on the
  // first name and skip when it's ambiguous.
  const payrollEmps = await listEmployees(c.env.DB);
  const first = emp.name.trim().split(/\s+/)[0].toLowerCase();
  const matches = payrollEmps.filter((pe) => pe.name.trim().toLowerCase() === first);
  const pay = matches.length === 1 ? matches[0] : null;
  const payroll = pay
    ? { status: pay.status, paidThrough: pay.status === "inactive" && pay.inactive_date ? label(pay.inactive_date.slice(0, 7)) : null }
    : null;
  return c.html(<HrEmployeePage emp={emp} notes={notes} docs={docs} payroll={payroll} now={new Date()} saved={c.req.query("saved") === "1"} />);
});

app.post("/app/hr/:id/update", async (c) => {
  const id = c.req.param("id");
  const emp = await getHrEmployee(c.env.DB, id);
  if (!emp) return c.redirect("/app/hr");
  const b = await c.req.parseBody();
  const name = String(b.name ?? "").trim() || emp.name;
  await updateHrEmployee(c.env.DB, id, {
    name,
    email: String(b.email ?? "").trim() || null,
    position: String(b.position ?? "").trim() || null,
    team: String(b.team ?? "").trim() || null,
    manager: String(b.manager ?? "").trim() || null,
    employee_no: emp.employee_no,
    start_date: parseDateInput(String(b.start_date)),
    end_date: parseDateInput(String(b.end_date)),
  });
  return c.redirect(`/app/hr/${id}?saved=1`);
});

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file

/** Store uploaded/pasted attachments (the `files` field) against a note. */
async function saveNoteAttachments(c: any, empId: string, noteId: string, raw: unknown): Promise<void> {
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) continue;
    const safe = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const key = `hr/${empId}/${noteId}/${crypto.randomUUID()}-${safe}`;
    await c.env.UPLOADS.put(key, f.stream(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    await registerDocument(c.env.DB, {
      r2_key: key,
      filename: f.name,
      content_type: f.type || null,
      size_bytes: f.size,
      ref_id: noteId,
    });
  }
}

app.post("/app/hr/:id/note", async (c) => {
  const id = c.req.param("id");
  const emp = await getHrEmployee(c.env.DB, id);
  if (!emp) return c.redirect("/app/hr");
  const body = await c.req.parseBody({ all: true });
  const title = String(body.title ?? "").trim();
  if (!title) return c.redirect(`/app/hr/${id}`);
  const kind = NOTE_KINDS.includes(String(body.kind) as any) ? String(body.kind) : "note";
  const noteId = await createNote(c.env.DB, {
    employee_id: id,
    kind,
    title,
    body: String(body.body ?? "").trim() || null,
    note_date: parseDateInput(String(body.note_date)),
  });
  await saveNoteAttachments(c, id, noteId, body.files);
  return c.redirect(`/app/hr/${id}?saved=1`);
});

app.post("/app/hr/:id/note/:noteId", async (c) => {
  const id = c.req.param("id");
  const noteId = c.req.param("noteId");
  const emp = await getHrEmployee(c.env.DB, id);
  if (!emp) return c.redirect("/app/hr");
  const existing = await getNote(c.env.DB, noteId);
  if (!existing || existing.employee_id !== id) return c.redirect(`/app/hr/${id}`);
  const body = await c.req.parseBody({ all: true });
  const title = String(body.title ?? "").trim();
  if (!title) return c.redirect(`/app/hr/${id}`);
  const kind = NOTE_KINDS.includes(String(body.kind) as any) ? String(body.kind) : existing.kind;
  await updateNote(c.env.DB, noteId, {
    kind,
    title,
    body: String(body.body ?? "").trim() || null,
    note_date: parseDateInput(String(body.note_date)),
  });
  await saveNoteAttachments(c, id, noteId, body.files);
  return c.redirect(`/app/hr/${id}?saved=1`);
});

app.post("/app/hr/note/delete", async (c) => {
  const b = await c.req.parseBody();
  const noteId = String(b.id ?? "");
  const empId = String(b.emp ?? "");
  if (noteId) {
    await deleteDocumentsForNote(c.env.DB, c.env.UPLOADS, noteId);
    await deleteNote(c.env.DB, noteId);
  }
  return c.redirect(empId ? `/app/hr/${empId}` : "/app/hr");
});

// ---------- Recurring expenses + Xero ----------

async function xeroState(c: any): Promise<import("./lib/xero").XeroState> {
  const configured = Boolean(c.env.XERO_CLIENT_ID && c.env.XERO_CLIENT_SECRET);
  const m = await getAllMeta(c.env.DB);
  return {
    configured,
    connected: configured && Boolean(m.xero_refresh_token),
    orgName: m.xero_org_name ?? null,
    lastSync: m.xero_last_sync ?? null,
    callbackUrl: redirectUri(c),
  };
}

const COST_PERIODS = ["all", "month", "lastmonth", "quarter", "fy"] as const;
type CostPeriod = (typeof COST_PERIODS)[number];

app.get("/app/finance/costs", async (c) => {
  const [expenses, xero] = await Promise.all([listExpenses(c.env.DB), xeroState(c)]);
  const msg = c.req.query("msg") ? decodeURIComponent(String(c.req.query("msg"))) : undefined;
  // Period window for billed/VAT figures (from synced Xero documents).
  const pRaw = String(c.req.query("p") ?? "all");
  const costPeriod: CostPeriod = (COST_PERIODS as readonly string[]).includes(pRaw) ? (pRaw as CostPeriod) : "all";
  const nowMonth = new Date().toISOString().slice(0, 7);
  const fyStart = `${fiscalYearOf(nowMonth) - 1}-03`;
  const qOff = (Number(nowMonth.slice(0, 4)) - Number(fyStart.slice(0, 4))) * 12 + Number(nowMonth.slice(5, 7)) - Number(fyStart.slice(5, 7));
  const qStart = addMonths(fyStart, Math.floor(qOff / 3) * 3);
  const win: Record<CostPeriod, { start: string | null; end: string | null; label: string }> = {
    all: { start: null, end: null, label: "synced window (18 mo)" },
    month: { start: `${nowMonth}-01`, end: null, label: label(nowMonth) },
    lastmonth: { start: `${addMonths(nowMonth, -1)}-01`, end: `${nowMonth}-01`, label: label(addMonths(nowMonth, -1)) },
    quarter: { start: `${qStart}-01`, end: null, label: `${label(qStart)} – ${label(nowMonth)}` },
    fy: { start: `${fyStart}-01`, end: null, label: `${fyLabel(fiscalYearOf(nowMonth))} to date` },
  };
  const w = win[costPeriod];
  // end is exclusive for lastmonth (first day of this month); SQL uses <=, so step back a day.
  const endIso = w.end ? new Date(Date.parse(w.end) - 86400_000).toISOString().slice(0, 10) : null;
  const spendTotals = await vendorSpendTotals(c.env.DB, w.start, endIso);
  // All-time totals give each vendor's effective VAT rate for the monthly figure.
  const spendAllTime = costPeriod === "all" ? spendTotals : await vendorSpendTotals(c.env.DB, null, null);
  const pageN = Number(c.req.query("page"));
  const page = Number.isFinite(pageN) && pageN >= 1 ? Math.trunc(pageN) : 1;
  const sortRaw = c.req.query("sort");
  const sort = sortRaw === "amount" || sortRaw === "monthly" ? sortRaw : "name";
  const dirRaw = c.req.query("dir");
  const dir: "asc" | "desc" = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === "name" ? "asc" : "desc";
  const cmp = (a: (typeof expenses)[number], b: (typeof expenses)[number]) =>
    sort === "name" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    : sort === "amount" ? a.amount - b.amount
    : monthlyEquivalent(a) - monthlyEquivalent(b);
  expenses.sort((a, b) => b.active - a.active || (dir === "asc" ? cmp(a, b) : cmp(b, a)));
  const patterns = await billingPatterns(c.env.DB);
  const openId = c.req.query("open") ?? null;
  let openBills: import("./data/expenses").VendorBill[] = [];
  if (openId) {
    const row = expenses.find((e) => e.id === openId);
    const key = row?.xero_id?.startsWith("vendor:") ? row.xero_id.slice(7) : null;
    if (key) openBills = await listVendorBills(c.env.DB, key);
  }
  return c.html(
    <ExpensesPage expenses={expenses} xero={xero} page={page} sort={sort} dir={dir} openId={openId} openBills={openBills}
      patterns={patterns} costPeriod={costPeriod} periodLabel={w.label} spendTotals={spendTotals} spendAllTime={spendAllTime} msg={msg} />,
  );
});

app.post("/app/expenses/add", async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? "").trim();
  const freq = FREQUENCIES.find((f) => f.key === String(b.frequency)) ?? FREQUENCIES[1];
  if (name) {
    await createExpense(c.env.DB, {
      name,
      vendor: String(b.vendor ?? "").trim() || null,
      category: String(b.category ?? "").trim() || null,
      amount: parseMoney(String(b.amount ?? "0")),
      frequency: freq.key,
      interval_months: freq.months,
      next_date: parseDateInput(String(b.next_date)),
      notes: String(b.notes ?? "").trim() || null,
    });
  }
  return c.redirect("/app/finance/costs");
});

function expenseListQs(b: Record<string, unknown>): string {
  const q = new URLSearchParams();
  if (/^\d+$/.test(String(b.page))) q.set("page", String(b.page));
  if (["name", "amount", "monthly"].includes(String(b.sort))) q.set("sort", String(b.sort));
  if (["asc", "desc"].includes(String(b.dir))) q.set("dir", String(b.dir));
  if (["all", "month", "lastmonth", "quarter", "fy"].includes(String(b.p))) q.set("p", String(b.p));
  return q.toString();
}

app.post("/app/expenses/frequency", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  const freq = FREQUENCIES.find((f) => f.key === String(b.frequency));
  if (id && freq) await setExpenseFrequency(c.env.DB, id, freq.key, freq.months);
  return c.redirect(`/app/finance/costs?${expenseListQs(b)}`);
});

app.post("/app/expenses/toggle", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await toggleExpense(c.env.DB, String(b.id));
  return c.redirect(`/app/finance/costs?${expenseListQs(b)}`);
});

app.post("/app/expenses/delete", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await deleteExpense(c.env.DB, String(b.id));
  return c.redirect(`/app/finance/costs?${expenseListQs(b)}`);
});

app.get("/app/expenses/export.csv", async (c) => {
  const expenses = await listExpenses(c.env.DB);
  const lines = ["Name,Vendor,Category,Amount,Currency,Frequency,Monthly equivalent,Next date,Active,Source"];
  for (const e of expenses) {
    lines.push(
      [
        csv(e.name), csv(e.vendor ?? ""), csv(e.category ?? ""), e.amount.toFixed(2), e.currency, e.frequency,
        monthlyEquivalent(e).toFixed(2), e.next_date ? formatDMY(e.next_date) : "", e.active ? "yes" : "no", e.source,
      ].join(","),
    );
  }
  return csvResponse(c, "recurring-expenses.csv", lines.join("\n"));
});

// ----- Xero OAuth flow -----

function redirectUri(c: any): string {
  // Workers can report the scheme as http even for HTTPS requests — and Xero
  // only accepts https redirect URIs (http is allowed for localhost only).
  const u = new URL(c.req.url);
  const proto = u.hostname === "localhost" || u.hostname === "127.0.0.1" ? "http" : "https";
  return `${proto}://${u.host}/app/xero/callback`;
}

app.get("/app/xero/connect", async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET) return c.redirect("/app/admin");
  const state = crypto.randomUUID();
  await setSignedCookie(c, "xero_state", state, c.env.SESSION_SECRET, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 600,
  });
  return c.redirect(authUrl(c.env.XERO_CLIENT_ID.trim(), redirectUri(c), state));
});

app.get("/app/xero/callback", async (c) => {
  const err = c.req.query("error");
  if (err) return c.redirect(`/app/admin?msg=${encodeURIComponent(`Xero: ${err}`)}`);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const expected = await getSignedCookie(c, c.env.SESSION_SECRET, "xero_state");
  if (!code || !state || !expected || state !== expected) {
    return c.redirect(`/app/admin?msg=${encodeURIComponent("Xero connection failed (state mismatch) — try again.")}`);
  }
  try {
    const tokens = await exchangeCode(c.env.XERO_CLIENT_ID!.trim(), c.env.XERO_CLIENT_SECRET!.trim(), code, redirectUri(c));
    await persistTokens(c.env.DB, tokens);
    const conns = await fetchConnections(tokens.access_token);
    if (conns.length === 0) throw new Error("no organisations authorised");
    await setMeta(c.env.DB, "xero_tenant_id", conns[0].tenantId);
    await setMeta(c.env.DB, "xero_org_name", conns[0].tenantName);
    return c.redirect(`/app/admin?msg=${encodeURIComponent(`Connected to ${conns[0].tenantName}. Run a sync to pull the books.`)}`);
  } catch (e) {
    return c.redirect(`/app/admin?msg=${encodeURIComponent(`Xero connection failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
});

app.post("/app/xero/disconnect", async (c) => {
  for (const k of ["xero_refresh_token", "xero_access_token", "xero_access_expires", "xero_tenant_id", "xero_org_name"]) {
    await c.env.DB.prepare("DELETE FROM app_meta WHERE key = ?").bind(k).run();
  }
  return c.redirect(`/app/admin?msg=${encodeURIComponent("Xero disconnected.")}`);
});

const SYNC_MONTHS_BACK = 6;
const SYNC_MIN_MONTHS = 3;
const CONTRACTOR_PREFIX = /^(developer|devloper|freelancer|contractor|salary|wages)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** First names (≥4 chars) from payroll + HR — vendors matching these are payroll, not suppliers. */
async function staffFirstNames(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT name FROM employees UNION SELECT name FROM hr_employees").all<{ name: string }>();
  const out = new Set<string>();
  for (const r of results ?? []) {
    const first = r.name.trim().split(/\s+/)[0];
    if (first.length >= 4) out.add(first.toLowerCase());
  }
  return [...out];
}

function autoExcludeReason(vendorName: string, staffNames: string[]): string | null {
  for (const n of staffNames) {
    if (new RegExp(`\\b${escapeRe(n)}\\b`, "i").test(vendorName)) return "payroll match";
  }
  if (CONTRACTOR_PREFIX.test(vendorName)) return "contractor prefix";
  return null;
}

async function xeroAuth(env: Bindings): Promise<{ token: string; tenantId: string }> {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) throw new Error("Xero credentials not set");
  const token = await ensureAccessToken(env.DB, env.XERO_CLIENT_ID.trim(), env.XERO_CLIENT_SECRET.trim());
  if (!token) throw new Error("Not connected to Xero yet");
  const tenantId = await getMeta(env.DB, "xero_tenant_id");
  if (!tenantId) throw new Error("No Xero organisation selected — reconnect");
  return { token, tenantId };
}

/** Store repeating schedules (sales + bills). Read-only against Xero. */
async function storeRepeatingSchedules(env: Bindings, raw: any[]): Promise<number> {
  const schedules = toSchedules(raw);
  await replaceRepeatingSchedules(env.DB, schedules);
  await setMeta(env.DB, "xero_repeating_synced", new Date().toISOString());
  await setMeta(env.DB, "xero_repeating_error", "");
  return schedules.length;
}

/** Daily refresh: just the repeating schedules — one light Xero call. */
async function runRepeatingSync(env: Bindings): Promise<string> {
  const { token, tenantId } = await xeroAuth(env);
  const n = await storeRepeatingSchedules(env, await fetchRepeatingRaw(token, tenantId));
  // Same run: the sales invoices those templates create, and their payments.
  // Without this, an invoice leaves the Recurring line as soon as it is raised
  // but only reaches Open invoices at the next full (monthly) sync.
  try {
    const { since, txns } = await fetchActualTxns(token, tenantId, 18, { salesOnly: true });
    await replaceSalesTxns(env.DB, since, txns);
    await setMeta(env.DB, "xero_sales_refreshed", new Date().toISOString());
    await setMeta(env.DB, "xero_actuals_error", "");
    return `Repeating schedules refreshed: ${n} template(s); ${txns.length} sales invoice(s).`;
  } catch (e) {
    await setMeta(env.DB, "xero_actuals_error", `Daily sales refresh failed: ${e instanceof Error ? e.message : "unknown"}`);
    return `Repeating schedules refreshed: ${n} template(s); sales invoices not refreshed.`;
  }
}

/** Full Xero sync: repeating bills + rule-driven vendor detection. Used by the button and the monthly cron. */
async function runXeroSync(env: Bindings): Promise<string> {
  const { token, tenantId } = await xeroAuth(env);

  const repeatingRaw = await fetchRepeatingRaw(token, tenantId);
  const scheduleCount = await storeRepeatingSchedules(env, repeatingRaw);
  const [repeating, summary, rules, names] = await Promise.all([
    fetchRepeatingBills(token, tenantId, repeatingRaw),
    fetchVendorBillSummary(token, tenantId, SYNC_MONTHS_BACK),
    listVendorRules(env.DB),
    staffFirstNames(env.DB),
  ]);

  const bills = [...repeating];
  let excluded = 0;
  for (const v of summary) {
    let rule = rules.get(v.key);
    // Persist automatic exclusions so they're visible and overridable on the review page.
    if (!rule) {
      // Tax is never an operating cost: SARS has its own line in the forecast.
      const reason = v.key === "sars" || /^SARS\b/i.test(v.name)
        ? "tax — tracked on the forecast's SARS line, not as a recurring cost"
        : autoExcludeReason(v.name, names);
      if (reason) {
        await setVendorRule(env.DB, v.key, v.name, "exclude", reason);
        rule = { vendor_key: v.key, name: v.name, rule: "exclude", reason };
      }
    }
    if (rule?.rule === "exclude" || v.key === "sars") {
      // SARS is enforced out of operating costs even if a stale rule says track.
      await deleteExpenseByXeroId(env.DB, `vendor:${v.key}`);
      excluded++;
      continue;
    }
    const track = rule?.rule === "track" || v.monthCount >= SYNC_MIN_MONTHS;
    if (track) bills.push(vendorToBill(v, SYNC_MONTHS_BACK));
  }
  // Refresh P&L-derived monthly actuals (drives the cashflow model).
  try {
    const nowMonth = new Date().toISOString().slice(0, 7);
    const fy = fiscalYearOf(nowMonth);
    const curStart = `${fy - 1}-03`;
    const curCount = monthsBetweenIncl(curStart, nowMonth);
    // Sequential: Xero rejects bursts of concurrent report calls.
    const priorEnd = lastDayISO(`${fy - 1}-02`);
    const cashCur = await fetchProfitAndLoss(token, tenantId, lastDayISO(nowMonth), curCount, true);
    const accrCur = await fetchProfitAndLoss(token, tenantId, lastDayISO(nowMonth), curCount, false);
    let cashPrior: PnL | null = null;
    let accrPrior: PnL | null = null;
    let priorErr = "";
    try {
      cashPrior = await fetchProfitAndLoss(token, tenantId, priorEnd, 12, true);
      accrPrior = await fetchProfitAndLoss(token, tenantId, priorEnd, 12, false);
    } catch (e) {
      priorErr = e instanceof Error ? e.message : "unknown";
    }
    if (priorErr) await setMeta(env.DB, "cf_prior_fy_error", priorErr);
    else await setMeta(env.DB, "cf_prior_fy_error", "");
    const bucketed = (pnl: PnL | null): Map<string, { income: number; staff: number; dev: number; other: number }> => {
      const out = new Map<string, { income: number; staff: number; dev: number; other: number }>();
      if (!pnl) return out;
      pnl.months.forEach((month, i) => {
        let staff = 0, dev = 0, other = 0;
        for (const r of [...pnl.cosRows, ...pnl.opexRows]) {
          const v = r.values[i] ?? 0;
          if (STAFF_RE.test(r.name)) staff += v;
          else if (DEV_RE.test(r.name)) dev += v;
          else other += v;
        }
        out.set(month, { income: pnl.incomeTotal[i] ?? 0, staff, dev, other });
      });
      return out;
    };
    const cash = new Map([...bucketed(cashPrior), ...bucketed(cashCur)]);
    const accr = new Map([...bucketed(accrPrior), ...bucketed(accrCur)]);
    const rows: CfActual[] = [...new Set([...cash.keys(), ...accr.keys()])].map((month) => {
      const c = cash.get(month) ?? { income: 0, staff: 0, dev: 0, other: 0 };
      const a = accr.get(month) ?? { income: 0, staff: 0, dev: 0, other: 0 };
      return { month, income: c.income, staff: c.staff, dev: c.dev, other: c.other, income_accr: a.income, staff_accr: a.staff, dev_accr: a.dev, other_accr: a.other };
    });
    await upsertCfActuals(env.DB, rows);
    const cohorts = await fetchDebtorCohorts(token, tenantId, `${fy - 2}-03`);
    await replaceCfDebtors(env.DB, cohorts);
    await setMeta(env.DB, "cf_actuals_synced", new Date().toISOString());
  } catch {
    // P&L scope not consented yet — cashflow keeps its last actuals
  }

  const [ins, upd] = await upsertXeroExpenses(env.DB, bills);
  // Prune stale xero rows: vendors that no longer appear in the sync output
  // (vanished from the window, lapsed below threshold, or filtered as
  // transfers/etc). Without this, one bad import lingers forever.
  const validIds = new Set(bills.map((b) => b.xero_id));
  const { results: existingRows } = await env.DB
    .prepare("SELECT id, xero_id FROM recurring_expenses WHERE source = 'xero'")
    .all<{ id: string; xero_id: string | null }>();
  let pruned = 0;
  for (const r of existingRows ?? []) {
    if (r.xero_id && !validIds.has(r.xero_id)) {
      await env.DB.prepare("DELETE FROM recurring_expenses WHERE id = ?").bind(r.id).run();
      pruned++;
    }
  }
  // Refresh the per-vendor bill history that powers the expense drawers.
  await replaceVendorBills(
    env.DB,
    summary.flatMap((v) => v.bills.map((b) => ({ vendor_key: v.key, vendor_name: v.name, bill_date: b.date, amount: b.amount, reference: b.reference }))),
  );
  // Raw actuals for the Actuals tab — every sale, bill and spend txn.
  try {
    const { since, txns } = await fetchActualTxns(token, tenantId);
    await replaceXeroTxns(env.DB, since, txns);
    await setMeta(env.DB, "xero_actuals_error", "");
  } catch (e) {
    await setMeta(env.DB, "xero_actuals_error", e instanceof Error ? e.message : "unknown");
  }
  // Client billing ledgers — line-level invoices, bills, spend (Clients tab).
  let billingMsg = "";
  try {
    billingMsg = await syncBillingLedgers({ DB: env.DB }, token, tenantId);
    await setMeta(env.DB, "billing_sync_error", "");
  } catch (e) {
    await setMeta(env.DB, "billing_sync_error", e instanceof Error ? e.message : "unknown");
  }
  // VAT owed to SARS — the VAT control balance from the Balance Sheet.
  try {
    const vat = await fetchVatOwing(token, tenantId);
    await setMeta(env.DB, "vat_owing", String(vat.amount));
    await setMeta(env.DB, "vat_owing_asat", new Date().toISOString());
    await setMeta(env.DB, "vat_owing_accounts", vat.accounts.join(" + "));
    await setMeta(env.DB, "vat_error", "");
  } catch (e) {
    await setMeta(env.DB, "vat_error", e instanceof Error ? e.message : "unknown");
  }
  await setMeta(env.DB, "xero_last_sync", new Date().toISOString());
  const msg = `Xero sync done: ${scheduleCount} repeating schedule(s), ${repeating.length} repeating bill(s), ${bills.length - repeating.length} recurring vendor(s) tracked, ${excluded} excluded — ${ins} new, ${upd} updated, ${pruned} stale removed.${billingMsg ? ` ${billingMsg}.` : ""}`;
  await setMeta(env.DB, "xero_last_sync_result", msg);
  return msg;
}

app.post("/app/expenses/sync", async (c) => {
  // Optional "back" field returns the user to the page they synced from.
  const backKey = String((await c.req.parseBody()).back ?? "");
  const back =
    backKey === "overview" ? "/app"
    : backKey === "cash" || backKey === "accounts" ? "/app/finance/cash"
    : backKey === "costs" ? "/app/finance/costs"
    : "/app/admin";
  try {
    const msg = await runXeroSync(c.env);
    return c.redirect(`${back}?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    return c.redirect(`${back}?msg=${encodeURIComponent(`Xero sync failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
});

app.get("/app/finance/transactions", async (c) => {
  const txns = await listXeroTxns(c.env.DB);
  const monthsPresent = [...new Set(txns.map((t) => t.txn_date.slice(0, 7)))];
  const fys = [...new Set(monthsPresent.map(fiscalYearOf))].sort((a, b) => a - b);
  const fyRaw = c.req.query("fy");
  let fy = fyRaw && fyRaw !== "all" && /^\d{4}$/.test(fyRaw) ? Number(fyRaw) : null;
  if (fy == null && fyRaw !== "all") {
    const curFy = fiscalYearOf(new Date().toISOString().slice(0, 7));
    if (fys.includes(curFy)) fy = curFy;
  }
  const open = /^\d{4}-\d{2}$/.test(String(c.req.query("m"))) ? String(c.req.query("m")) : null;
  const lastSyncIso = await getMeta(c.env.DB, "xero_last_sync");
  const syncError = (await getMeta(c.env.DB, "xero_actuals_error")) || null;
  // Accrual P&L net per month, for the tie-out column.
  const cfActuals = await listCfActuals(c.env.DB);
  const pnlNet = new Map<string, number>();
  for (const [m2, a] of cfActuals) pnlNet.set(m2, a.income_accr - a.staff_accr - a.dev_accr - a.other_accr);
  return c.html(<ActualsPage txns={txns} fy={fy} fys={fys} open={open} pnlNet={pnlNet} lastSync={lastSyncIso ? formatDMYTime(lastSyncIso) : null} syncError={syncError} />);
});

// ----- Income dashboard (Xero P&L) -----

const STAFF_RE = /salar|wage|payroll|staff|bonus|\buif\b|\bpaye\b|\bsdl\b|medical aid|pension|leave pay/i;
const DEV_RE = /developer|contractor|freelanc|consult/i;

// P&L cost categories — plain-language buckets for "where does the money go".
const COST_CATEGORIES: { key: string; title: string; re: RegExp }[] = [
  { key: "employees", title: "Employees", re: STAFF_RE },
  { key: "contractors", title: "Contractors / development", re: DEV_RE },
  { key: "infra", title: "Infrastructure & hosting", re: /hosting|server|domain|cloud|vps|backup|data ?cent/i },
  { key: "software", title: "Software & subscriptions", re: /software|subscript|licen|saas/i },
  { key: "marketing", title: "Sales & marketing", re: /marketing|advertis|promo|entertain/i },
  { key: "admin", title: "General & admin", re: /rent|electric|water|insurance|bank charge|accounting|legal|security|telephone|internet|travel|vehicle|motor|repairs|office|uniform|welfare|training|interest|computer/i },
];

function monthsBetweenIncl(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
}

function lastDayISO(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

app.get("/app/finance/pnl", async (c) => {
  const nowMonth = new Date().toISOString().slice(0, 7);
  const curFy = fiscalYearOf(nowMonth);
  const fys = [curFy - 1, curFy];
  const fyRaw = Number(c.req.query("fy"));
  const fy = fys.includes(fyRaw) ? fyRaw : curFy;
  // FY-to-date window: Mar of (fy-1) → current month, capped at Feb of fy.
  const startMonth = `${fy - 1}-03`;
  const capMonth = `${fy}-02`;
  const endMonth = nowMonth < startMonth ? startMonth : nowMonth > capMonth ? capMonth : nowMonth;
  const monthsCount = (Number(endMonth.slice(0, 4)) - Number(startMonth.slice(0, 4))) * 12 + (Number(endMonth.slice(5, 7)) - Number(startMonth.slice(5, 7))) + 1;

  const empty: PnL = { months: [], incomeRows: [], cosRows: [], opexRows: [], incomeTotal: [], cosTotal: [], opexTotal: [] };
  let pnl: PnL = empty;
  let prior: PnL | null = null;
  let error: string | undefined;
  try {
    if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET) throw new Error("Xero credentials not set");
    const token = await ensureAccessToken(c.env.DB, c.env.XERO_CLIENT_ID.trim(), c.env.XERO_CLIENT_SECRET.trim());
    if (!token) throw new Error("Connect Xero on the Expenses tab first");
    const tenantId = await getMeta(c.env.DB, "xero_tenant_id");
    if (!tenantId) throw new Error("No Xero organisation — reconnect");
    const priorEnd = `${Number(endMonth.slice(0, 4)) - 1}${endMonth.slice(4)}`;
    [pnl, prior] = await Promise.all([
      fetchProfitAndLoss(token, tenantId, lastDayISO(endMonth), monthsCount),
      fetchProfitAndLoss(token, tenantId, lastDayISO(priorEnd), monthsCount).catch(() => null),
    ]);
    // Keep only months inside the FY window (defensive against extra columns).
    const keep = pnl.months.map((m) => m >= startMonth && m <= endMonth);
    const filt = (vals: number[]) => vals.filter((_, i) => keep[i]);
    pnl = {
      months: pnl.months.filter((_, i) => keep[i]),
      incomeRows: pnl.incomeRows.map((r) => ({ name: r.name, values: filt(r.values) })),
      cosRows: pnl.cosRows.map((r) => ({ name: r.name, values: filt(r.values) })),
      opexRows: pnl.opexRows.map((r) => ({ name: r.name, values: filt(r.values) })),
      incomeTotal: filt(pnl.incomeTotal),
      cosTotal: filt(pnl.cosTotal),
      opexTotal: filt(pnl.opexTotal),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    error = /403/.test(msg)
      ? "Xero P&L access not granted yet — Disconnect and reconnect Xero on the Expenses tab to approve the report scope, then reload."
      : `Couldn't load the P&L from Xero: ${msg}`;
  }

  // Bucket expense accounts into plain-language cost categories.
  const zeros = pnl.months.map(() => 0);
  const buckets: ExpenseBucket[] = [
    ...COST_CATEGORIES.map((cc) => ({ key: cc.key, title: cc.title, rows: [] as PnLRow[], total: [...zeros] })),
    { key: "other", title: "Other", rows: [], total: [...zeros] },
  ];
  const allExpenseRows: PnLRow[] = [...pnl.cosRows, ...pnl.opexRows];
  for (const r of allExpenseRows) {
    const cc = COST_CATEGORIES.find((x) => x.re.test(r.name));
    const b = cc ? buckets.find((x) => x.key === cc.key)! : buckets[buckets.length - 1];
    b.rows.push(r);
    r.values.forEach((v, i) => (b.total[i] += v));
  }

  // Canonical-store reconciliation: a successful live fetch refreshes the
  // synced accrual figures, so the Overview and this page can never drift.
  if (!error && pnl.months.length) {
    const accr = pnl.months.map((m, i) => {
      let staff = 0;
      let dev = 0;
      let other = 0;
      for (const r of allExpenseRows) {
        const v = r.values[i] ?? 0;
        if (STAFF_RE.test(r.name)) staff += v;
        else if (DEV_RE.test(r.name)) dev += v;
        else other += v;
      }
      return { month: m, income_accr: pnl.incomeTotal[i], staff_accr: staff, dev_accr: dev, other_accr: other };
    });
    c.executionCtx.waitUntil(updateCfAccruals(c.env.DB, accr).catch(() => {}));
  }

  const lastSync = await getMeta(c.env.DB, "xero_last_sync");
  return c.html(<IncomePage fy={fy} fys={fys} pnl={pnl} prior={prior} buckets={buckets} lastSync={lastSync ? formatDMYTime(lastSync) : null} error={error} />);
});

// ----- Deals (né Commissions) -----

app.get("/app/accounts/commissions", (c) => c.redirect("/app/pipeline"));
app.get("/app/accounts/deals", (c) => c.redirect("/app/pipeline"));

/**
 * Self-migration fallback: Cloudflare's D1 HTTP API (used by wrangler
 * migrations) can be unavailable while the Worker's binding still works.
 * Ensure the 0015 columns exist via the data plane, and record the
 * migration so wrangler doesn't re-apply it later.
 */
async function ensureCommissionRefColumns(db: D1Database): Promise<void> {
  try {
    await db.prepare("SELECT quote_no, invoice_nett FROM commissions LIMIT 1").first();
  } catch {
    for (const col of ["quote_no TEXT", "invoice_no TEXT", "deal_date TEXT", "invoice_nett REAL", "comm_amount REAL"]) {
      await db.prepare(`ALTER TABLE commissions ADD COLUMN ${col}`).run().catch(() => {});
    }
    await db.prepare("UPDATE app_meta SET value='16' WHERE key='schema_version'").run().catch(() => {});
    for (const m of ["0015_commission_refs.sql", "0016_commission_amounts.sql"]) {
      await db
        .prepare("INSERT INTO d1_migrations (name, applied_at) SELECT ?, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = ?)")
        .bind(m, m)
        .run()
        .catch(() => {});
    }
  }
}

app.get("/app/pipeline", async (c) => {
  await ensureCommissionRefColumns(c.env.DB);
  const [deals, lines, employees] = await Promise.all([
    listCommissions(c.env.DB),
    listAllLines(c.env.DB),
    listEmployees(c.env.DB),
  ]);
  const linesByDeal = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!linesByDeal.has(l.commission_id)) linesByDeal.set(l.commission_id, []);
    linesByDeal.get(l.commission_id)!.push(l);
  }
  const openId = c.req.query("open") ?? null;
  const clientFilter = c.req.query("client")?.trim() || null;
  return c.html(
    <CommissionsPage deals={deals} linesByDeal={linesByDeal} staffNames={employees.map((e) => e.name)} openId={openId} clientFilter={clientFilter} saved={c.req.query("saved") === "1"} />,
  );
});

app.post("/app/accounts/deals/add", async (c) => {
  const b = await c.req.parseBody();
  const staff = String(b.staff ?? "").trim();
  const allocation = String(b.allocation ?? "").trim();
  if (staff && allocation) {
    const pctRaw = String(b.comm_pct ?? "").trim();
    const id = await createCommission(c.env.DB, {
      staff,
      allocation,
      client: String(b.client ?? "").trim() || null,
      po_number: String(b.po_number ?? "").trim() || null,
      comm_pct: pctRaw === "" ? null : parseMoney(pctRaw),
      stage: COMM_STAGES.includes(String(b.stage) as any) ? (String(b.stage) as any) : "quote",
      quote_no: String(b.quote_no ?? "").trim() || null,
      invoice_no: String(b.invoice_no ?? "").trim() || null,
      deal_date: parseDateInput(String(b.deal_date)),
      expected_payment: parseDateInput(String(b.expected_payment)),
      invoice_nett: String(b.invoice_nett ?? "").trim() ? parseMoney(String(b.invoice_nett)) : null,
      comm_amount: String(b.comm_amount ?? "").trim() ? parseMoney(String(b.comm_amount)) : null,
    });
    return c.redirect(`/app/pipeline?open=${id}&saved=1`);
  }
  return c.redirect("/app/pipeline");
});

app.post("/app/accounts/deals/amounts", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) {
    const num = (v: unknown) => (String(v ?? "").trim() === "" ? null : parseMoney(String(v)));
    await setCommissionAmounts(c.env.DB, String(b.id), num(b.invoice_nett), num(b.comm_amount), num(b.comm_pct));
  }
  return c.redirect("/app/pipeline");
});

app.post("/app/accounts/deals/update", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  const staff = String(b.staff ?? "").trim();
  const allocation = String(b.allocation ?? "").trim();
  if (id && staff && allocation) {
    await updateCommissionDetails(c.env.DB, id, {
      staff,
      allocation,
      client: String(b.client ?? "").trim() || null,
      po_number: String(b.po_number ?? "").trim() || null,
      quote_no: String(b.quote_no ?? "").trim() || null,
      invoice_no: String(b.invoice_no ?? "").trim() || null,
      deal_date: parseDateInput(String(b.deal_date)),
      expected_payment: parseDateInput(String(b.expected_payment)),
    });
  }
  return c.redirect(`/app/pipeline?open=${id}&saved=1`);
});

app.post("/app/accounts/deals/expected", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  if (id) {
    await c.env.DB.prepare("UPDATE commissions SET expected_payment=?, updated_at=datetime('now') WHERE id=?")
      .bind(parseDateInput(String(b.expected_payment)), id)
      .run();
  }
  return c.redirect(`/app/pipeline?open=${id}&saved=1`);
});

app.post("/app/accounts/deals/forecast-flag", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await setIncludeForecast(c.env.DB, String(b.id), String(b.include) === "1");
  return c.redirect("/app/pipeline");
});

app.post("/app/accounts/deals/stage", async (c) => {
  const b = await c.req.parseBody();
  if (b.id && COMM_STAGES.includes(String(b.stage) as any)) {
    await setCommissionStage(c.env.DB, String(b.id), String(b.stage));
  }
  return c.redirect("/app/pipeline");
});

app.post("/app/accounts/deals/delete", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await deleteCommission(c.env.DB, String(b.id));
  return c.redirect("/app/pipeline");
});

app.post("/app/accounts/deals/line/add", async (c) => {
  const b = await c.req.parseBody();
  const dealId = String(b.deal ?? "");
  if (dealId) {
    await addLine(c.env.DB, {
      commission_id: dealId,
      tx_date: parseDateInput(String(b.tx_date)),
      reference: String(b.reference ?? "").trim() || null,
      tx_type: String(b.tx_type ?? "").trim() || null,
      allocation: String(b.allocation ?? "").trim() || null,
      po_number: String(b.po_number ?? "").trim() || null,
      description: String(b.description ?? "").trim() || null,
      payment: b.payment ? parseMoney(String(b.payment)) : 0,
      invoice: b.invoice ? parseMoney(String(b.invoice)) : 0,
    });
  }
  return c.redirect(`/app/accounts/deals?open=${dealId}&saved=1`);
});

app.post("/app/accounts/deals/line/delete", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await deleteLine(c.env.DB, String(b.id));
  return c.redirect(`/app/accounts/deals${b.deal ? `?open=${b.deal}` : ""}`);
});

app.get("/app/accounts/deals/export.csv", async (c) => {
  const [deals, lines] = await Promise.all([listCommissions(c.env.DB), listAllLines(c.env.DB)]);
  const byId = new Map(deals.map((d) => [d.id, d]));
  const head = ["Deal", "Deal Date", "Staff", "Client", "Quote #", "Invoice #", "Invoice Nett", "Comm %", "Commission", "Stage", "Date", "Reference", "Transaction Type", "Allocation", "PO", "Description", "Payments", "Invoices"];
  const out = [head.join(",")];
  for (const l of lines) {
    const d = byId.get(l.commission_id);
    out.push([
      csv(d?.allocation ?? ""), d?.deal_date ? formatDMY(d.deal_date) : "", csv(d?.staff ?? ""), csv(d?.client ?? ""), csv(d?.quote_no ?? ""), csv(d?.invoice_no ?? ""),
      d?.invoice_nett != null ? d.invoice_nett.toFixed(2) : "", d?.comm_pct != null ? String(d.comm_pct) : "", (() => { const v = d ? commissionOf(d) : null; return v != null ? v.toFixed(2) : ""; })(), d?.stage ?? "",
      l.tx_date ? formatDMY(l.tx_date) : "", csv(l.reference ?? ""), csv(l.tx_type ?? ""), csv(l.allocation ?? ""),
      csv(l.po_number ?? ""), csv(l.description ?? ""),
      l.payment ? l.payment.toFixed(2) : "", l.invoice ? l.invoice.toFixed(2) : "",
    ].join(","));
  }
  return csvResponse(c, "deals.csv", out.join("\n"));
});

// ----- Monthly expense log -----

app.get("/app/finance/costs/monthly", async (c) => {
  const [txns, names, allExpenses, lastSync] = await Promise.all([
    listXeroTxns(c.env.DB),
    staffFirstNames(c.env.DB),
    listExpenses(c.env.DB),
    getMeta(c.env.DB, "xero_last_sync"),
  ]);
  // Same period windows as the Recurring costs tab.
  const pRaw = String(c.req.query("p") ?? "all");
  const costPeriod = (["all", "month", "lastmonth", "quarter", "fy"] as const).includes(pRaw as any) ? (pRaw as "all" | "month" | "lastmonth" | "quarter" | "fy") : "all";
  const nowMonth = new Date().toISOString().slice(0, 7);
  const fyStart = `${fiscalYearOf(nowMonth) - 1}-03`;
  const qOff = (Number(nowMonth.slice(0, 4)) - Number(fyStart.slice(0, 4))) * 12 + Number(nowMonth.slice(5, 7)) - Number(fyStart.slice(5, 7));
  const qStart = addMonths(fyStart, Math.floor(qOff / 3) * 3);
  const win = {
    all: { start: null as string | null, end: null as string | null, label: "synced window (18 mo)", months: 18 },
    month: { start: `${nowMonth}-01`, end: null, label: label(nowMonth), months: 1 },
    lastmonth: { start: `${addMonths(nowMonth, -1)}-01`, end: `${nowMonth}-01`, label: label(addMonths(nowMonth, -1)), months: 1 },
    quarter: { start: `${qStart}-01`, end: null, label: `${label(qStart)} – ${label(nowMonth)}`, months: monthsBetweenIncl(qStart, nowMonth) },
    fy: { start: `${fyStart}-01`, end: null, label: `${fyLabel(fiscalYearOf(nowMonth))} to date`, months: monthsBetweenIncl(fyStart, nowMonth) },
  }[costPeriod];

  // Every outgoing document in the window, grouped by vendor. Staff and
  // contractor payees are excluded — they belong to Payroll.
  const recurringNames = new Set(allExpenses.filter((e) => e.active && e.source === "xero").map((e) => (e.vendor || e.name).trim().toLowerCase()));
  const byVendor = new Map<string, SpendVendorRow>();
  const excluded = new Set<string>();
  const inWindow = (d: string) => (!win.start || d >= win.start) && (!win.end || d < win.end);
  const kept: typeof txns = [];
  for (const t of txns) {
    if (t.kind !== "bill" && t.kind !== "spend") continue;
    if (!inWindow(t.txn_date)) continue;
    const name = t.contact.trim();
    if (!name || /^bank transaction$/i.test(name) || /^\(no contact\)$/i.test(name)) continue;
    const isSars = /^SARS\b/i.test(name);
    if (!isSars && autoExcludeReason(name, names) != null) {
      excluded.add(name.toLowerCase());
      continue;
    }
    kept.push(t);
    if (!byVendor.has(name)) {
      byVendor.set(name, { vendor: name, docs: 0, excl: 0, vat: 0, incl: 0, recurring: recurringNames.has(name.toLowerCase()), tax: isSars, manual: false });
    }
    const v = byVendor.get(name)!;
    v.docs++;
    v.excl += t.sub_total;
    v.incl += t.total;
    v.vat += t.total - t.sub_total;
  }
  // Manual recurring items have no Xero documents — modelled over the window.
  for (const e of allExpenses) {
    if (e.source !== "manual" || !e.active) continue;
    const amt = monthlyEquivalent(e) * win.months;
    byVendor.set(`manual:${e.id}`, { vendor: e.name, docs: 0, excl: amt, vat: 0, incl: amt, recurring: true, tax: false, manual: true });
  }
  const rows = [...byVendor.values()].sort((a, b) => b.incl - a.incl);

  const openVendor = c.req.query("open")?.trim() || null;
  const openDocs: SpendDoc[] = openVendor
    ? kept
        .filter((t) => t.contact.trim() === openVendor)
        .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
        .map((t) => ({ date: t.txn_date, kind: t.kind, reference: t.reference, excl: t.sub_total, vat: t.total - t.sub_total, incl: t.total }))
    : [];

  return c.html(
    <SpendDetailPage rows={rows} openVendor={openVendor} openDocs={openDocs} costPeriod={costPeriod} periodLabel={win.label}
      windowMonths={win.months} excludedCount={excluded.size} lastSyncLabel={lastSync ? formatDMYTime(lastSync) : null} />,
  );
});

// ----- Vendor review -----

app.get("/app/admin/vendors", async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET) return c.redirect("/app/admin");
  try {
    const token = await ensureAccessToken(c.env.DB, c.env.XERO_CLIENT_ID.trim(), c.env.XERO_CLIENT_SECRET.trim());
    if (!token) return c.redirect(`/app/admin?msg=${encodeURIComponent("Connect Xero first.")}`);
    const tenantId = await getMeta(c.env.DB, "xero_tenant_id");
    if (!tenantId) return c.redirect(`/app/admin?msg=${encodeURIComponent("No Xero organisation — reconnect.")}`);
    const [summary, rules, names] = await Promise.all([
      fetchVendorBillSummary(token, tenantId, SYNC_MONTHS_BACK),
      listVendorRules(c.env.DB),
      staffFirstNames(c.env.DB),
    ]);
    const monthSet = new Set<string>();
    for (const v of summary) for (const m of Object.keys(v.months)) monthSet.add(m);
    const monthCols = [...monthSet].sort().slice(-SYNC_MONTHS_BACK);
    const vendors: AnnotatedVendor[] = summary.map((v) => {
      const rule = rules.get(v.key) ?? null;
      const autoReason = rule ? null : autoExcludeReason(v.name, names);
      let effective: AnnotatedVendor["effective"];
      if (rule?.rule === "track") effective = "track";
      else if (rule?.rule === "exclude" || autoReason) effective = "exclude";
      else if (v.monthCount >= SYNC_MIN_MONTHS) effective = "auto-track";
      else effective = "ignored";
      return { ...v, rule, autoExcludeReason: autoReason, effective };
    });
    const msg = c.req.query("msg") ? decodeURIComponent(String(c.req.query("msg"))) : undefined;
    return c.html(<VendorReviewPage vendors={vendors} monthCols={monthCols} monthsBack={SYNC_MONTHS_BACK} minMonths={SYNC_MIN_MONTHS} msg={msg} />);
  } catch (e) {
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Vendor review failed: ${e instanceof Error ? e.message : "unknown"}`)}`);
  }
});

app.post("/app/expenses/vendor-rule", async (c) => {
  const b = await c.req.parseBody();
  const key = String(b.key ?? "");
  const name = String(b.name ?? "").trim() || key;
  const rule = String(b.rule ?? "");
  if (key) {
    if (rule === "track" || rule === "exclude") {
      await setVendorRule(c.env.DB, key, name, rule, "manual");
      if (rule === "exclude") await deleteExpenseByXeroId(c.env.DB, `vendor:${key}`);
    } else if (rule === "clear") {
      await clearVendorRule(c.env.DB, key);
    }
  }
  return c.redirect("/app/admin/vendors");
});

// --- helpers -------------------------------------------------------------

function csv(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal CSV parser: quoted fields, escaped quotes, CRLF/LF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}
function csvResponse(c: any, filename: string, body: string): Response {
  return new Response("﻿" + body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ===========================================================================
// Client Billing & Cost Allocation — the Clients tab (docs/client-billing.md)
// ===========================================================================

const BILLING_START = "2026-03";
const nowBillingPeriod = () => new Date().toISOString().slice(0, 7);

const billingPeriodKey = (v: string | undefined): BillingPeriodKey =>
  v === "month" || v === "lastmonth" || v === "quarter" || v === "lastquarter" || v === "fy" || v === "all" ? v : "month";

/** Months (clamped to synced history) + label for a ?p= filter key. */
function billingWindow(key: BillingPeriodKey): { months: string[]; label: string } {
  const nowM = nowBillingPeriod();
  const fyS = `${fiscalYearOf(nowM) - 1}-03`;
  const qOff = (Number(nowM.slice(0, 4)) - Number(fyS.slice(0, 4))) * 12 + Number(nowM.slice(5, 7)) - Number(fyS.slice(5, 7));
  const qS = addMonths(fyS, Math.floor(qOff / 3) * 3);
  const clamp = (s: string) => (s < BILLING_START ? BILLING_START : s);
  switch (key) {
    case "month":
      return { months: [nowM], label: label(nowM) };
    case "lastmonth": {
      const m = addMonths(nowM, -1);
      return { months: [m], label: label(m) };
    }
    case "quarter":
      return { months: rangeInclusive(clamp(qS), nowM), label: `${label(qS)} – ${label(nowM)}` };
    case "lastquarter": {
      const s = addMonths(qS, -3);
      const e = addMonths(qS, -1);
      return { months: rangeInclusive(clamp(s), e), label: `${label(s)} – ${label(e)}` };
    }
    case "fy":
      return { months: rangeInclusive(clamp(fyS), nowM), label: `${fyLabel(fiscalYearOf(nowM))} to date` };
    case "all":
      return { months: rangeInclusive(BILLING_START, nowM), label: "All time (since Mar 2026)" };
  }
}

/** PeriodResult per month: closed months read their frozen snapshot, open
 * months compute live. Batched — one set of D1 reads covers the whole window. */
async function computeBillingMonths(db: D1Database, months: string[]): Promise<Map<string, PeriodResult>> {
  const nowM = nowBillingPeriod();
  const wanted = months.filter((m) => m >= BILLING_START && m <= nowM);
  const out = new Map<string, PeriodResult>();
  if (!wanted.length) return out;
  const snaps = await getSnapshots(db, wanted);
  const toCompute = wanted.filter((m) => !snaps.has(m));
  const inputs = toCompute.length ? await loadPeriodInputs(db, toCompute) : new Map();
  for (const m of wanted) {
    const snap = snaps.get(m);
    if (snap) {
      // Snapshots frozen before the Carry column exist without it.
      if (snap.totals.carryC === undefined) {
        snap.totals.carryC = 0;
        (snap as { carriedLossC?: number }).carriedLossC = (snap as { carriedLossC?: number }).carriedLossC ?? 0;
        for (const cl of snap.clients) {
          cl.carryC = cl.carryC ?? 0;
          for (const pr of cl.projects) pr.carryC = pr.carryC ?? 0;
        }
      }
      out.set(m, snap);
    } else {
      out.set(m, computePeriod(inputs.get(m)!));
    }
  }
  return out;
}

const mergeGroupAmounts = (lists: GroupAmount[][]): GroupAmount[] => {
  const m = new Map<string, number>();
  for (const list of lists) for (const g of list) m.set(g.group, (m.get(g.group) ?? 0) + g.amountC);
  return [...m].map(([group, amountC]) => ({ group, amountC })).sort((a, b) => a.group.localeCompare(b.group));
};
const mergeStaffPieces = (lists: StaffPiece[][]): StaffPiece[] => {
  const m = new Map<string, StaffPiece>();
  for (const list of lists)
    for (const s of list) {
      const k = `${s.employeeId}|${s.name}`;
      const prev = m.get(k);
      m.set(k, prev ? { ...prev, amountC: prev.amountC + s.amountC, estimated: prev.estimated || s.estimated } : { ...s });
    }
  return [...m.values()].sort((a, b) => b.amountC - a.amountC);
};
const mergeSupplierAmounts = (lists: SupplierAmount[][]): SupplierAmount[] => {
  const m = new Map<string, number>();
  for (const list of lists) for (const s of list) m.set(s.supplier, (m.get(s.supplier) ?? 0) + s.amountC);
  return [...m].map(([supplier, amountC]) => ({ supplier, amountC })).sort((a, b) => b.amountC - a.amountC);
};
const addBudget = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
const pctOf = (num: number, den: number): number | null => (den !== 0 ? (num / den) * 100 : null);

function mergeProjectResults(parts: ProjectResult[]): ProjectResult {
  const f = parts[0];
  const sum = (sel: (p: ProjectResult) => number) => parts.reduce((s, p) => s + sel(p), 0);
  const revenueC = sum((p) => p.revenueC);
  const peopleC = sum((p) => p.peopleC);
  const directC = sum((p) => p.directC);
  const overheadC = sum((p) => p.overheadC);
  return {
    projectId: f.projectId,
    name: f.name,
    isDefault: f.isDefault,
    revenueC,
    revenueByGroup: mergeGroupAmounts(parts.map((p) => p.revenueByGroup)),
    peopleC,
    peopleByStaff: mergeStaffPieces(parts.map((p) => p.peopleByStaff)),
    directC,
    directByGroup: mergeGroupAmounts(parts.map((p) => p.directByGroup)),
    directBySupplier: mergeSupplierAmounts(parts.map((p) => p.directBySupplier)),
    contributionC: revenueC - peopleC - directC,
    overheadC,
    carryC: sum((p) => p.carryC ?? 0),
    netC: revenueC - peopleC - directC - overheadC - sum((p) => p.carryC ?? 0),
    budgetRevenueC: parts.reduce<number | null>((a, p) => addBudget(a, p.budgetRevenueC), null),
    budgetCostC: parts.reduce<number | null>((a, p) => addBudget(a, p.budgetCostC), null),
  };
}

function mergeClientResults(parts: ClientResult[]): ClientResult {
  const f = parts[0];
  const sum = (sel: (p: ClientResult) => number) => parts.reduce((s, p) => s + sel(p), 0);
  const revenueC = sum((p) => p.revenueC);
  const peopleC = sum((p) => p.peopleC);
  const directC = sum((p) => p.directC);
  const overheadC = sum((p) => p.overheadC);
  const contributionC = revenueC - peopleC - directC;
  const byProject = new Map<string, ProjectResult[]>();
  for (const part of parts)
    for (const pr of part.projects) {
      const list = byProject.get(pr.projectId) ?? [];
      list.push(pr);
      byProject.set(pr.projectId, list);
    }
  return {
    clientId: f.clientId,
    name: f.name,
    shortName: f.shortName,
    isGeneral: f.isGeneral,
    revenueC,
    revenueByGroup: mergeGroupAmounts(parts.map((p) => p.revenueByGroup)),
    peopleC,
    peopleByStaff: mergeStaffPieces(parts.map((p) => p.peopleByStaff)),
    directC,
    directByGroup: mergeGroupAmounts(parts.map((p) => p.directByGroup)),
    directBySupplier: mergeSupplierAmounts(parts.map((p) => p.directBySupplier)),
    contributionC,
    contributionPct: pctOf(contributionC, revenueC),
    overheadC,
    carryC: sum((p) => p.carryC ?? 0),
    netC: contributionC - overheadC - sum((p) => p.carryC ?? 0),
    netPct: pctOf(contributionC - overheadC - sum((p) => p.carryC ?? 0), revenueC),
    budgetRevenueC: parts.reduce<number | null>((a, p) => addBudget(a, p.budgetRevenueC), null),
    budgetCostC: parts.reduce<number | null>((a, p) => addBudget(a, p.budgetCostC), null),
    projects: [...byProject.values()].map(mergeProjectResults),
  };
}

/** Sum monthly PeriodResults into one result for a multi-month window. */
function mergeBillingResults(parts: PeriodResult[]): PeriodResult | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const clientOrder: string[] = [];
  const byClient = new Map<string, ClientResult[]>();
  for (const part of parts)
    for (const cl of part.clients) {
      if (!byClient.has(cl.clientId)) clientOrder.push(cl.clientId);
      const list = byClient.get(cl.clientId) ?? [];
      list.push(cl);
      byClient.set(cl.clientId, list);
    }
  const sum = (sel: (p: PeriodResult) => number) => parts.reduce((s, p) => s + sel(p), 0);
  const unmapped = new Map<string, { contactName: string; amountC: number; lineCount: number }>();
  for (const part of parts)
    for (const u of part.exceptions.unmappedContacts) {
      const prev = unmapped.get(u.contactName);
      unmapped.set(u.contactName, prev ? { contactName: u.contactName, amountC: prev.amountC + u.amountC, lineCount: prev.lineCount + u.lineCount } : { ...u });
    }
  return {
    period: `${parts[0].period}..${parts[parts.length - 1].period}`,
    overheadBasis: parts[0].overheadBasis,
    clients: clientOrder.map((id) => mergeClientResults(byClient.get(id)!)),
    poolC: sum((p) => p.poolC),
    excludedC: sum((p) => p.excludedC),
    excludedRevenueC: sum((p) => p.excludedRevenueC),
    totals: {
      revenueC: sum((p) => p.totals.revenueC),
      peopleC: sum((p) => p.totals.peopleC),
      directC: sum((p) => p.totals.directC),
      contributionC: sum((p) => p.totals.contributionC),
      overheadC: sum((p) => p.totals.overheadC),
      carryC: sum((p) => p.totals.carryC ?? 0),
      netC: sum((p) => p.totals.netC),
    },
    carriedLossC: sum((p) => p.carriedLossC ?? 0),
    reconciliation: {
      costInC: sum((p) => p.reconciliation.costInC),
      costAllocatedC: sum((p) => p.reconciliation.costAllocatedC),
      revenueInC: sum((p) => p.reconciliation.revenueInC),
      revenueAllocatedC: sum((p) => p.reconciliation.revenueAllocatedC),
      ok: parts.every((p) => p.reconciliation.ok),
    },
    exceptions: {
      unmappedContacts: [...unmapped.values()].sort((a, b) => b.amountC - a.amountC),
      unassignedDirect: parts.flatMap((p) => p.exceptions.unassignedDirect),
      unmatchedStaff: parts.flatMap((p) => p.exceptions.unmatchedStaff),
      estimatedStaff: parts.flatMap((p) => p.exceptions.estimatedStaff),
      overAllocated: parts.flatMap((p) => p.exceptions.overAllocated),
    },
  };
}

const EMPTY_AGG: TrackerAggregate = { revenueC: 0, peopleC: 0, directC: 0, contributionC: 0, overheadC: 0, carryC: 0, netC: 0, budgetRevenueC: null, budgetCostC: null };
const aggAdd = (a: TrackerAggregate, r: { revenueC: number; peopleC: number; directC: number; contributionC: number; overheadC: number; carryC?: number; netC: number; budgetRevenueC: number | null; budgetCostC: number | null } | null): TrackerAggregate =>
  r
    ? {
        revenueC: a.revenueC + r.revenueC,
        peopleC: a.peopleC + r.peopleC,
        directC: a.directC + r.directC,
        contributionC: a.contributionC + r.contributionC,
        overheadC: a.overheadC + r.overheadC,
        carryC: a.carryC + (r.carryC ?? 0),
        netC: a.netC + r.netC,
        budgetRevenueC: addBudget(a.budgetRevenueC, r.budgetRevenueC),
        budgetCostC: addBudget(a.budgetCostC, r.budgetCostC),
      }
    : a;

/** Assignable targets for selects: the 12 default projects (client order), then extra open projects. */
async function billingTargetOptions(db: D1Database): Promise<{ id: string; label: string; clientId: string }[]> {
  const [clients, projects] = await Promise.all([listClients(db), listBillingProjects(db)]);
  const active = clients.filter((c) => c.active);
  const out: { id: string; label: string; clientId: string }[] = [];
  for (const cl of active) {
    const def = projects.find((p) => p.clientId === cl.id && p.isDefault);
    if (def) out.push({ id: def.id, label: cl.shortName ?? cl.name, clientId: cl.id });
  }
  for (const p of projects.filter((p) => !p.isDefault && p.status === "open")) {
    const cl = active.find((c) => c.id === p.clientId);
    if (cl) out.push({ id: p.id, label: `${cl.shortName ?? cl.name} · ${p.name}`, clientId: cl.id });
  }
  return out;
}

const billing409 = (c: any, e: unknown): Response => {
  if (e instanceof BillingError) return c.text(e.message, e.status as 409);
  throw e;
};

// ---- Summary ---------------------------------------------------------------

app.get("/app/clients", async (c) => {
  const pKey = billingPeriodKey(c.req.query("p"));
  const view = c.req.query("view") === "grid" ? ("grid" as const) : ("table" as const);
  const { months, label: periodLabel } = billingWindow(pKey);
  const resMap = await computeBillingMonths(c.env.DB, months);
  const computed = [...resMap.keys()];
  const result = mergeBillingResults(computed.map((m) => resMap.get(m)!));
  const monthlyNet =
    view === "grid"
      ? computed.map((m) => ({ month: m, byClient: Object.fromEntries(resMap.get(m)!.clients.map((cl) => [cl.clientId, cl.netC])) }))
      : null;
  let closedBadge: string | null = null;
  if (months.length === 1) {
    const bp = await getBillingPeriod(c.env.DB, months[0]);
    if (bp?.status === "closed") closedBadge = "Closed — reading the frozen snapshot";
  }
  // Xero P&L for the same window (accrual actuals synced into cf_actuals):
  // the tie-out strip under the table compares it with the module's totals.
  let xeroCheck: { incomeC: number; costC: number; monthsCovered: number } | null = null;
  if (computed.length) {
    const marks = computed.map(() => "?").join(",");
    const { results: pnlRows } = await c.env.DB
      .prepare(`SELECT income_accr, staff_accr, dev_accr, other_accr FROM cf_actuals WHERE month IN (${marks})`)
      .bind(...computed)
      .all<{ income_accr: number; staff_accr: number; dev_accr: number; other_accr: number }>();
    if (pnlRows?.length) {
      let incomeC = 0;
      let costC = 0;
      for (const r of pnlRows) {
        incomeC += Math.round((r.income_accr ?? 0) * 100);
        costC += Math.round(((r.staff_accr ?? 0) + (r.dev_accr ?? 0) + (r.other_accr ?? 0)) * 100);
      }
      xeroCheck = { incomeC, costC, monthsCovered: pnlRows.length };
    }
  }
  const lastSync = await getMeta(c.env.DB, "xero_last_sync");
  return c.html(
    <ClientsSummaryPage
      result={result}
      periodKey={pKey}
      periodLabel={periodLabel}
      months={computed}
      view={view}
      monthlyNet={monthlyNet}
      lastSyncLabel={lastSync ? formatDMYTime(lastSync) : null}
      closedBadge={closedBadge}
      xeroCheck={xeroCheck}
    />,
  );
});

// ---- Settings (registered before /app/clients/:id) --------------------------

const SETTINGS_TABS = ["clients", "contacts", "accounts", "staff", "overhead"] as const;

app.get("/app/clients/settings", async (c) => {
  const db = c.env.DB;
  const tab = (SETTINGS_TABS as readonly string[]).includes(String(c.req.query("s"))) ? (String(c.req.query("s")) as (typeof SETTINGS_TABS)[number]) : "clients";
  const basisPeriod = isPeriod(String(c.req.query("period"))) ? String(c.req.query("period")) : nowBillingPeriod();
  const [clients, projects, mappings, categories, payees, bp, input] = await Promise.all([
    listClients(db),
    listBillingProjects(db),
    listContactMappings(db),
    listGlCategories(db),
    listStaffPayees(db),
    getBillingPeriod(db, basisPeriod),
    loadPeriodInput(db, basisPeriod),
  ]);
  const settingsClients: SettingsClient[] = clients.map((cl) => ({
    id: cl.id,
    name: cl.name,
    shortName: cl.shortName,
    isGeneral: cl.isGeneral,
    active: cl.active,
    sortOrder: cl.sortOrder,
    projects: projects
      .filter((p) => p.clientId === cl.id)
      .map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, billingType: p.billingType, contractValueC: p.contractValueC, status: p.status })),
    contacts: mappings.filter((m) => m.clientId === cl.id).map((m) => ({ id: m.id, contactName: m.contactName })),
  }));
  const staff = input.staff.map((s) => ({
    employeeId: s.employeeId,
    name: s.name,
    defaultTarget: s.defaultTarget,
    loadingPct: s.loadingPct,
    payees: payees.filter((p) => p.employeeId === s.employeeId).map((p) => ({ id: p.id, matchText: p.matchText, matchMode: p.matchMode })),
  }));
  return c.html(
    <ClientsSettingsPage
      tab={tab}
      clients={settingsClients}
      categories={categories.map((g) => ({ code: g.code, name: g.name, kind: g.kind, reportGroup: g.reportGroup, treatment: g.treatment, active: g.active }))}
      staff={staff}
      basisPeriod={basisPeriod}
      basis={bp?.overheadBasis ?? "revenue"}
      fixedShares={input.fixedShares}
      saved={c.req.query("saved") === "1"}
      error={c.req.query("err") ?? null}
    />,
  );
});

const settingsRedirect = (c: any, tab: string, err?: string) => c.redirect(`/app/clients/settings?s=${tab}&${err ? `err=${encodeURIComponent(err)}` : "saved=1"}`);
const settingsAction = (tab: string, fn: (c: any, b: Record<string, any>, actor: string) => Promise<void>) => async (c: any) => {
  const b = await c.req.parseBody();
  const actor = (await getActor(c)) ?? "";
  try {
    await fn(c, b, actor);
    return settingsRedirect(c, tab);
  } catch (e) {
    if (e instanceof BillingError) return settingsRedirect(c, tab, e.message);
    throw e;
  }
};

app.post("/app/clients/settings/client", settingsAction("clients", async (c, b, actor) => {
  await createClient(c.env.DB, String(b.name ?? "").trim(), String(b.short_name ?? "").trim() || null, actor);
}));
app.post("/app/clients/settings/project", settingsAction("clients", async (c, b, actor) => {
  const contract = String(b.contract_value ?? "").trim();
  const contractC = contract === "" ? null : Math.round(parseMoney(contract) * 100);
  const billingType = (["fixed", "retainer", "time", "recurring"].includes(String(b.billing_type)) ? String(b.billing_type) : "retainer") as BillingProject["billingType"];
  if (b.id) await updateProject(c.env.DB, String(b.id), { name: String(b.name ?? "").trim(), billingType, contractValueC: contractC }, actor);
  else await createProject(c.env.DB, String(b.client ?? ""), String(b.name ?? "").trim(), billingType, contractC, actor);
}));
app.post("/app/clients/settings/project/close", settingsAction("clients", async (c, b, actor) => {
  await closeProject(c.env.DB, String(b.id ?? ""), actor);
}));
app.post("/app/clients/settings/contact", settingsAction("contacts", async (c, b, actor) => {
  await mapContact(c.env.DB, String(b.client ?? ""), String(b.contact_name ?? "").trim(), actor);
}));
app.post("/app/clients/settings/contact/delete", settingsAction("contacts", async (c, b, actor) => {
  await deleteContactMapping(c.env.DB, String(b.id ?? ""), actor);
}));
app.post("/app/clients/settings/category", settingsAction("accounts", async (c, b, actor) => {
  await setCategoryTreatment(c.env.DB, String(b.code ?? ""), String(b.report_group ?? "").trim(), String(b.treatment) as GlTreatment, actor);
}));
app.post("/app/clients/settings/staff", settingsAction("staff", async (c, b, actor) => {
  const target = b.default_target === "overhead" ? "overhead" : "general";
  await setEmployeeBillingSettings(c.env.DB, String(b.employee ?? ""), target, parseMoney(String(b.loading_pct ?? "0")) || 0, actor);
}));
app.post("/app/clients/settings/payee", settingsAction("staff", async (c, b, actor) => {
  const mode = b.match_mode === "exact" ? "exact" : b.match_mode === "word" ? "word" : "contains";
  await addStaffPayee(c.env.DB, String(b.employee ?? ""), String(b.match_text ?? "").trim(), mode, actor);
}));
app.post("/app/clients/settings/payees/seed", settingsAction("staff", async (c, _b, actor) => {
  await seedNameAliases(c.env.DB, actor);
}));
app.post("/app/clients/settings/payee/delete", settingsAction("staff", async (c, b, actor) => {
  await deleteStaffPayee(c.env.DB, String(b.id ?? ""), actor);
}));
app.post("/app/clients/settings/basis", settingsAction("overhead", async (c, b, actor) => {
  const period = isPeriod(String(b.period)) ? String(b.period) : nowBillingPeriod();
  const basis = (["revenue", "direct_cost", "fixed"].includes(String(b.basis)) ? String(b.basis) : "revenue") as OverheadBasis;
  await setOverheadBasis(c.env.DB, period, basis, actor);
  if (basis === "fixed") {
    const shares: { clientId: string; pct: number }[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (k.startsWith("share::") && String(v).trim() !== "") shares.push({ clientId: k.slice(7), pct: parseMoney(String(v)) });
    }
    await setFixedShares(c.env.DB, period, shares, actor);
  }
}));

// ---- Month close ------------------------------------------------------------

async function buildCloseChecks(db: D1Database, period: string, result: PeriodResult): Promise<CloseCheck[]> {
  const r = result.reconciliation;
  const ex = result.exceptions;
  const fmtR = (cents: number) => formatZAR(Math.round(cents / 100));
  const checks: CloseCheck[] = [
    {
      label: "Reconciliation holds to the cent",
      level: "block",
      pass: r.ok,
      detail: r.ok ? `cost in ${fmtR(r.costInC)} = allocated ${fmtR(r.costAllocatedC)}` : `cost in ${fmtR(r.costInC)} vs allocated ${fmtR(r.costAllocatedC)}; revenue in ${fmtR(r.revenueInC)} vs allocated ${fmtR(r.revenueAllocatedC)}`,
      href: null,
    },
    {
      label: "Contacts defaulting to General Sales",
      level: "warn",
      pass: ex.unmappedContacts.length === 0,
      detail: ex.unmappedContacts.length ? `${ex.unmappedContacts.length} contact(s) — fine if they belong in General; map or accept them on the Revenue page` : null,
      href: "/app/revenue?p=month",
    },
    {
      label: "Staff payments defaulting to General Sales",
      level: "warn",
      pass: ex.unmatchedStaff.length === 0,
      detail: ex.unmatchedStaff.length ? `${ex.unmatchedStaff.length} line(s), ${fmtR(ex.unmatchedStaff.reduce((s, u) => s + u.amountC, 0))} — add payee aliases to follow the person` : null,
      href: "/app/costs?p=month&tab=unmatched",
    },
    {
      label: "No allocation rows over 100%",
      level: "block",
      pass: ex.overAllocated.length === 0,
      detail: ex.overAllocated.length ? ex.overAllocated.map((o) => `${o.name} ${o.totalPct}%`).join(", ") : null,
      href: `/app/allocations?period=${period}`,
    },
    {
      label: "Unassigned direct lines (they sit in General Sales)",
      level: "warn",
      pass: ex.unassignedDirect.length === 0,
      detail: ex.unassignedDirect.length ? `${ex.unassignedDirect.length} line(s), ${fmtR(ex.unassignedDirect.reduce((s, u) => s + u.amountC, 0))}` : null,
      href: "/app/costs?p=month&tab=unassigned",
    },
    {
      label: "Staff on payroll estimates",
      level: "warn",
      pass: ex.estimatedStaff.length === 0,
      detail: ex.estimatedStaff.length ? ex.estimatedStaff.map((s) => s.name).join(", ") : null,
      href: null,
    },
  ];
  // Xero P&L tie-out (accrual actuals already synced into cf_actuals).
  const pnl = await db
    .prepare("SELECT income_accr, staff_accr, dev_accr, other_accr FROM cf_actuals WHERE month = ?")
    .bind(period)
    .first<{ income_accr: number; staff_accr: number; dev_accr: number; other_accr: number }>();
  if (pnl) {
    const xeroIncome = Math.round((pnl.income_accr ?? 0) * 100);
    const xeroCost = Math.round(((pnl.staff_accr ?? 0) + (pnl.dev_accr ?? 0) + (pnl.other_accr ?? 0)) * 100);
    const revDiff = result.totals.revenueC - xeroIncome;
    const costDiff = result.reconciliation.costInC - xeroCost;
    const pass = Math.abs(revDiff) < 100 && Math.abs(costDiff) < 100;
    checks.push({
      label: "Xero P&L tie-out",
      level: "warn",
      pass,
      detail: pass ? null : `revenue off by ${fmtR(revDiff)}, cost off by ${fmtR(costDiff)} vs the Xero P&L — a sync gap or a journal outside bills/spend/invoices`,
      href: "/app/finance/pnl",
    });
  } else {
    checks.push({ label: "Xero P&L tie-out", level: "warn", pass: false, detail: "no synced P&L actuals for this month yet — run a sync", href: null });
  }
  return checks;
}

app.get("/app/clients/close", async (c) => {
  const db = c.env.DB;
  const q = String(c.req.query("period") ?? "");
  const period = isPeriod(q) ? q : addMonths(nowBillingPeriod(), -1);
  const periods = await listBillingPeriods(db);
  const bp = periods.find((p) => p.period === period) ?? null;
  const status = bp?.status === "closed" ? ("closed" as const) : ("open" as const);
  const result = status === "closed" ? (await getSnapshot(db, period))! : computePeriod(await loadPeriodInput(db, period));
  const checks = await buildCloseChecks(db, period, result);
  const [postClose, audit] = await Promise.all([getMeta(db, "billing_postclose_warning"), listAudit(db, 50)]);
  return c.html(
    <ClientClosePage
      period={period}
      months={periods.filter((p) => p.period <= nowBillingPeriod()).map((p) => ({ period: p.period, status: p.status as "open" | "closed" }))}
      status={status}
      closedAt={bp?.closedAt ?? null}
      checks={checks}
      canClose={status === "open" && checks.filter((ch) => ch.level === "block").every((ch) => ch.pass)}
      postCloseWarning={postClose || null}
      audit={audit.map((a) => ({ at: a.at, actor: a.actor, entity: a.entity, action: a.action, entityId: a.entityId }))}
      error={c.req.query("err") ?? null}
    />,
  );
});

app.post("/app/clients/close/run", async (c) => {
  const b = await c.req.parseBody();
  const period = isPeriod(String(b.period)) ? String(b.period) : "";
  if (!period) return c.redirect("/app/clients/close");
  const db = c.env.DB;
  const back = (err: string) => c.redirect(`/app/clients/close?period=${period}&err=${encodeURIComponent(err)}`);
  const bp = await getBillingPeriod(db, period);
  if (bp?.status === "closed") return c.text("Period is already closed", 409);
  const result = computePeriod(await loadPeriodInput(db, period));
  const checks = await buildCloseChecks(db, period, result);
  if (!checks.filter((ch) => ch.level === "block").every((ch) => ch.pass)) return back("Blocking checks failed — fix them first");
  if (checks.some((ch) => ch.level === "warn" && !ch.pass) && b.ack !== "1") return back("Tick the acknowledgement to close with warnings");
  try {
    await closePeriod(db, period, JSON.stringify(result), (await getActor(c)) ?? "");
  } catch (e) {
    return billing409(c, e);
  }
  return c.redirect(`/app/clients/close?period=${period}`);
});

app.post("/app/clients/close/reopen", async (c) => {
  const b = await c.req.parseBody();
  const period = isPeriod(String(b.period)) ? String(b.period) : "";
  if (period) await reopenPeriod(c.env.DB, period, (await getActor(c)) ?? "");
  return c.redirect(`/app/clients/close?period=${period}`);
});

// ---- CSV exports ------------------------------------------------------------

app.get("/app/clients/export.csv", async (c) => {
  const db = c.env.DB;
  const view = String(c.req.query("view") ?? "summary");
  const pKey = billingPeriodKey(c.req.query("p"));
  const { months, label: pl } = billingWindow(pKey);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const R2 = (cents: number) => (cents / 100).toFixed(2);
  if (view === "costs") {
    const lines = await listCostLinesForPeriods(db, months);
    const rows = lines.map((l) => [l.txnDate, esc(l.supplier), esc(l.description), l.glCode ?? "", esc(l.reportGroup ?? ""), l.treatment ?? "", esc(l.employeeName ?? ""), R2(l.amountC)].join(","));
    return csvResponse(c, `costs-${pKey}.csv`, ["date,supplier,description,account,group,treatment,staff,amount_excl", ...rows].join("\n"));
  }
  if (view === "allocations") {
    const period = isPeriod(String(c.req.query("period"))) ? String(c.req.query("period")) : nowBillingPeriod();
    const input = await loadPeriodInput(db, period);
    const names = new Map(input.staff.map((s) => [s.employeeId, s.name]));
    const projNames = new Map(input.projects.map((p) => [p.id, p.name]));
    const rows = input.allocations.filter((a) => a.period === period).map((a) => [a.period, esc(names.get(a.employeeId) ?? a.employeeId), a.targetKind, esc(a.projectId ? projNames.get(a.projectId) ?? a.projectId : "Shared Overhead"), a.pct].join(","));
    return csvResponse(c, `allocations-${period}.csv`, ["period,staff,target_kind,target,pct", ...rows].join("\n"));
  }
  const resMap = await computeBillingMonths(db, months);
  if (view === "client") {
    const id = String(c.req.query("id") ?? "");
    const rows: string[] = [];
    for (const [m, res] of resMap) {
      const cl = res.clients.find((x) => x.clientId === id);
      if (cl) rows.push([m, esc(cl.name), R2(cl.revenueC), R2(cl.peopleC), R2(cl.directC), R2(cl.contributionC), R2(cl.overheadC), R2(cl.carryC ?? 0), R2(cl.netC)].join(","));
    }
    return csvResponse(c, `client-${id}.csv`, ["month,client,revenue,people,direct,balance,overhead,carry,net", ...rows].join("\n"));
  }
  const result = mergeBillingResults([...resMap.values()]);
  const rows = (result?.clients ?? []).map((cl) => [esc(cl.name), R2(cl.revenueC), R2(cl.peopleC), R2(cl.directC), R2(cl.contributionC), cl.contributionPct?.toFixed(1) ?? "", R2(cl.overheadC), R2(cl.carryC ?? 0), R2(cl.netC), cl.netPct?.toFixed(1) ?? ""].join(","));
  return csvResponse(c, `clients-${pKey}.csv`, [`client,revenue,people,direct,balance,balance_pct,overhead,carry,net,net_pct — ${pl}`, ...rows].join("\n"));
});

// ---- Client tracker + project view -------------------------------------------

const viewToggle = (c: any, key: string): boolean => c.req.query(key) !== "0";

app.get("/app/clients/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const clients = await listClients(db);
  const client = clients.find((x) => x.id === id);
  if (!client) return c.redirect("/app/clients");
  const nowM = nowBillingPeriod();
  const fy = fiscalYearOf(nowM);
  const months = rangeInclusive(`${fy - 1}-03`, `${fy}-02`);
  const resMap = await computeBillingMonths(db, months);
  const perMonth = months.map((m) => resMap.get(m)?.clients.find((x) => x.clientId === id) ?? null);
  const quarterTotals: TrackerAggregate[] = [0, 1, 2, 3].map((q) =>
    perMonth.slice(q * 3, q * 3 + 3).reduce(aggAdd, EMPTY_AGG),
  );
  const fyTotal = perMonth.reduce(aggAdd, EMPTY_AGG);
  const projects = (await listBillingProjects(db)).filter((p) => p.clientId === id && p.status === "open");
  return c.html(
    <ClientTrackerPage
      client={{ id: client.id, name: client.name, isGeneral: client.isGeneral }}
      months={months}
      perMonth={perMonth}
      quarterTotals={quarterTotals}
      fyTotal={fyTotal}
      expand={c.req.query("expand") ?? null}
      projectCount={projects.length}
      periodLabel={fyLabel(fy)}
      showOverhead={viewToggle(c, "oh")}
      showCarry={viewToggle(c, "cy")}
    />,
  );
});

app.get("/app/clients/:id/projects/:pid", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const [clients, projects] = await Promise.all([listClients(db), listBillingProjects(db)]);
  const client = clients.find((x) => x.id === id);
  const project = projects.find((p) => p.id === pid && p.clientId === id);
  if (!client || !project) return c.redirect("/app/clients");
  const nowM = nowBillingPeriod();
  const fy = fiscalYearOf(nowM);
  const months = rangeInclusive(`${fy - 1}-03`, `${fy}-02`);
  // One computation covers the FY columns AND all-time invoiced (history starts Mar 2026).
  const resMap = await computeBillingMonths(db, rangeInclusive(BILLING_START, nowM));
  const projOf = (m: string): ProjectResult | null =>
    resMap.get(m)?.clients.find((x) => x.clientId === id)?.projects.find((p) => p.projectId === pid) ?? null;
  const perMonth = months.map(projOf);
  let invoicedToDateC = 0;
  for (const res of resMap.values()) invoicedToDateC += res.clients.find((x) => x.clientId === id)?.projects.find((p) => p.projectId === pid)?.revenueC ?? 0;
  return c.html(
    <ProjectViewPage
      client={{ id: client.id, name: client.name }}
      project={{ id: project.id, name: project.name, billingType: project.billingType, contractValueC: project.contractValueC, invoicedToDateC }}
      months={months}
      perMonth={perMonth}
      fyTotal={perMonth.reduce(aggAdd, EMPTY_AGG)}
      periodLabel={fyLabel(fy)}
      showOverhead={viewToggle(c, "oh")}
      showCarry={viewToggle(c, "cy")}
    />,
  );
});

// ---- Staff allocation grid ---------------------------------------------------

async function allocationsProps(db: D1Database, period: string): Promise<Omit<AllocationsPageProps, "saved" | "error" | "applied">> {
  // The Default tab shows the standard split; staff costs display on the
  // current month's basis since a default has no month of its own.
  const isDefault = period === "default";
  const input = await loadPeriodInput(db, isDefault ? nowBillingPeriod() : period);
  const costBy = new Map<string, number>();
  for (const l of input.costLines) if (l.employeeId) costBy.set(l.employeeId, (costBy.get(l.employeeId) ?? 0) + l.amountC);
  const withCost = input.staff.map((s) => {
    const direct = costBy.get(s.employeeId) ?? 0;
    const estimated = direct === 0 && s.payrollGrossC !== null;
    const costC = direct !== 0 ? direct : estimated ? Math.round((s.payrollGrossC as number) * (1 + s.loadingPct / 100)) : 0;
    return { employeeId: s.employeeId, name: s.name, costC, estimated };
  });
  // A month shows only people with cost in it; the DEFAULT template lists every
  // active staff member (current-month cost shown where known, else R 0).
  let staff: { employeeId: string; name: string; costC: number; estimated: boolean }[];
  if (isDefault) {
    const active = ((await db.prepare("SELECT id FROM employees WHERE status = 'active'").all()).results ?? []) as { id: string }[];
    const activeIds = new Set(active.map((e) => String(e.id)));
    staff = withCost.filter((s) => activeIds.has(s.employeeId) || s.costC !== 0);
    staff.sort((a, b) => b.costC - a.costC || a.name.localeCompare(b.name));
  } else {
    staff = withCost.filter((s) => s.costC !== 0).sort((a, b) => b.costC - a.costC);
  }
  const clientOf = new Map(input.clients.map((cl) => [cl.id, cl]));
  const activeClients = input.clients.filter((cl) => cl.active);
  const columns: { projectId: string; label: string }[] = [];
  for (const cl of activeClients) {
    const def = input.projects.find((p) => p.clientId === cl.id && p.isDefault);
    if (def) columns.push({ projectId: def.id, label: cl.shortName ?? cl.name });
  }
  for (const p of input.projects.filter((p) => !p.isDefault && p.status === "open")) {
    columns.push({ projectId: p.id, label: `${clientOf.get(p.clientId)?.shortName ?? ""} · ${p.name}` });
  }
  const cells: Record<string, Record<string, number>> = {};
  const overheadPct: Record<string, number> = {};
  let carriedFrom: string | null = null;
  const addRow = (r: StaffAllocation) => {
    if (r.targetKind === "overhead") overheadPct[r.employeeId] = (overheadPct[r.employeeId] ?? 0) + r.pct;
    else if (r.projectId) {
      if (!cells[r.employeeId]) cells[r.employeeId] = {};
      cells[r.employeeId][r.projectId] = (cells[r.employeeId][r.projectId] ?? 0) + r.pct;
    }
  };
  if (isDefault) {
    for (const r of await listDefaultAllocations(db)) addRow(r);
  } else {
    const byEmp = new Map<string, StaffAllocation[]>();
    for (const a of input.allocations) {
      const list = byEmp.get(a.employeeId) ?? [];
      list.push(a);
      byEmp.set(a.employeeId, list);
    }
    let anyAtPeriod = false;
    let latestEarlier = "";
    for (const [, rows] of byEmp) {
      const latest = rows.reduce((mx, r) => (r.period > mx ? r.period : mx), "");
      if (!latest) continue;
      if (latest === period) anyAtPeriod = true;
      else if (latest > latestEarlier) latestEarlier = latest;
      for (const r of rows.filter((x) => x.period === latest)) addRow(r);
    }
    carriedFrom = !anyAtPeriod && latestEarlier ? latestEarlier : null;
  }
  return {
    period,
    months: rangeInclusive(BILLING_START, nowBillingPeriod()),
    staff,
    columns,
    cells,
    overheadPct,
    carriedFrom,
  };
}

const allocPeriodOf = (v: string | undefined): string => (v === "default" ? "default" : isPeriod(String(v)) ? String(v) : nowBillingPeriod());

app.get("/app/allocations", async (c) => {
  const period = allocPeriodOf(c.req.query("period"));
  const props = await allocationsProps(c.env.DB, period);
  const appliedQ = Number(c.req.query("applied") ?? "");
  return c.html(
    <AllocationsPage
      {...props}
      saved={c.req.query("saved") === "1"}
      applied={Number.isFinite(appliedQ) && c.req.query("applied") != null ? appliedQ : null}
      error={c.req.query("err") ?? null}
    />,
  );
});

app.post("/app/allocations/save", async (c) => {
  const b = await c.req.parseBody();
  const period = allocPeriodOf(String(b.period));
  const rows: AllocationInput[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!k.startsWith("a::")) continue;
    const pct = parseMoney(String(v ?? "").trim() || "0");
    if (!(pct > 0)) continue;
    const [, employeeId, target] = k.split("::");
    rows.push(target === "overhead" ? { employeeId, targetKind: "overhead", projectId: null, pct } : { employeeId, targetKind: "project", projectId: target, pct });
  }
  try {
    await saveAllocations(c.env.DB, period, rows, (await getActor(c)) ?? "");
  } catch (e) {
    if (e instanceof BillingError && e.status === 422) {
      const props = await allocationsProps(c.env.DB, period);
      return c.html(<AllocationsPage {...props} saved={false} applied={null} error={e.message} />, 422);
    }
    return billing409(c, e);
  }
  return c.redirect(`/app/allocations?period=${period}&saved=1`);
});

app.post("/app/allocations/apply-default", async (c) => {
  const b = await c.req.parseBody();
  try {
    const periods = await applyDefaultAllocations(c.env.DB, (await getActor(c)) ?? "", b.overwrite === "1");
    return c.redirect(`/app/allocations?period=default&applied=${periods.length}`);
  } catch (e) {
    if (e instanceof BillingError) return c.redirect(`/app/allocations?period=default&err=${encodeURIComponent(e.message)}`);
    throw e;
  }
});

app.post("/app/allocations/copy", async (c) => {
  const b = await c.req.parseBody();
  const period = isPeriod(String(b.period)) ? String(b.period) : nowBillingPeriod();
  const from = isPeriod(String(b.from)) ? String(b.from) : addMonths(period, -1);
  try {
    await copyAllocationsForward(c.env.DB, from, period, (await getActor(c)) ?? "");
  } catch (e) {
    return billing409(c, e);
  }
  return c.redirect(`/app/allocations?period=${period}&saved=1`);
});

app.post("/app/allocations/clear", async (c) => {
  const b = await c.req.parseBody();
  const period = allocPeriodOf(String(b.period));
  try {
    await clearAllocations(c.env.DB, period, (await getActor(c)) ?? "");
  } catch (e) {
    return billing409(c, e);
  }
  return c.redirect(`/app/allocations?period=${period}`);
});

// ---- Cost inbox ---------------------------------------------------------------

const COST_TABS: CostInboxTab[] = ["unassigned", "unmatched", "byrule", "assigned", "overhead", "excluded"];

app.get("/app/costs", async (c) => {
  const db = c.env.DB;
  const pKey = billingPeriodKey(c.req.query("p"));
  const tab = (COST_TABS as string[]).includes(String(c.req.query("tab"))) ? (String(c.req.query("tab")) as CostInboxTab) : "unassigned";
  const { months, label: periodLabel } = billingWindow(pKey);
  const [lines, rules, targets, employees] = await Promise.all([
    listCostLinesForPeriods(db, months),
    listRules(db),
    billingTargetOptions(db),
    listEmployees(db),
  ]);
  const targetLabel = new Map(targets.map((t) => [t.id, t.label]));
  const staffNameOf = new Map(employees.map((e: { id: string; name: string }) => [e.id, e.name]));
  const selectTargets = [...targets, ...employees.map((e: { id: string; name: string }) => ({ id: `staff:${e.id}`, label: `Staff: ${e.name}`, clientId: "" }))];
  const splitTargetLabel = (s: { targetKind: BillingTargetKind; projectId: string | null; employeeId?: string | null }) =>
    s.targetKind === "overhead"
      ? "Shared Overhead"
      : s.targetKind === "excluded"
        ? "Excluded"
        : s.targetKind === "staff"
          ? `Staff: ${staffNameOf.get(s.employeeId ?? "") ?? "?"}`
          : targetLabel.get(s.projectId ?? "") ?? "project";
  const classify = (l: CostLineView): { tab: CostInboxTab; target: string; ruleName: string | null } => {
    if (l.treatment === "excluded") return { tab: "excluded", target: "Excluded (account treatment)", ruleName: null };
    if (l.employeeId) return { tab: "assigned", target: `Staff: ${l.employeeName ?? "?"} — via share %`, ruleName: null };
    if (l.splits.length) {
      if (l.splits.every((s) => s.targetKind === "excluded")) return { tab: "excluded", target: "Excluded (manual)", ruleName: null };
      const target = l.splits.length === 1 ? splitTargetLabel(l.splits[0]) : `Split ${l.splits.length} ways`;
      return { tab: "assigned", target, ruleName: null };
    }
    if (l.treatment === "people") return { tab: "unmatched", target: "Unmatched → General Sales", ruleName: null };
    const rule = firstMatchingRule(rules, { supplier: l.supplier, description: l.description, glCode: l.glCode, txnDate: l.txnDate });
    if (rule) return { tab: "byrule", target: `Rule: ${rule.name}`, ruleName: rule.name };
    if (l.treatment === "direct") return { tab: "unassigned", target: "Unassigned → General Sales", ruleName: null };
    return { tab: "overhead", target: "Shared Overhead pool", ruleName: null };
  };
  const counts: Record<CostInboxTab, number> = { unassigned: 0, unmatched: 0, byrule: 0, assigned: 0, overhead: 0, excluded: 0 };
  const rows: CostInboxLine[] = [];
  for (const l of lines) {
    const k = classify(l);
    counts[k.tab]++;
    if (k.tab !== tab) continue;
    rows.push({
      id: l.id,
      txnDate: l.txnDate,
      supplier: l.supplier,
      description: l.description,
      glCode: l.glCode,
      reportGroup: l.reportGroup ?? "Unmapped",
      treatment: l.treatment ?? "overhead",
      amountC: l.amountC,
      docKind: l.docKind,
      target: k.target,
      employeeName: l.employeeName,
      hasSplits: l.splits.length > 0,
      ruleName: k.ruleName,
    });
  }
  rows.sort((a, b) => Math.abs(b.amountC) - Math.abs(a.amountC));
  return c.html(
    <CostInboxPage
      periodKey={pKey}
      periodLabel={periodLabel}
      tab={tab}
      counts={counts}
      lines={rows}
      projects={selectTargets}
      staffOptions={employees.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))}
      openSplit={c.req.query("split") ?? null}
    />,
  );
});

/** Parse a target select value: projectId | "overhead" | "excluded" | "staff:<employeeId>". */
const parseSplitTarget = (target: string, pct: number): { targetKind: BillingTargetKind; projectId: string | null; employeeId: string | null; pct: number } =>
  target === "overhead"
    ? { targetKind: "overhead", projectId: null, employeeId: null, pct }
    : target === "excluded"
      ? { targetKind: "excluded", projectId: null, employeeId: null, pct }
      : target.startsWith("staff:")
        ? { targetKind: "staff", projectId: null, employeeId: target.slice(6), pct }
        : { targetKind: "project", projectId: target, employeeId: null, pct };

const costsBack = (c: any, b: Record<string, any>, extra = "") =>
  c.redirect(`/app/costs?p=${String(b.p ?? "month")}&tab=${String(b.tab ?? "unassigned")}${extra}`);

app.post("/app/costs/assign", async (c) => {
  const b = await c.req.parseBody({ all: true });
  const ids = (Array.isArray(b.ids) ? b.ids : b.ids ? [b.ids] : []).map(String);
  const target = String(b.target ?? "");
  if (!ids.length || !target) return costsBack(c, b);
  const split = parseSplitTarget(target, 100);
  const actor = (await getActor(c)) ?? "";
  try {
    for (const id of ids) await setCostSplits(c.env.DB, id, [split], actor);
  } catch (e) {
    return billing409(c, e);
  }
  if (b.save_rule === "1" && ids.length === 1) {
    const line = await c.env.DB.prepare("SELECT supplier, gl_code FROM cost_lines WHERE id = ?").bind(ids[0]).first<{ supplier: string | null; gl_code: string | null }>();
    if (line?.supplier) {
      const qs = new URLSearchParams({ edit: "new", supplier: line.supplier, target });
      if (line.gl_code) qs.set("gl", line.gl_code);
      return c.redirect(`/app/costs/rules?${qs.toString()}`);
    }
  }
  return costsBack(c, b);
});

app.post("/app/costs/split", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  const splits: { targetKind: BillingTargetKind; projectId: string | null; employeeId: string | null; pct: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const target = String(b[`split_target_${i}`] ?? "");
    const pct = parseMoney(String(b[`split_pct_${i}`] ?? "").trim() || "0");
    if (!target || !(pct > 0)) continue;
    splits.push(parseSplitTarget(target, pct));
  }
  const actor = (await getActor(c)) ?? "";
  try {
    await setCostSplits(c.env.DB, id, splits, actor);
  } catch (e) {
    if (e instanceof BillingError) return costsBack(c, b, `&err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  // "Save as rule": turn the entered legs into a percent rule on this supplier
  // and open it in the editor for review.
  if (b.save_rule === "1" && splits.length) {
    const line = await c.env.DB.prepare("SELECT supplier FROM cost_lines WHERE id = ?").bind(id).first<{ supplier: string | null }>();
    if (line?.supplier) {
      const rule: CostRule = {
        id: crypto.randomUUID(),
        name: `${line.supplier} split`,
        priority: 100,
        supplierMatch: line.supplier,
        descriptionMatch: null,
        glCode: null,
        mode: "percent",
        effectiveFrom: null,
        effectiveTo: null,
        active: true,
        splits: splits
          .filter((x) => x.targetKind !== "excluded")
          .map((x) => ({ targetKind: x.targetKind as "project" | "overhead" | "staff", projectId: x.projectId, employeeId: x.employeeId, pct: x.pct, fixedC: null, isRemainder: false })),
      };
      try {
        await saveRule(c.env.DB, rule, actor);
        return c.redirect(`/app/costs/rules?edit=${rule.id}`);
      } catch (e) {
        if (e instanceof BillingError) return costsBack(c, b, `&err=${encodeURIComponent(`Split saved, but the rule was not: ${e.message}`)}`);
        throw e;
      }
    }
  }
  return costsBack(c, b);
});

app.post("/app/costs/map-payee", async (c) => {
  const b = await c.req.parseBody();
  try {
    await addStaffPayee(c.env.DB, String(b.employee ?? ""), String(b.match_text ?? "").trim(), b.match_mode === "exact" ? "exact" : b.match_mode === "word" ? "word" : "contains", (await getActor(c)) ?? "");
  } catch (e) {
    return billing409(c, e);
  }
  return costsBack(c, b);
});

app.post("/app/costs/import", async (c) => {
  const b = await c.req.parseBody();
  const file = b.file;
  if (file instanceof File) await importCsv(c.env.DB, "cost", await file.text(), (await getActor(c)) ?? "");
  return c.redirect("/app/costs?p=month&tab=unassigned");
});

// ---- Cost rules ---------------------------------------------------------------

const ruleToEditing = (r: CostRule): CostRuleEditing => ({
  id: r.id,
  name: r.name,
  priority: r.priority,
  supplierMatch: r.supplierMatch,
  descriptionMatch: r.descriptionMatch,
  glCode: r.glCode,
  mode: r.mode,
  active: r.active,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  splits: r.splits.map((s) => ({ projectId: s.projectId, employeeId: s.employeeId, pct: s.pct, fixedC: s.fixedC, isRemainder: s.isRemainder })),
});

app.get("/app/costs/rules", async (c) => {
  const db = c.env.DB;
  const [rules, targets, employees] = await Promise.all([listRules(db), billingTargetOptions(db), listEmployees(db)]);
  const staffName = new Map(employees.map((e: { id: string; name: string }) => [e.id, e.name]));
  // Staff ride in the same target list the selects render (value "staff:<id>").
  const selectTargets = [...targets, ...employees.map((e: { id: string; name: string }) => ({ id: `staff:${e.id}`, label: `Staff: ${e.name}`, clientId: "" }))];
  const targetLabel = new Map(targets.map((t) => [t.id, t.label]));
  const labelOf = (projectId: string | null, employeeId?: string | null) =>
    employeeId ? `Staff: ${staffName.get(employeeId) ?? "?"}` : projectId === null ? "Shared Overhead" : targetLabel.get(projectId) ?? "project";
  const listRows: CostRuleListRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    supplierMatch: r.supplierMatch,
    descriptionMatch: r.descriptionMatch,
    glCode: r.glCode,
    mode: r.mode,
    active: r.active,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    splits: r.splits.map((s) => ({ label: labelOf(s.projectId, s.employeeId), pct: s.pct, fixedC: s.fixedC, isRemainder: s.isRemainder })),
  }));
  const edit = c.req.query("edit") ?? null;
  let editing: CostRuleEditing | null = null;
  let editingRule: CostRule | null = null;
  if (edit === "new") {
    const supplier = c.req.query("supplier")?.trim() || null;
    const target = c.req.query("target") ?? "";
    editing = {
      id: "",
      name: supplier ? `${supplier} split` : "",
      priority: 100,
      supplierMatch: supplier,
      descriptionMatch: null,
      glCode: c.req.query("gl")?.trim() || null,
      mode: "percent",
      active: true,
      effectiveFrom: null,
      effectiveTo: null,
      splits: target
        ? [(() => {
            const t = parseSplitTarget(target, 100);
            return { projectId: t.projectId, employeeId: t.employeeId, pct: 100, fixedC: null, isRemainder: false };
          })()]
        : [],
    };
    if (supplier) {
      editingRule = {
        ...editing,
        id: "preview",
        splits: editing.splits.map((s) => ({
          targetKind: s.employeeId ? ("staff" as const) : s.projectId === null ? ("overhead" as const) : ("project" as const),
          projectId: s.projectId,
          employeeId: s.employeeId,
          pct: s.pct,
          fixedC: s.fixedC,
          isRemainder: s.isRemainder,
        })),
      };
    }
  } else if (edit) {
    const r = rules.find((x) => x.id === edit) ?? null;
    if (r) {
      editing = ruleToEditing(r);
      editingRule = r;
    }
  }
  let preview: CostRulePreviewRow[] | null = null;
  if (editingRule) {
    const rows = await rulePreview(db, editingRule, 3);
    preview = rows.map((p) => ({
      txnDate: p.line.txnDate,
      supplier: p.line.supplier,
      description: p.line.description,
      amountC: p.line.amountC,
      pieces: p.pieces.map((piece) => ({ label: piece.targetKind === "overhead" ? "Shared Overhead" : piece.targetKind === "staff" && !piece.employeeId ? "Across staff by payroll PAYE" : labelOf(piece.projectId, piece.employeeId), amountC: piece.amountC })),
    }));
  }
  return c.html(<CostRulesPage rules={listRows} editing={editing} projects={selectTargets} preview={preview} error={c.req.query("err") ?? null} />);
});

app.post("/app/costs/rule", async (c) => {
  const b = await c.req.parseBody();
  const mode = b.mode === "fixed" ? ("fixed" as const) : b.mode === "paye" ? ("paye" as const) : ("percent" as const);
  const splits: CostRule["splits"] = [];
  for (let i = 0; i < 12; i++) {
    const target = String(b[`split_target_${i}`] ?? "");
    if (!target) continue;
    const pctRaw = String(b[`split_pct_${i}`] ?? "").trim();
    const fixedRaw = String(b[`split_fixed_${i}`] ?? "").trim();
    const t = parseSplitTarget(target, 0);
    splits.push({
      targetKind: t.targetKind === "excluded" ? "overhead" : (t.targetKind as "project" | "overhead" | "staff"),
      projectId: t.projectId,
      employeeId: t.employeeId,
      pct: pctRaw === "" ? null : parseMoney(pctRaw),
      fixedC: fixedRaw === "" ? null : Math.round(parseMoney(fixedRaw) * 100),
      isRemainder: String(b.remainder ?? "") === String(i),
    });
  }
  // Percent mode with a remainder leg: give it whatever tops the others up to 100.
  if (mode === "percent") {
    const rem = splits.find((s) => s.isRemainder && s.pct === null);
    if (rem) rem.pct = Math.max(0, 100 - splits.reduce((s, x) => s + (x.pct ?? 0), 0));
  }
  const rule: CostRule = {
    id: String(b.id ?? "") || crypto.randomUUID(),
    name: String(b.name ?? "").trim(),
    priority: Number(b.priority ?? 100) || 100,
    supplierMatch: String(b.supplier_match ?? "").trim() || null,
    descriptionMatch: String(b.description_match ?? "").trim() || null,
    glCode: String(b.gl_code ?? "").trim() || null,
    mode,
    effectiveFrom: String(b.effective_from ?? "").trim() || null,
    effectiveTo: String(b.effective_to ?? "").trim() || null,
    active: b.active === "1",
    splits,
  };
  try {
    await saveRule(c.env.DB, rule, (await getActor(c)) ?? "");
  } catch (e) {
    if (e instanceof BillingError) return c.redirect(`/app/costs/rules?edit=${b.id ? String(b.id) : "new"}&err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  return c.redirect("/app/costs/rules");
});

app.post("/app/costs/rule/toggle", async (c) => {
  const b = await c.req.parseBody();
  const rules = await listRules(c.env.DB);
  const r = rules.find((x) => x.id === String(b.id));
  if (r) await saveRule(c.env.DB, { ...r, active: !r.active }, (await getActor(c)) ?? "");
  return c.redirect("/app/costs/rules");
});

app.post("/app/costs/rule/delete", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await deleteRule(c.env.DB, String(b.id), (await getActor(c)) ?? "");
  return c.redirect("/app/costs/rules");
});

// ---- Revenue lines -------------------------------------------------------------

app.get("/app/revenue", async (c) => {
  const db = c.env.DB;
  const pKey = billingPeriodKey(c.req.query("p"));
  const { months, label: periodLabel } = billingWindow(pKey);
  const [lines, clients, targets] = await Promise.all([listRevenueLinesForPeriods(db, months), listClients(db), billingTargetOptions(db)]);
  const unmappedMap = new Map<string, { contactName: string; amountC: number; lineCount: number }>();
  for (const l of lines) {
    if (!l.unmapped) continue;
    const name = l.contactName ?? "(no contact)";
    const prev = unmappedMap.get(name);
    unmappedMap.set(name, prev ? { contactName: name, amountC: prev.amountC + l.amountC, lineCount: prev.lineCount + 1 } : { contactName: name, amountC: l.amountC, lineCount: 1 });
  }
  const catGroups = new Map((await listGlCategories(db)).map((g) => [g.code, g.reportGroup]));
  const rows: RevenueLineRow[] = lines.map((l) => ({
    id: l.id,
    txnDate: l.txnDate,
    docNumber: l.docNumber,
    docType: l.docType,
    contactName: l.contactName,
    clientName: l.clientName,
    projectName: l.projectName,
    isDefaultProject: l.projectId === null,
    reportGroup: (l.glCode ? catGroups.get(l.glCode) : null) ?? "Unmapped",
    amountC: l.amountC,
    source: l.source,
  }));
  return c.html(
    <RevenueLinesPage
      periodKey={pKey}
      periodLabel={periodLabel}
      unmapped={[...unmappedMap.values()].sort((a, b) => b.amountC - a.amountC)}
      lines={rows}
      clients={clients.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, isGeneral: x.isGeneral }))}
      projects={targets}
      totalC={rows.reduce((s, r) => s + r.amountC, 0)}
      openLine={c.req.query("open") ?? null}
    />,
  );
});

app.post("/app/revenue/accept-general", async (c) => {
  const b = await c.req.parseBody();
  const db = c.env.DB;
  const general = (await listClients(db)).find((x) => x.isGeneral);
  if (general) {
    const { results } = await db
      .prepare("SELECT DISTINCT contact_name FROM revenue_lines WHERE client_id IS NULL AND contact_name IS NOT NULL")
      .all<{ contact_name: string }>();
    const actor = (await getActor(c)) ?? "";
    for (const r of results ?? []) {
      try {
        await mapContact(db, general.id, r.contact_name, actor);
      } catch {
        // a mapping that already exists (race / case variant) is fine — skip
      }
    }
  }
  return c.redirect(`/app/revenue?p=${String(b.p ?? "month")}`);
});

app.post("/app/revenue/map-contact", async (c) => {
  const b = await c.req.parseBody();
  try {
    await mapContact(c.env.DB, String(b.client ?? ""), String(b.contact ?? "").trim(), (await getActor(c)) ?? "");
  } catch (e) {
    return billing409(c, e);
  }
  return c.redirect(`/app/revenue?p=${String(b.p ?? "month")}`);
});

app.post("/app/revenue/project-override", async (c) => {
  const b = await c.req.parseBody();
  try {
    await setRevenueProjectOverride(c.env.DB, String(b.id ?? ""), String(b.project ?? "") || null, (await getActor(c)) ?? "");
  } catch (e) {
    return billing409(c, e);
  }
  return c.redirect(`/app/revenue?p=${String(b.p ?? "month")}`);
});

app.post("/app/revenue/import", async (c) => {
  const b = await c.req.parseBody();
  const file = b.file;
  if (file instanceof File) await importCsv(c.env.DB, "revenue", await file.text(), (await getActor(c)) ?? "");
  return c.redirect("/app/revenue?p=month");
});

const DAILY_REPEATING_CRON = "30 3 * * *"; // must match wrangler.jsonc

app.notFound((c) => c.html(<Landing />, 404));

export default {
  fetch: app.fetch,
  // Monthly cron: full Xero sync. Daily cron: repeating schedules plus sales
  // invoices and their payments (no bills / bank feed), so
  // changes to recurring invoices in Xero reach the forecast within a day.
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    if (event.cron === DAILY_REPEATING_CRON) {
      ctx.waitUntil(
        runRepeatingSync(env).catch(async (e) => {
          await setMeta(env.DB, "xero_repeating_error", `Daily refresh failed: ${e instanceof Error ? e.message : "unknown"}`);
        }),
      );
      return;
    }
    ctx.waitUntil(
      runXeroSync(env).catch(async (e) => {
        await setMeta(env.DB, "xero_last_sync_result", `Scheduled sync failed: ${e instanceof Error ? e.message : "unknown"}`);
      }),
    );
  },
};
