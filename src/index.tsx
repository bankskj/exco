import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./types";
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
import { listExpenses, createExpense, toggleExpense, deleteExpense, upsertXeroExpenses, monthlyEquivalent, FREQUENCIES } from "./data/expenses";
import { authUrl, exchangeCode, persistTokens, ensureAccessToken, fetchConnections, fetchRepeatingBills } from "./lib/xero";
import { getAllMeta } from "./data/db";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { PayrollReportPage, PayrollCapturePage, buildPayrollReport } from "./views/payroll";
import { CashflowDashboard } from "./views/cashflow";
import { CashflowEditor, type EntryMap } from "./views/cashflow_edit";
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
} from "./data/cashflow";
import { getMeta, setMeta } from "./data/db";
import { computeForecast, type CFEntry } from "./lib/forecast";
import { parseMoney, formatZAR } from "./lib/money";
import { isPeriod, label, seq, fiscalYearOf, fyLabel, formatDMY } from "./lib/period";

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

// Temporary Xero OAuth diagnostic (no secret values exposed).
app.get("/xero/diag", (c) => {
  const id = c.env.XERO_CLIENT_ID ?? "";
  const secret = c.env.XERO_CLIENT_SECRET ?? "";
  return c.json({
    redirect_uri_sent: redirectUri(c),
    request_url_scheme: new URL(c.req.url).protocol,
    client_id: {
      set: id.length > 0,
      length: id.length,
      trimmed_length: id.trim().length,
      has_whitespace: id !== id.trim(),
      prefix: id.trim().slice(0, 2),
      suffix: id.trim().slice(-2),
    },
    client_secret: { set: secret.length > 0, length: secret.length, has_whitespace: secret !== secret.trim() },
  });
});

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

app.get("/app/accounts", async (c) => {
  const { categories, settings, forecast } = await loadCashflow(c.env.DB);
  const [fys, fy] = parseFy(forecast.timeline, c.req.query("fy"));
  return c.html(<CashflowDashboard forecast={forecast} categories={categories} settings={settings} fys={fys} fy={fy} saved={c.req.query("saved") === "1"} />);
});

app.get("/app/accounts/edit", async (c) => {
  const { categories, entries, settings, actualsThrough, forecast } = await loadCashflow(c.env.DB);
  const [fys, fy] = parseFy(forecast.timeline, c.req.query("fy"));
  const map: EntryMap = new Map();
  for (const e of entries) {
    if (!map.has(e.category_id)) map.set(e.category_id, new Map());
    map.get(e.category_id)!.set(e.period, { amount: e.amount, status: e.period <= actualsThrough ? "actual" : "forecast" });
  }
  return c.html(<CashflowEditor categories={categories} entries={map} forecast={forecast} settings={settings} actualsThrough={actualsThrough} fys={fys} fy={fy} />);
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
  const fyParam = /^\d{4}$/.test(String(body.fy ?? "")) ? `?fy=${body.fy}` : "";
  return c.redirect(`/app/accounts/edit${fyParam}`);
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
  return c.redirect(`/app/accounts/edit${fyParam}`);
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
  return c.redirect("/app/accounts/edit");
});

app.get("/app/accounts/export.csv", async (c) => {
  const { categories, forecast } = await loadCashflow(c.env.DB);
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
      start_date: isDate(String(b.start_date)) ? String(b.start_date) : null,
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
    start_date: isDate(String(b.start_date)) ? String(b.start_date) : null,
    end_date: isDate(String(b.end_date)) ? String(b.end_date) : null,
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
    note_date: isDate(String(body.note_date)) ? String(body.note_date) : null,
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
  return c.html(<ExpensesPage expenses={expenses} xero={xero} msg={msg} />);
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
      next_date: isDate(String(b.next_date)) ? String(b.next_date) : null,
      notes: String(b.notes ?? "").trim() || null,
    });
  }
  return c.redirect("/app/expenses");
});

app.post("/app/expenses/toggle", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await toggleExpense(c.env.DB, String(b.id));
  return c.redirect("/app/expenses");
});

app.post("/app/expenses/delete", async (c) => {
  const b = await c.req.parseBody();
  if (b.id) await deleteExpense(c.env.DB, String(b.id));
  return c.redirect("/app/expenses");
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

app.post("/app/expenses/sync", async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET) return c.redirect("/app/expenses");
  try {
    const token = await ensureAccessToken(c.env.DB, c.env.XERO_CLIENT_ID.trim(), c.env.XERO_CLIENT_SECRET.trim());
    if (!token) return c.redirect(`/app/expenses?msg=${encodeURIComponent("Not connected to Xero yet.")}`);
    const tenantId = await getMeta(c.env.DB, "xero_tenant_id");
    if (!tenantId) return c.redirect(`/app/expenses?msg=${encodeURIComponent("No Xero organisation selected — reconnect.")}`);
    const bills = await fetchRepeatingBills(token, tenantId);
    const [ins, upd] = await upsertXeroExpenses(c.env.DB, bills);
    await setMeta(c.env.DB, "xero_last_sync", new Date().toISOString());
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Xero sync done: ${bills.length} repeating bill(s) — ${ins} new, ${upd} updated.`)}`);
  } catch (e) {
    return c.redirect(`/app/expenses?msg=${encodeURIComponent(`Xero sync failed: ${e instanceof Error ? e.message : "unknown error"}`)}`);
  }
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

export default app;
