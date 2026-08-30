import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./types";
import { checkPassword, startSession, endSession, isAuthed, requireAuth } from "./auth";
import { Landing, Login, Dashboard, SectionStub } from "./views/pages";
import { PayrollReportPage, PayrollCapturePage, buildPayrollReport } from "./views/payroll";
import { CashflowDashboard } from "./views/cashflow";
import { CashflowEditor, type EntryMap } from "./views/cashflow_edit";
import {
  listEmployees,
  listPayrollEntries,
  upsertPayrollEntry,
  createEmployee,
  deleteEmployee,
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
import { isPeriod, label, seq } from "./lib/period";

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
  const { employees, report } = await loadPayroll(c.env.DB);
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
  const gridPeriods = seq(from, months);
  return c.html(
    <PayrollCapturePage employees={employees} report={report} gridPeriods={gridPeriods} from={from} months={months} saved={c.req.query("saved") === "1"} />,
  );
});

app.post("/app/payroll/save", async (c) => {
  const body = await c.req.parseBody();
  const current = await listPayrollEntries(c.env.DB);
  const cur = new Map<string, number>();
  for (const e of current) cur.set(`${e.employee_id}|${e.period}`, e.amount);

  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith("c_") || typeof raw !== "string") continue;
    const rest = key.slice(2);
    const idx = rest.lastIndexOf("_");
    const employeeId = rest.slice(0, idx);
    const period = rest.slice(idx + 1);
    if (!isPeriod(period)) continue;
    const trimmed = raw.trim();
    const newVal = trimmed === "" ? null : parseMoney(trimmed);
    const oldVal = cur.get(`${employeeId}|${period}`);
    if (newVal == null && oldVal == null) continue;
    if (newVal != null && oldVal != null && Math.abs(newVal - oldVal) < 0.005) continue;
    await upsertPayrollEntry(c.env.DB, employeeId, period, newVal);
  }
  return c.redirect("/app/payroll/capture?saved=1");
});

app.post("/app/payroll/employee", async (c) => {
  const b = await c.req.parseBody();
  const name = String(b.name ?? "").trim();
  if (name) {
    await createEmployee(c.env.DB, {
      name,
      mentor: String(b.mentor ?? "").trim() || null,
      ctc: b.ctc ? parseMoney(String(b.ctc)) : null,
      status: String(b.status ?? "active"),
    });
  }
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
  const periods = report.periods;
  const head = ["Employee", "Mentor", ...periods.map(label), "Total"];
  const lines = [head.map(csv).join(",")];
  for (const e of employees) {
    const row = report.matrix.get(e.id);
    let total = 0;
    const cells = periods.map((p) => {
      const v = row?.get(p) ?? 0;
      total += v;
      return v ? v.toFixed(2) : "";
    });
    lines.push([csv(e.name), csv(e.mentor ?? ""), ...cells, total.toFixed(2)].join(","));
  }
  const totals = periods.map((p) => (report.monthlyTotal.get(p) ?? 0).toFixed(2));
  lines.push(["Total", "", ...totals, report.ytdTotal.toFixed(2)].map(csv).join(","));
  return csvResponse(c, "payroll.csv", lines.join("\n"));
});

// ---------- Accounts / Cashflow ----------

async function loadCashflow(db: D1Database) {
  const [categories, entries, settings, actualsThrough] = await Promise.all([
    listCategories(db),
    listEntries(db),
    getSettings(db),
    getMeta(db, "cf_actuals_through"),
  ]);
  const at = actualsThrough || settings.opening_period;
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
  return c.html(<CashflowDashboard forecast={forecast} categories={categories} settings={settings} saved={c.req.query("saved") === "1"} />);
});

app.get("/app/accounts/edit", async (c) => {
  const { categories, entries, settings, actualsThrough, forecast } = await loadCashflow(c.env.DB);
  const map: EntryMap = new Map();
  for (const e of entries) {
    if (!map.has(e.category_id)) map.set(e.category_id, new Map());
    map.get(e.category_id)!.set(e.period, { amount: e.amount, status: e.period <= actualsThrough ? "actual" : "forecast" });
  }
  return c.html(<CashflowEditor categories={categories} entries={map} forecast={forecast} settings={settings} actualsThrough={actualsThrough} />);
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
  return c.redirect("/app/accounts/edit");
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
    horizon_months: Math.max(1, Math.min(60, n(b.horizon_months, s.horizon_months))),
    best_income_pct: n(b.best_income_pct, s.best_income_pct),
    best_cost_pct: n(b.best_cost_pct, s.best_cost_pct),
    worst_income_pct: n(b.worst_income_pct, s.worst_income_pct),
    worst_cost_pct: n(b.worst_cost_pct, s.worst_cost_pct),
  });
  if (isPeriod(String(b.actuals_through))) await setMeta(c.env.DB, "cf_actuals_through", String(b.actuals_through));
  return c.redirect("/app/accounts/edit");
});

app.get("/app/accounts/export.csv", async (c) => {
  const { categories, forecast } = await loadCashflow(c.env.DB);
  const periods = forecast.timeline;
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

// ---------- HR (stub for now) ----------

app.get("/app/hr", (c) => c.html(<SectionStub icon="👥" title="HR" />));

// --- helpers -------------------------------------------------------------

function csv(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
