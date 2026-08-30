import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { type Employee, type EmployeeType, type PayrollEntry, EMPLOYEE_TYPES, TYPE_LABEL, hasPaye } from "../data/payroll";
import { formatZAR } from "../lib/money";
import { label, shortLabel, maxPeriod } from "../lib/period";
import { lineChart, hBars } from "../lib/charts";

type Triple = { gross: number; paye: number; nett: number };
const zero = (): Triple => ({ gross: 0, paye: 0, nett: 0 });
const add = (a: Triple, g: number, p: number) => {
  a.gross += g;
  a.paye += p;
  a.nett += g - p;
};

export type PayrollReport = {
  periods: string[];
  matrix: Map<string, Map<string, { gross: number; paye: number }>>;
  monthly: Map<string, Triple>;
  latest: string | null;
  latestTot: Triple;
  prevTot: Triple;
  headcountPaid: number;
  byMentor: { label: string; value: number }[];
  byType: { type: EmployeeType; tot: Triple; count: number }[];
  totalNett: number;
};

export function buildPayrollReport(employees: Employee[], entries: PayrollEntry[]): PayrollReport {
  const periodsSet = new Set<string>();
  const matrix = new Map<string, Map<string, { gross: number; paye: number }>>();
  for (const e of entries) {
    periodsSet.add(e.period);
    if (!matrix.has(e.employee_id)) matrix.set(e.employee_id, new Map());
    matrix.get(e.employee_id)!.set(e.period, { gross: e.gross, paye: e.paye });
  }
  const periods = [...periodsSet].sort();
  const monthly = new Map<string, Triple>();
  for (const p of periods) monthly.set(p, zero());
  for (const e of entries) add(monthly.get(e.period)!, e.gross, e.paye);

  const latest = maxPeriod(periods);
  const idx = latest ? periods.indexOf(latest) : -1;
  const prev = idx > 0 ? periods[idx - 1] : null;
  const latestTot = latest ? monthly.get(latest)! : zero();
  const prevTot = prev ? monthly.get(prev)! : zero();

  const empById = new Map(employees.map((e) => [e.id, e]));
  const mentorMap = new Map<string, number>();
  const typeMap = new Map<EmployeeType, { tot: Triple; count: number }>();
  for (const t of EMPLOYEE_TYPES) typeMap.set(t, { tot: zero(), count: 0 });
  let headcountPaid = 0;
  if (latest) {
    for (const [empId, byPeriod] of matrix) {
      const cell = byPeriod.get(latest);
      if (!cell || cell.gross <= 0) continue;
      headcountPaid++;
      const emp = empById.get(empId);
      const nett = cell.gross - cell.paye;
      const mentor = emp?.mentor || "Unassigned";
      mentorMap.set(mentor, (mentorMap.get(mentor) ?? 0) + nett);
      const t = (emp?.type ?? "za") as EmployeeType;
      const bucket = typeMap.get(t)!;
      add(bucket.tot, cell.gross, cell.paye);
      bucket.count++;
    }
  }
  const byMentor = [...mentorMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const byType = EMPLOYEE_TYPES.map((type) => ({ type, tot: typeMap.get(type)!.tot, count: typeMap.get(type)!.count }));
  const totalNett = [...monthly.values()].reduce((s, t) => s + t.nett, 0);

  return { periods, matrix, monthly, latest, latestTot, prevTot, headcountPaid, byMentor, byType, totalNett };
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

const TypeBadge: FC<{ type: EmployeeType }> = ({ type }) => (
  <span class={`badge type-${type}`}>{type === "za" ? "ZA" : type === "international" ? "Intl" : "Freelance"}</span>
);

/** Report view — read-only KPIs, by-type table, charts. */
export const PayrollReportPage: FC<{ employees: Employee[]; report: PayrollReport }> = ({ employees, report }) => {
  const trend = report.periods.map((p) => ({ label: shortLabel(p), value: report.monthly.get(p)!.nett }));
  const momNett = report.latestTot.nett - report.prevTot.nett;
  const active = employees.filter((e) => e.status === "active").length;

  return (
    <Layout title="Payroll" authed section="payroll" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Payroll</h1>
            <p class="muted" style="margin-top:0">Gross, PAYE and nett by month. Use <strong>Capture</strong> to add or edit.</p>
          </div>
          <div class="row">
            <a class="btn btn-sm" href="/app/payroll/export.csv">⬇ Export CSV</a>
            <a class="btn btn-sm btn-primary" href="/app/payroll/capture">Capture pay</a>
          </div>
        </div>

        <SubNav active="report" />

        <div class="kpis section-block">
          <Kpi label={`Nett — ${report.latest ? label(report.latest) : "—"}`} value={formatZAR(report.latestTot.nett)}
            sub={report.prevTot.nett ? `${momNett >= 0 ? "▲" : "▼"} ${formatZAR(Math.abs(momNett))} vs prev` : "take-home paid"}
            tone={momNett > 0 ? "neg" : "pos"} />
          <Kpi label="Gross (latest)" value={formatZAR(report.latestTot.gross)} sub={`${report.headcountPaid} paid · ${active} active`} />
          <Kpi label="PAYE (latest)" value={formatZAR(report.latestTot.paye)} sub="ZA employees only" />
          <Kpi label="Total nett captured" value={formatZAR(report.totalNett)} sub={`${report.periods.length} months`} />
        </div>

        <div class="section-block card">
          <h3>By employee type — {report.latest ? label(report.latest) : "—"}</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead><tr><th>Type</th><th>People</th><th>Gross</th><th>PAYE</th><th>Nett</th></tr></thead>
              <tbody>
                {report.byType.map((r) => (
                  <tr>
                    <td>{TYPE_LABEL[r.type]}</td>
                    <td class="num">{r.count}</td>
                    <td class="num">{formatZAR(r.tot.gross)}</td>
                    <td class="num">{formatZAR(r.tot.paye)}</td>
                    <td class="num">{formatZAR(r.tot.nett)}</td>
                  </tr>
                ))}
                <tr class="total">
                  <td>Total</td>
                  <td class="num">{report.headcountPaid}</td>
                  <td class="num">{formatZAR(report.latestTot.gross)}</td>
                  <td class="num">{formatZAR(report.latestTot.paye)}</td>
                  <td class="num">{formatZAR(report.latestTot.nett)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid section-block" style="grid-template-columns: 1.6fr 1fr; gap:18px">
          <div class="card">
            <h3>Monthly nett cost</h3>
            <div dangerouslySetInnerHTML={{ __html: lineChart(trend, { color: "#4f8cff" }) }} />
          </div>
          <div class="card">
            <h3>Nett by mentor — {report.latest ? label(report.latest) : "—"}</h3>
            {report.byMentor.length ? (
              <div dangerouslySetInnerHTML={{ __html: hBars(report.byMentor, { color: "#6ee7b7" }) }} />
            ) : (
              <p class="muted">No data for the latest month.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

type Metric = "gross" | "paye" | "nett";

/** Capture view — metric toggle (gross/PAYE/nett), month-range control, fixed-layout grid. */
export const PayrollCapturePage: FC<{
  employees: Employee[];
  report: PayrollReport;
  gridPeriods: string[];
  from: string;
  months: number;
  metric: Metric;
  saved?: boolean;
}> = ({ employees, report, gridPeriods, from, months, metric, saved }) => {
  const cellVal = (empId: string, p: string) => report.matrix.get(empId)?.get(p);
  const colTotal = (p: string) =>
    employees.reduce((sum, e) => {
      const c = cellVal(e.id, p);
      if (!c) return sum;
      return sum + (metric === "gross" ? c.gross : metric === "paye" ? c.paye : c.gross - c.paye);
    }, 0);

  const metricLink = (m: Metric) =>
    `/app/payroll/capture?metric=${m}&from=${encodeURIComponent(from)}&months=${months}`;

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

        <div class="row spread section-block">
          <div class="segmented">
            <a href={metricLink("gross")} class={metric === "gross" ? "seg active" : "seg"}>Gross</a>
            <a href={metricLink("paye")} class={metric === "paye" ? "seg active" : "seg"}>PAYE</a>
            <a href={metricLink("nett")} class={metric === "nett" ? "seg active" : "seg"}>Nett</a>
          </div>
          <form method="get" action="/app/payroll/capture" class="row" style="gap:8px">
            <input type="hidden" name="metric" value={metric} />
            <label style="margin:0">From</label>
            <input type="text" name="from" value={from} placeholder="YYYY-MM" style="width:110px" />
            <label style="margin:0 0 0 6px">Show</label>
            <input type="number" name="months" value={String(months)} min="1" max="24" style="width:70px" />
            <button class="btn btn-sm" type="submit">Apply</button>
          </form>
        </div>

        {metric === "paye" ? (
          <div class="callout section-block">Only <strong>ZA</strong> employees have PAYE. Rows for International/Freelancer are disabled.</div>
        ) : metric === "nett" ? (
          <div class="callout section-block">Nett = Gross − PAYE. This view is read-only — edit Gross or PAYE to change it.</div>
        ) : null}

        <form method="post" action="/app/payroll/save">
          <input type="hidden" name="metric" value={metric} />
          <div class="tablewrap section-block">
            <table class="grid fixed" style={`min-width:${400 + gridPeriods.length * 100}px`}>
              <colgroup>
                <col style="width:170px" />
                <col style="width:96px" />
                <col style="width:110px" />
                {gridPeriods.map(() => <col style="width:100px" />)}
              </colgroup>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Mentor</th>
                  {gridPeriods.map((p) => <th>{shortLabel(p)}</th>)}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const payeDisabled = metric === "paye" && !hasPaye(e.type);
                  return (
                    <tr>
                      <td>{e.name}{e.status === "inactive" ? <span class="muted"> · inact</span> : null}</td>
                      <td><TypeBadge type={e.type} /></td>
                      <td class="muted">{e.mentor || "—"}</td>
                      {gridPeriods.map((p) => {
                        const c = cellVal(e.id, p);
                        if (metric === "nett") {
                          const nett = c ? c.gross - c.paye : null;
                          return <td class="num">{nett != null ? formatZAR(nett) : ""}</td>;
                        }
                        if (payeDisabled) return <td class="muted" style="text-align:center">n/a</td>;
                        const v = c ? (metric === "gross" ? c.gross : c.paye) : undefined;
                        const nm = `${metric === "gross" ? "g" : "t"}_${e.id}_${p}`;
                        return (
                          <td>
                            <input type="text" inputmode="decimal" name={nm} value={v != null && v !== 0 ? String(v) : ""} autocomplete="off" />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr class="total">
                  <td>Total {metric}</td>
                  <td></td>
                  <td></td>
                  {gridPeriods.map((p) => <td class="num">{formatZAR(colTotal(p))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          {metric !== "nett" ? (
            <div class="toolbar">
              <button class="btn btn-primary" type="submit">Save {metric}</button>
              <span class="muted" style="font-size:12px">Saving updates only the {metric} figures shown.</span>
            </div>
          ) : null}
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
      <div><label>Type</label>
        <select name="type">{EMPLOYEE_TYPES.map((t) => <option value={t}>{TYPE_LABEL[t]}</option>)}</select>
      </div>
      <div><label>Mentor / Director</label><input type="text" name="mentor" /></div>
      <div><label>CTC (monthly)</label><input type="text" inputmode="decimal" name="ctc" /></div>
      <div><label>Status</label>
        <select name="status"><option value="active">active</option><option value="inactive">inactive</option></select>
      </div>
      <div><button class="btn btn-primary" type="submit">Add employee</button></div>
    </form>
    <div class="tablewrap">
      <table class="grid">
        <thead><tr><th>Name</th><th>Type</th><th>Mentor</th><th>CTC</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {employees.map((e) => (
            <tr>
              <td>{e.name}</td>
              <td>
                <form method="post" action="/app/payroll/employee/type" style="margin:0">
                  <input type="hidden" name="id" value={e.id} />
                  <select name="type" onchange="this.form.submit()" style="padding:4px 8px;font-size:12px;width:auto">
                    {EMPLOYEE_TYPES.map((t) => <option value={t} selected={e.type === t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </form>
              </td>
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
