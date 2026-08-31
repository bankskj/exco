import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Bindings } from "./types";
import { checkPassword, startSession, endSession, isAuthed, requireAuth } from "./auth";
import { Landing, Login, Dashboard } from "./views/pages";
import { HrDashboard, HrEmployeePage, tenure } from "./views/hr";
import {
  listHrEmployees,
  getHrEmployee,
  createHrEmployee,
  updateHrEmployee,
  listNotes,
  createNote,
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
import { MonthlyExpensesPage, type MonthSummary, type VendorGroup, type ManualItem } from "./views/monthly_expenses";
import { IncomePage, type ExpenseBucket } from "./views/income";
import { CashflowDerivedPage } from "./views/cashflow_derived";
import { buildDerivedCashflow } from "./lib/cashflow_engine";
import { authUrl, exchangeCode, persistTokens, ensureAccessToken, fetchConnections, fetchRepeatingBills, fetchVendorBillSummary, vendorToBill, fetchProfitAndLoss, type PnL, type PnLRow } from "./lib/xero";
import { getAllMeta } from "./data/db";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { PayrollReportPage, PayrollCapturePage, buildPayrollReport } from "./views/payroll";
import { CashflowDashboard } from "./views/cashflow";
import { ForecastGridPage, type EntryMap } from "./views/cashflow_edit";
import {
  listEmployees,
  listPayrollEntries,
  upsertPayrollField,
  pruneEmptyEntries,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  setEmployeeType,
  fillPayeFromDefaults,
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
  listCfActuals,
  type CfActual,
} from "./data/cashflow";
import { getMeta, setMeta } from "./data/db";
import { computeForecast, type CFEntry } from "./lib/forecast";
import { parseMoney, formatZAR } from "./lib/money";
import { isPeriod, label, seq, fiscalYearOf, fyLabel, formatDMY, parseDateInput } from "./lib/period";

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
    await startSession(c);
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

app.get("/app", (c) => c.html(<Dashboard />));

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
  // Default window: the full planning year starting at the first month of data.
  const defaultFrom = report.periods[0] ?? "2026-01";
  const fromRaw = c.req.query("from");
  const from = fromRaw && isPeriod(fromRaw) ? fromRaw : defaultFrom;
  const monthsRaw = Number(c.req.query("months"));
  const months = Number.isFinite(monthsRaw) ? Math.max(1, Math.min(24, Math.trunc(monthsRaw))) : 14;
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

  let changed = false;
  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith(prefix) || typeof raw !== "string") continue;
    const rest = key.slice(2);
    const idx = rest.lastIndexOf("_");
    const employeeId = rest.slice(0, idx);
    const period = rest.slice(idx + 1);
    if (!isPeriod(period)) continue;
    const trimmed = raw.trim();
    const newVal = trimmed === "" ? null : parseMoney(trimmed);
    const oldVal = cur.get(`${employeeId}|${period}`) ?? 0;
    if ((newVal ?? 0) === oldVal) continue;
    if (newVal != null && Math.abs(newVal - oldVal) < 0.005) continue;
    await upsertPayrollField(c.env.DB, employeeId, period, field, newVal);
    changed = true;
  }
  if (changed) await pruneEmptyEntries(c.env.DB);
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
    const changed =
      trimmedName !== e.name || type !== e.type || mentor !== (e.mentor ?? null) ||
      (ctc ?? null) !== (e.ctc ?? null) || paye_default !== e.paye_default || status !== e.status;
    if (changed) {
      await updateEmployee(c.env.DB, e.id, { name: trimmedName, mentor, ctc, paye_default, type, status });
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
      await updateEmployee(c.env.DB, existing.id, { name, mentor, ctc, paye_default, type, status });
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

const OVERRIDE_GRP = "__override__";
const OVERRIDE_NAMES = ["Income", "People", "Other expenses"];

async function loadDerived(env: Bindings, basis: "cash" | "accrual" = "cash") {
  const [settings, actuals, payrollEntries, allExpenses, categories, entries, synced] = await Promise.all([
    getSettings(env.DB),
    listCfActuals(env.DB),
    listPayrollEntries(env.DB),
    listExpenses(env.DB),
    listCategories(env.DB),
    listEntries(env.DB),
    getMeta(env.DB, "cf_actuals_synced"),
  ]);
  // Total payroll gross by month — the grid covers salaried staff AND the
  // contractors/freelancers who appear in Xero as Developer/Contractor bills.
  const payrollByMonth = new Map<string, number>();
  for (const pe of payrollEntries) {
    payrollByMonth.set(pe.period, (payrollByMonth.get(pe.period) ?? 0) + pe.gross);
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
  const actualsForBasis = basis === "cash"
    ? actuals
    : new Map([...actuals.entries()].map(([m, a]) => [m, { ...a, income: a.income_accr, staff: a.staff_accr, dev: a.dev_accr, other: a.other_accr }]));
  const cf = buildDerivedCashflow(actualsForBasis, payrollByMonth, manualMonthly, settings, overrides, adjRows, basis === "cash" ? sarsByMonth : new Map());
  // Collections gap: invoiced (accrual) vs received (cash) per complete month.
  const collections = cf.months
    .filter((m) => m <= settings.actuals_through)
    .map((m) => {
      const a = actuals.get(m);
      const invoiced = a?.income_accr ?? 0;
      const received = a?.income ?? 0;
      return { month: m, invoiced, received, gap: invoiced - received };
    })
    .filter((r) => r.invoiced !== 0 || r.received !== 0);
  const syncNote = actuals.size === 0
    ? (synced ? "P&L actuals are empty — run a Xero sync on the Expenses tab." : "No P&L actuals yet — reconnect Xero (report scope) and run a sync on the Expenses tab to populate the model.")
    : undefined;
  return { settings, cf, syncNote, overrideCats, adjCats, entries, collections };
}

app.get("/app/accounts", async (c) => {
  const basis = c.req.query("basis") === "accrual" ? "accrual" as const : "cash" as const;
  const { settings, cf, syncNote, collections } = await loadDerived(c.env, basis);
  const fyRaw = c.req.query("fy");
  let [fys, fy] = parseFy(cf.months, fyRaw);
  // Default to the current fiscal year on first load; ?fy=all shows everything.
  if (fy == null && fyRaw !== "all") {
    const curFy = fiscalYearOf(new Date().toISOString().slice(0, 7));
    if (fys.includes(curFy)) fy = curFy;
  }
  return c.html(<CashflowDerivedPage cf={cf} settings={settings} fy={fy} fys={fys} basis={basis} collections={collections} syncNote={syncNote} saved={c.req.query("saved") === "1"} />);
});

app.get("/app/accounts/edit", async (c) => {
  // Ensure the three override rows exist (idempotent).
  const existing = await listCategories(c.env.DB);
  for (const name of OVERRIDE_NAMES) {
    if (!existing.some((cat) => cat.grp === OVERRIDE_GRP && cat.name === name)) {
      await createCategory(c.env.DB, { name, kind: name === "Income" ? "income" : "cost", grp: OVERRIDE_GRP });
    }
  }
  const { settings, cf, overrideCats, adjCats, entries } = await loadDerived(c.env);
  const map: EntryMap = new Map();
  for (const e of entries) {
    if (!map.has(e.category_id)) map.set(e.category_id, new Map());
    map.get(e.category_id)!.set(e.period, { amount: e.amount, status: "forecast" });
  }
  return c.html(<ForecastGridPage cf={cf} overrideCats={overrideCats} adjCats={adjCats} entries={map} boundary={settings.actuals_through} saved={c.req.query("saved") === "1"} />);
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
  return c.redirect("/app/accounts/edit?saved=1");
});

app.post("/app/accounts/actuals-through", async (c) => {
  const b = await c.req.parseBody();
  const p = String(b.actuals_through ?? "");
  if (isPeriod(p)) {
    await setMeta(c.env.DB, "cf_actuals_through", p);
    // Keep stored entry statuses consistent with the new boundary.
    await c.env.DB.prepare("UPDATE cf_entries SET status = CASE WHEN period <= ? THEN 'actual' ELSE 'forecast' END").bind(p).run();
  }
  const fyParam = /^\d{4}$/.test(String(b.fy ?? "")) ? `?fy=${b.fy}` : "";
  return c.redirect(`/app/accounts${fyParam}`);
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
  return c.redirect("/app/accounts/edit");
});

app.post("/app/accounts/category/delete", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  if (id) await deleteCategory(c.env.DB, id);
  return c.redirect("/app/accounts/edit");
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
  return c.redirect("/app/accounts?saved=1");
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
  return c.html(<HrEmployeePage emp={emp} notes={notes} docs={docs} now={new Date()} saved={c.req.query("saved") === "1"} />);
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
  // Attachments → R2 + documents registry.
  const raw = body.files;
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) continue;
    const safe = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const key = `hr/${id}/${noteId}/${crypto.randomUUID()}-${safe}`;
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

app.get("/app/expenses", async (c) => {
  const [expenses, xero] = await Promise.all([listExpenses(c.env.DB), xeroState(c)]);
  const msg = c.req.query("msg") ? decodeURIComponent(String(c.req.query("msg"))) : undefined;
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
  return c.html(<ExpensesPage expenses={expenses} xero={xero} page={page} sort={sort} dir={dir} openId={openId} openBills={openBills} patterns={patterns} msg={msg} />);
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
  return c.redirect("/app/expenses");
});

function expenseListQs(b: Record<string, unknown>): string {
  const q = new URLSearchParams();
  if (/^\d+$/.test(String(b.page))) q.set("page", String(b.page));
  if (["name", "amount", "monthly"].includes(String(b.sort))) q.set("sort", String(b.sort));
  if (["asc", "desc"].includes(String(b.dir))) q.set("dir", String(b.dir));
  return q.toString();
}

app.post("/app/expenses/frequency", async (c) => {
  const b = await c.req.parseBody();
  const id = String(b.id ?? "");
  const freq = FREQUENCIES.find((f) => f.key === String(b.frequency));
  if (id && freq) await setExpenseFrequency(c.env.DB, id, freq.key, freq.months);
  return c.redirect(`/app/expenses?${expenseListQs(b)}`);
});

app.post("/app/expenses/toggle", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await toggleExpense(c.env.DB, String(b.id));
  return c.redirect(`/app/expenses?${expenseListQs(b)}`);
});

app.post("/app/expenses/delete", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await deleteExpense(c.env.DB, String(b.id));
  return c.redirect(`/app/expenses?${expenseListQs(b)}`);
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
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET) return c.redirect("/app/expenses");
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
  if (err) return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Xero: ${err}`)}`);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const expected = await getSignedCookie(c, c.env.SESSION_SECRET, "xero_state");
  if (!code || !state || !expected || state !== expected) {
    return c.redirect(`/app/expenses?msg=${encodeURIComponent("Xero connection failed (state mismatch) — try again.")}`);
  }
  try {
    const tokens = await exchangeCode(c.env.XERO_CLIENT_ID!.trim(), c.env.XERO_CLIENT_SECRET!.trim(), code, redirectUri(c));
    await persistTokens(c.env.DB, tokens);
    const conns = await fetchConnections(tokens.access_token);
    if (conns.length === 0) throw new Error("no organisations authorised");
    await setMeta(c.env.DB, "xero_tenant_id", conns[0].tenantId);
    await setMeta(c.env.DB, "xero_org_name", conns[0].tenantName);
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Connected to ${conns[0].tenantName}. Click Sync to pull repeating bills.`)}`);
  } catch (e) {
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Xero connection failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
});

app.post("/app/xero/disconnect", async (c) => {
  for (const k of ["xero_refresh_token", "xero_access_token", "xero_access_expires", "xero_tenant_id", "xero_org_name"]) {
    await c.env.DB.prepare("DELETE FROM app_meta WHERE key = ?").bind(k).run();
  }
  return c.redirect(`/app/expenses?msg=${encodeURIComponent("Xero disconnected.")}`);
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

/** Full Xero sync: repeating bills + rule-driven vendor detection. Used by the button and the monthly cron. */
async function runXeroSync(env: Bindings): Promise<string> {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) throw new Error("Xero credentials not set");
  const token = await ensureAccessToken(env.DB, env.XERO_CLIENT_ID.trim(), env.XERO_CLIENT_SECRET.trim());
  if (!token) throw new Error("Not connected to Xero yet");
  const tenantId = await getMeta(env.DB, "xero_tenant_id");
  if (!tenantId) throw new Error("No Xero organisation selected — reconnect");

  const [repeating, summary, rules, names] = await Promise.all([
    fetchRepeatingBills(token, tenantId),
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
      const reason = autoExcludeReason(v.name, names);
      if (reason) {
        await setVendorRule(env.DB, v.key, v.name, "exclude", reason);
        rule = { vendor_key: v.key, name: v.name, rule: "exclude", reason };
      }
    }
    if (rule?.rule === "exclude") {
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
    const [cashCur, cashPrior, accrCur, accrPrior] = await Promise.all([
      fetchProfitAndLoss(token, tenantId, lastDayISO(nowMonth), curCount, true),
      fetchProfitAndLoss(token, tenantId, lastDayISO(`${fy - 1}-02`), 12, true).catch(() => null),
      fetchProfitAndLoss(token, tenantId, lastDayISO(nowMonth), curCount, false),
      fetchProfitAndLoss(token, tenantId, lastDayISO(`${fy - 1}-02`), 12, false).catch(() => null),
    ]);
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
  await setMeta(env.DB, "xero_last_sync", new Date().toISOString());
  const msg = `Xero sync done: ${repeating.length} repeating bill(s), ${bills.length - repeating.length} recurring vendor(s) tracked, ${excluded} excluded — ${ins} new, ${upd} updated, ${pruned} stale removed.`;
  await setMeta(env.DB, "xero_last_sync_result", msg);
  return msg;
}

app.post("/app/expenses/sync", async (c) => {
  try {
    const msg = await runXeroSync(c.env);
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Xero sync failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
});

// ----- Income dashboard (Xero P&L) -----

const STAFF_RE = /salar|wage|payroll|staff|bonus|\buif\b|\bpaye\b|\bsdl\b|medical aid|pension|leave pay/i;
const DEV_RE = /developer|contractor|freelanc|consult/i;

function monthsBetweenIncl(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
}

function lastDayISO(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

app.get("/app/accounts/income", async (c) => {
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

  // Bucket expense accounts: staff / dev & freelancers / everything else.
  const zeros = pnl.months.map(() => 0);
  const buckets: ExpenseBucket[] = [
    { key: "staff", title: "Staff", rows: [], total: [...zeros] },
    { key: "dev", title: "Dev / freelancers", rows: [], total: [...zeros] },
    { key: "other", title: "Everything else", rows: [], total: [...zeros] },
  ];
  const allExpenseRows: PnLRow[] = [...pnl.cosRows, ...pnl.opexRows];
  for (const r of allExpenseRows) {
    const b = STAFF_RE.test(r.name) ? buckets[0] : DEV_RE.test(r.name) ? buckets[1] : buckets[2];
    b.rows.push(r);
    r.values.forEach((v, i) => (b.total[i] += v));
  }
  return c.html(<IncomePage fy={fy} fys={fys} pnl={pnl} prior={prior} buckets={buckets} error={error} />);
});

// ----- Monthly expense log -----

app.get("/app/expenses/monthly", async (c) => {
  const [bills, rules, names, allExpenses] = await Promise.all([
    listAllVendorBills(c.env.DB),
    listVendorRules(c.env.DB),
    staffFirstNames(c.env.DB),
    listExpenses(c.env.DB),
  ]);
  // Manually captured recurring expenses have no Xero bills — add their
  // monthly-equivalent charge to every month so the log is the whole business.
  const manualItems: ManualItem[] = allExpenses
    .filter((e) => e.source === "manual" && e.active)
    .map((e) => ({ name: e.name, amount: monthlyEquivalent(e), frequency: e.frequency }));
  const manualMonthly = manualItems.reduce((s, i) => s + i.amount, 0);
  // Staff/developer filter: rule-based payroll & contractor exclusions plus a
  // live name match. Manual "exclude" rules (non-recurring vendors) stay in
  // the log — they're still real expenses that month.
  const isStaffVendor = (key: string, name: string): boolean => {
    const rule = rules.get(key);
    if (rule?.rule === "exclude" && (rule.reason === "payroll match" || rule.reason === "contractor prefix")) return true;
    return autoExcludeReason(name || rule?.name || "", names) != null;
  };
  const excludedKeys = new Set<string>();
  const byMonth = new Map<string, { total: number; billCount: number; vendors: Set<string> }>();
  const kept: typeof bills = [];
  const nowMonth = new Date().toISOString().slice(0, 7);
  for (const b of bills) {
    const bm = b.bill_date.slice(0, 7);
    if (bm > nowMonth || bm < "2020-01") continue; // mis-captured dates in Xero
    const name = b.vendor_name || rules.get(b.vendor_key)?.name || "";
    if (isStaffVendor(b.vendor_key, name)) {
      excludedKeys.add(b.vendor_key);
      continue;
    }
    kept.push(b);
    const month = b.bill_date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { total: 0, billCount: 0, vendors: new Set() });
    const m = byMonth.get(month)!;
    m.total += b.amount;
    m.billCount++;
    m.vendors.add(b.vendor_key);
  }
  const months: MonthSummary[] = [...byMonth.entries()]
    .map(([month, m]) => ({
      month,
      billTotal: m.total,
      manualTotal: manualMonthly,
      total: m.total + manualMonthly,
      billCount: m.billCount,
      vendorCount: m.vendors.size,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const mRaw = c.req.query("m");
  const selected = mRaw && isPeriod(mRaw) && byMonth.has(mRaw) ? mRaw : null;
  let groups: VendorGroup[] = [];
  if (selected) {
    const byVendor = new Map<string, VendorGroup>();
    for (const b of kept) {
      if (b.bill_date.slice(0, 7) !== selected) continue;
      if (!byVendor.has(b.vendor_key)) {
        byVendor.set(b.vendor_key, { key: b.vendor_key, name: b.vendor_name || rules.get(b.vendor_key)?.name || "Unknown vendor", total: 0, bills: [] });
      }
      const g = byVendor.get(b.vendor_key)!;
      g.total += b.amount;
      g.bills.push(b);
    }
    groups = [...byVendor.values()].sort((a, b) => b.total - a.total);
    for (const g of groups) g.bills.sort((a, b) => (a.bill_date < b.bill_date ? 1 : -1));
  }
  const currentMonth = new Date().toISOString().slice(0, 7);
  return c.html(
    <MonthlyExpensesPage months={months} selected={selected} groups={groups} manualItems={selected ? manualItems : []} excludedCount={excludedKeys.size} currentMonth={currentMonth} />,
  );
});

// ----- Vendor review -----

app.get("/app/expenses/vendors", async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET) return c.redirect("/app/expenses");
  try {
    const token = await ensureAccessToken(c.env.DB, c.env.XERO_CLIENT_ID.trim(), c.env.XERO_CLIENT_SECRET.trim());
    if (!token) return c.redirect(`/app/expenses?msg=${encodeURIComponent("Connect Xero first.")}`);
    const tenantId = await getMeta(c.env.DB, "xero_tenant_id");
    if (!tenantId) return c.redirect(`/app/expenses?msg=${encodeURIComponent("No Xero organisation — reconnect.")}`);
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
  return c.redirect("/app/expenses/vendors");
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

app.notFound((c) => c.html(<Landing />, 404));

export default {
  fetch: app.fetch,
  // Monthly cron: refresh the Xero connection and recurring-expense detection.
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      runXeroSync(env).catch(async (e) => {
        await setMeta(env.DB, "xero_last_sync_result", `Scheduled sync failed: ${e instanceof Error ? e.message : "unknown"}`);
      }),
    );
  },
};
