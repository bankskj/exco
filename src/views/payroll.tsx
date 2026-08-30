import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { Employee, PayrollEntry } from "../data/payroll";
import { formatZAR } from "../lib/money";
import { label, shortLabel, maxPeriod } from "../lib/period";
import { lineChart, hBars } from "../lib/charts";

export type PayrollReport = {
  periods: string[];
  matrix: Map<string, Map<string, number>>; // empId -> period -> amount
  monthlyTotal: Map<string, number>;
  latest: string | null;
  latestTotal: number;
  prevTotal: number;
  headcountPaid: number;
  perMentorLatest: { label: string; value: number }[];
  ytdTotal: number;
};

export function buildPayrollReport(employees: Employee[], entries: PayrollEntry[]): PayrollReport {
  const periodsSet = new Set<string>();
  const matrix = new Map<string, Map<string, number>>();
  for (const e of entries) {
    periodsSet.add(e.period);
    if (!matrix.has(e.employee_id)) matrix.set(e.employee_id, new Map());
    matrix.get(e.employee_id)!.set(e.period, e.amount);
  }
  const periods = [...periodsSet].sort();
  const monthlyTotal = new Map<string, number>();
  for (const p of periods) monthlyTotal.set(p, 0);
  for (const e of entries) monthlyTotal.set(e.period, (monthlyTotal.get(e.period) ?? 0) + e.amount);

  const latest = maxPeriod(periods);
  const latestIdx = latest ? periods.indexOf(latest) : -1;
  const prev = latestIdx > 0 ? periods[latestIdx - 1] : null;
  const latestTotal = latest ? monthlyTotal.get(latest) ?? 0 : 0;
  const prevTotal = prev ? monthlyTotal.get(prev) ?? 0 : 0;

  const mentorMap = new Map<string, number>();
  let headcountPaid = 0;
  const empById = new Map(employees.map((e) => [e.id, e]));
  if (latest) {
    for (const [empId, byPeriod] of matrix) {
      const amt = byPeriod.get(latest) ?? 0;
      if (amt > 0) {
        headcountPaid++;
        const mentor = empById.get(empId)?.mentor || "Unassigned";
        mentorMap.set(mentor, (mentorMap.get(mentor) ?? 0) + amt);
      }
    }
  }
  const perMentorLatest = [...mentorMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const ytdTotal = [...monthlyTotal.values()].reduce((a, b) => a + b, 0);

  return { periods, matrix, monthlyTotal, latest, latestTotal, prevTotal, headcountPaid, perMentorLatest, ytdTotal };
}

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class="k-value">{value}</div>
    {sub ? <div class={`k-sub ${tone ?? ""}`}>{sub}</div> : null}
  </div>
);

const SubNav: FC<{ active: "report" | "capture" }> = ({ active }) => (
  <div class="segmented" style="margin:14px 0 4px">
    <a href="/app/payroll" class={active === "report" ? "seg active" : "seg"}>Report</a>
    <a href="/app/payroll/capture" class={active === "capture" ? "seg active" : "seg"}>Capture</a>
  </div>
);

/** Report view — read-only KPIs and charts. */
export const PayrollReportPage: FC<{ employees: Employee[]; report: PayrollReport }> = ({ employees, report }) => {
  const trend = report.periods.map((p) => ({ label: shortLabel(p), value: report.monthlyTotal.get(p) ?? 0 }));
  const mom = report.latestTotal - report.prevTotal;
  const momPct = report.prevTotal ? (mom / report.prevTotal) * 100 : 0;
  const active = employees.filter((e) => e.status === "active").length;

  return (
    <Layout title="Payroll" authed section="payroll" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Payroll</h1>
            <p class="muted" style="margin-top:0">Reporting overview. Use <strong>Capture</strong> to add or edit pay.</p>
          </div>
          <div class="row">
            <a class="btn btn-sm" href="/app/payroll/export.csv">⬇ Export CSV</a>
            <a class="btn btn-sm btn-primary" href="/app/payroll/capture">Capture pay</a>
          </div>
        </div>

        <SubNav active="report" />

        <div class="kpis section-block">
          <Kpi label={`Payroll — ${report.latest ? label(report.latest) : "—"}`} value={formatZAR(report.latestTotal)}
            sub={report.prevTotal ? `${mom >= 0 ? "▲" : "▼"} ${formatZAR(Math.abs(mom))} (${momPct.toFixed(1)}%) vs prev` : "latest recorded month"}
            tone={mom > 0 ? "neg" : "pos"} />
          <Kpi label="People paid (latest)" value={String(report.headcountPaid)} sub={`${active} active employees`} />
          <Kpi label="Avg pay (latest)" value={formatZAR(report.headcountPaid ? report.latestTotal / report.headcountPaid : 0)} />
          <Kpi label="Total captured" value={formatZAR(report.ytdTotal)} sub={`${report.periods.length} months of data`} />
        </div>

        <div class="grid section-block" style="grid-template-columns: 1.6fr 1fr; gap:18px">
          <div class="card">
            <h3>Monthly payroll cost</h3>
            <div dangerouslySetInnerHTML={{ __html: lineChart(trend, { color: "#4f8cff" }) }} />
          </div>
          <div class="card">
            <h3>Cost by mentor — {report.latest ? label(report.latest) : "—"}</h3>
            {report.perMentorLatest.length ? (
              <div dangerouslySetInnerHTML={{ __html: hBars(report.perMentorLatest, { color: "#6ee7b7" }) }} />
            ) : (
              <p class="muted">No data for the latest month.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

/** Capture view — editable grid + employee management, with a month-range control. */
export const PayrollCapturePage: FC<{
  employees: Employee[];
  report: PayrollReport;
  gridPeriods: string[];
  from: string;
  months: number;
  saved?: boolean;
}> = ({ employees, report, gridPeriods, from, months, saved }) => {
  const colTotal = (p: string) => employees.reduce((sum, e) => sum + (report.matrix.get(e.id)?.get(p) ?? 0), 0);
  return (
    <Layout title="Payroll · Capture" authed section="payroll" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Payroll · Capture</h1>
            <p class="muted" style="margin-top:0">Edit any cell, then Save. Blank means not paid that month.</p>
          </div>
          <a class="btn btn-sm" href="/app/payroll">← Back to report</a>
        </div>

        <SubNav active="capture" />

        {saved ? <div class="callout section-block">✓ Changes saved.</div> : null}

        <form method="get" action="/app/payroll/capture" class="toolbar">
          <label style="margin:0">From</label>
          <input type="text" name="from" value={from} placeholder="YYYY-MM" style="width:120px" />
          <label style="margin:0 0 0 8px">Show</label>
          <input type="number" name="months" value={String(months)} min="1" max="24" style="width:80px" />
          <span class="muted">months</span>
          <button class="btn btn-sm" type="submit">Apply</button>
        </form>

        <form method="post" action="/app/payroll/save">
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Mentor</th>
                  {gridPeriods.map((p) => <th>{shortLabel(p)}</th>)}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr>
                    <td>{e.name}{e.status === "inactive" ? <span class="muted"> · inactive</span> : null}</td>
                    <td class="muted">{e.mentor || "—"}</td>
                    {gridPeriods.map((p) => {
                      const v = report.matrix.get(e.id)?.get(p);
                      return (
                        <td>
                          <input type="text" inputmode="decimal" name={`c_${e.id}_${p}`}
                            value={v != null ? String(v) : ""} autocomplete="off" />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr class="total">
                  <td>Total</td>
                  <td></td>
                  {gridPeriods.map((p) => <td class="num">{formatZAR(colTotal(p))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <div class="toolbar">
            <button class="btn btn-primary" type="submit">Save changes</button>
            <a class="btn btn-sm" href="/app/payroll/capture">Reset view</a>
          </div>
        </form>

        <EmployeeManager employees={employees} />
      </div>
    </Layout>
  );
};

const EmployeeManager: FC<{ employees: Employee[] }> = ({ employees }) => (
  <div class="section-block card">
    <h3>Employees</h3>
    <form method="post" action="/app/payroll/employee" class="formgrid" style="margin-bottom:18px">
      <div><label>Name</label><input type="text" name="name" required /></div>
      <div><label>Mentor / Director</label><input type="text" name="mentor" /></div>
      <div><label>CTC (monthly)</label><input type="text" inputmode="decimal" name="ctc" /></div>
      <div><label>Status</label>
        <select name="status"><option value="active">active</option><option value="inactive">inactive</option></select>
      </div>
      <div><button class="btn btn-primary" type="submit">Add employee</button></div>
    </form>
    <div class="tablewrap">
      <table class="grid">
        <thead><tr><th>Name</th><th>Mentor</th><th>CTC</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {employees.map((e) => (
            <tr>
              <td>{e.name}</td>
              <td class="muted">{e.mentor || "—"}</td>
              <td class="num">{e.ctc != null ? formatZAR(e.ctc) : "—"}</td>
              <td>{e.status}</td>
              <td>
                <form method="post" action="/app/payroll/employee/delete" style="margin:0"
                  onsubmit="return confirm('Delete this employee and all their pay records?')">
                  <input type="hidden" name="id" value={e.id} />
                  <button class="btn btn-sm btn-danger" type="submit">Delete</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
