import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, StateBadge } from "./layout";
import type { XeroProject, XeroProjectTask } from "../lib/xero";
import type { ProjectSnapshot } from "../data/projects";
import { formatZAR } from "../lib/money";
import { label } from "../lib/period";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const hours = (mins: number) => `${Math.round(mins / 6) / 10}h`;
const charge = (p: XeroProject) => p.task_amount + p.expense_amount;

/** Same-named Xero projects (e.g. one "Marketing" per month) roll up into one row. */
export type ProjectGroup = {
  name: string;
  members: XeroProject[];
  inProgress: number;
  charge: number;
  invoiced: number;
  minutes: number;
};

export type ProjectPeriodKey = "month" | "lastmonth" | "quarter" | "fy" | "all";

const PERIOD_TABS: { key: ProjectPeriodKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This FY" },
  { key: "all", label: "All time" },
];

export const ProjectsPage: FC<{
  projects: XeroProject[];
  filter: "inprogress" | "closed" | "all";
  period: ProjectPeriodKey;
  periodValues: Map<string, { charge: number; invoiced: number }> | null; // null = all time (lifetime totals)
  periodLabel: string | null;
  baselineMissing: boolean;
  openName: string | null;
  tasks: XeroProjectTask[]; // tasks across the open group
  snapshots: ProjectSnapshot[]; // month-summed snapshots across the open group
  lastSyncLabel: string | null;
  scopeError?: string | null;
}> = ({ projects, filter, period, periodValues, periodLabel, baselineMissing, openName, tasks, snapshots, lastSyncLabel, scopeError }) => {
  const valOf = (p: XeroProject) => periodValues?.get(p.id) ?? { charge: charge(p), invoiced: p.invoiced };
  const visible = projects.filter((p) =>
    filter === "all" ? true : filter === "closed" ? p.status !== "INPROGRESS" : p.status === "INPROGRESS",
  );
  const groups = new Map<string, ProjectGroup>();
  for (const p of visible) {
    const key = p.name.trim();
    if (!groups.has(key)) groups.set(key, { name: key, members: [], inProgress: 0, charge: 0, invoiced: 0, minutes: 0 });
    const g = groups.get(key)!;
    g.members.push(p);
    if (p.status === "INPROGRESS") g.inProgress++;
    const v = valOf(p);
    g.charge += v.charge;
    g.invoiced += v.invoiced;
    g.minutes += p.minutes_logged;
  }
  const rows = [...groups.values()]
    .filter((g) => period === "all" || Math.abs(g.charge) > 0.005 || Math.abs(g.invoiced) > 0.005)
    .sort((a, b) => (a.inProgress > 0 === (b.inProgress > 0) ? a.name.localeCompare(b.name) : a.inProgress > 0 ? -1 : 1));
  const tot = rows.reduce((a, g) => ({ charge: a.charge + g.charge, invoiced: a.invoiced + g.invoiced }), { charge: 0, invoiced: 0 });
  const open = openName ? rows.find((g) => g.name === openName) ?? null : null;
  const qs = (over: { f?: string; p?: string; open?: string | null }) => {
    const f = over.f ?? filter;
    const pd = over.p ?? period;
    const o = over.open === undefined ? openName : over.open;
    return `/app/projects?f=${f}&p=${pd}${o ? `&open=${encodeURIComponent(o)}` : ""}`;
  };

  const deltas = snapshots.map((s, i) => ({
    month: s.month,
    charge: i === 0 ? null : s.charge - snapshots[i - 1].charge,
    invoiced: i === 0 ? null : s.invoiced - snapshots[i - 1].invoiced,
    cumCharge: s.charge,
    cumInvoiced: s.invoiced,
  }));

  return (
    <Layout title="Projects" authed section="projects" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Projects</h1>
            <p class="muted" style="margin-top:0">
              Straight from Xero Projects <StateBadge state="actual" />: what each project has cost/charged and what has
              been invoiced, project-to-date. Same-named projects are grouped into one line — click to drill down.
            </p>
            <AsAt lastSync={lastSyncLabel} />
          </div>
        </div>

        {scopeError ? (
          <div class="callout section-block" style="border-left-color:#f6c453">
            <strong>Projects access not granted yet.</strong> The Xero connection predates the Projects scope —
            go to <a href="/app/admin">Admin</a>, click <strong>Disconnect</strong>, then <strong>Connect Xero</strong>{" "}
            again (the consent screen will now include Projects), and run a sync. Xero said: {scopeError}
          </div>
        ) : null}

        {projects.length === 0 && !scopeError ? (
          <div class="callout section-block">No projects synced yet — run <strong>Sync from Xero</strong> (Admin or the Costs tab).</div>
        ) : null}

        {projects.length > 0 ? (
          <>
            <div class="row spread section-block" style="align-items:center">
              <div class="row" style="gap:10px">
                <div class="segmented">
                  <a href={qs({ f: "inprogress", open: null })} class={filter === "inprogress" ? "seg active" : "seg"}>In progress</a>
                  <a href={qs({ f: "closed", open: null })} class={filter === "closed" ? "seg active" : "seg"}>Closed</a>
                  <a href={qs({ f: "all", open: null })} class={filter === "all" ? "seg active" : "seg"}>All</a>
                </div>
                <div class="segmented">
                  {PERIOD_TABS.map((t) => (
                    <a href={qs({ p: t.key, open: null })} class={period === t.key ? "seg active" : "seg"}>{t.label}</a>
                  ))}
                </div>
              </div>
              <span class="muted" style="font-size:12px">
                {period === "all"
                  ? <>Figures are project-to-date (all time) <Info text="Xero's Projects API returns lifetime totals, so a project spanning financial years shows its full history here." /></>
                  : <>Movement in {periodLabel} <Info text="Period figures are the change in each project's totals over the window, computed from sync snapshots. The current month uses live totals." /></>}
              </span>
            </div>

            {period !== "all" && baselineMissing ? (
              <div class="callout section-block" style="border-left-color:#f6c453">
                Period views build from sync snapshots, and history only starts at the first recorded snapshot — until a
                snapshot exists <em>before</em> this window, earlier project history can't be separated out and the figures
                below may include it. This resolves by itself as monthly syncs accumulate.
              </div>
            ) : null}

            <div class="kpis section-block">
              <Kpi label={period === "all" ? "Charge (cost of work)" : `Charge — ${periodLabel}`} value={formatZAR(tot.charge)} sub={`${rows.length} project group(s) with activity`} />
              <Kpi label={period === "all" ? "Invoiced" : `Invoiced — ${periodLabel}`} value={formatZAR(tot.invoiced)} />
              <Kpi label="Profit" value={formatZAR(tot.invoiced - tot.charge)} tone={tot.invoiced - tot.charge < 0 ? "neg" : "pos"}
                sub={`${pct(tot.invoiced - tot.charge, tot.invoiced)}% of invoiced`} />
              <Kpi label="In progress" value={String(projects.filter((p) => p.status === "INPROGRESS").length)} sub={`${projects.length} project(s) total`} />
            </div>

            <div class="section-block">
              <div class="tablewrap">
                <table class="grid">
                  <thead>
                    <tr>
                      <th style="text-align:left">Project</th><th>Status</th><th>Charge</th><th>Invoiced</th>
                      <th>Profit</th><th>Profit %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((g) => {
                      const pr = g.invoiced - g.charge;
                      const isOpen = openName === g.name;
                      return (
                        <>
                          <tr style={isOpen ? "background:rgba(79,140,255,.08)" : ""}>
                            <td style="text-align:left">
                              <a href={isOpen ? qs({ open: null }) : qs({ open: g.name })} style="font-weight:600">
                                {g.name} <span class="muted" style="font-size:10px">{isOpen ? "▲" : "▼"}</span>
                              </a>
                              {g.members.length > 1 ? <span class="badge recurring" style="margin-left:8px">{g.members.length} projects</span> : null}
                            </td>
                            <td>
                              {g.inProgress > 0
                                ? <span class="badge income">{g.members.length > 1 ? `${g.inProgress} in progress` : "in progress"}</span>
                                : <span class="badge actual">closed</span>}
                            </td>
                            <td class="num">{formatZAR(g.charge)}</td>
                            <td class="num">{formatZAR(g.invoiced)}</td>
                            <td class={`num ${pr < 0 ? "neg" : "pos"}`}>{formatZAR(pr)}</td>
                            <td class={`num ${pr < 0 ? "neg" : ""}`}>{g.invoiced ? `${pct(pr, g.invoiced)}%` : "—"}</td>
                          </tr>
                          {isOpen && open ? (
                            <tr>
                              <td colspan={6} style="text-align:left;background:#0c0f14;padding:16px 20px">
                                <GroupDrill g={open} tasks={tasks} deltas={deltas} />
                              </td>
                            </tr>
                          ) : null}
                        </>
                      );
                    })}
                    <tr class="total">
                      <td style="text-align:left">Totals</td>
                      <td></td>
                      <td class="num">{formatZAR(tot.charge)}</td>
                      <td class="num">{formatZAR(tot.invoiced)}</td>
                      <td class={`num ${tot.invoiced - tot.charge < 0 ? "neg" : "pos"}`}>{formatZAR(tot.invoiced - tot.charge)}</td>
                      <td class="num">{pct(tot.invoiced - tot.charge, tot.invoiced)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="muted" style="font-size:12px;margin-top:8px">
                Charge = time/tasks + expenses assigned to the project in Xero; Profit = invoiced − charge, so a
                cost-collector project (e.g. Head Office) shows negative until billed. Same-named Xero projects roll up
                into one line. Updates on every Xero sync.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
};

const GroupDrill: FC<{
  g: ProjectGroup;
  tasks: XeroProjectTask[];
  deltas: { month: string; charge: number | null; invoiced: number | null; cumCharge: number; cumInvoiced: number }[];
}> = ({ g, tasks, deltas }) => {
  const taskAmount = g.members.reduce((s, p) => s + p.task_amount, 0);
  const expenseAmount = g.members.reduce((s, p) => s + p.expense_amount, 0);
  const estimate = g.members.reduce((s, p) => s + (p.estimate ?? 0), 0);
  return (
    <div>
      <div class="row spread" style="margin-bottom:12px">
        <strong>{g.name} — breakdown{g.members.length > 1 ? ` (${g.members.length} Xero projects combined)` : ""}</strong>
        <span class="muted" style="font-size:12px">
          {g.minutes ? `${hours(g.minutes)} logged` : "no time logged"}
          {estimate > 0 ? ` · estimate ${formatZAR(estimate)}` : ""}
        </span>
      </div>

      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="k-label">Time / tasks charge</div><div class="k-value" style="font-size:18px">{formatZAR(taskAmount)}</div></div>
        <div class="kpi"><div class="k-label">Expenses charge</div><div class="k-value" style="font-size:18px">{formatZAR(expenseAmount)}</div><div class="k-sub muted">bills assigned to the project</div></div>
        <div class="kpi"><div class="k-label">Invoiced</div><div class="k-value" style="font-size:18px">{formatZAR(g.invoiced)}</div></div>
        <div class="kpi"><div class="k-label">Profit</div><div class={`k-value ${g.invoiced - g.charge < 0 ? "neg" : "pos"}`} style="font-size:18px">{formatZAR(g.invoiced - g.charge)}</div></div>
      </div>

      {g.members.length > 1 ? (
        <div style="margin-bottom:14px">
          <strong style="font-size:13px">Underlying Xero projects</strong>
          <table style="border-collapse:collapse;font-size:13px;width:100%;margin-top:6px">
            <thead>
              <tr>{["Status", "Charge", "Invoiced", "Profit", "Hours"].map((h) => (
                <th style={`text-align:${h === "Status" ? "left" : "right"};padding:4px 12px 4px 0;color:var(--muted)`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {[...g.members].sort((a, b) => b.invoiced - a.invoiced).map((p) => (
                <tr>
                  <td style="padding:3px 12px 3px 0">{p.status === "INPROGRESS" ? <span class="badge income">in progress</span> : <span class="badge actual">closed</span>}</td>
                  <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(charge(p))}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(p.invoiced)}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums" class={p.invoiced - charge(p) < 0 ? "neg" : "pos"}>{formatZAR(p.invoiced - charge(p))}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums" class="muted">{p.minutes_logged ? hours(p.minutes_logged) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div style="margin-bottom:14px">
          <strong style="font-size:13px">Tasks (time items)</strong>
          <table style="border-collapse:collapse;font-size:13px;width:100%;margin-top:6px">
            <thead>
              <tr>{["Task", "Type", "Rate", "Hours", "Charge", "Invoiced"].map((h) => (
                <th style={`text-align:${h === "Task" || h === "Type" ? "left" : "right"};padding:4px 12px 4px 0;color:var(--muted)`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {tasks.slice(0, 20).map((t) => (
                <tr>
                  <td style="padding:3px 12px 3px 0">{t.name}</td>
                  <td style="padding:3px 12px 3px 0" class="muted">{t.charge_type.toLowerCase()}</td>
                  <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{t.rate ? formatZAR(t.rate) : "—"}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums">{t.minutes ? hours(t.minutes) : "—"}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(t.amount)}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums" class="muted">{formatZAR(t.amount_invoiced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length > 20 ? <p class="muted" style="font-size:12px;margin:6px 0 0">Top 20 of {tasks.length} tasks shown.</p> : null}
          {expenseAmount > 0 ? (
            <p class="muted" style="font-size:12px;margin:8px 0 0">
              Plus {formatZAR(expenseAmount)} of expenses (supplier bills and spend assigned in Xero). Xero's API doesn't
              expose expense line items — open the project in Xero for that detail.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <strong style="font-size:13px">By month{g.members.length > 1 ? " — group combined" : ""}</strong>
        {deltas.length <= 1 ? (
          <p class="muted" style="font-size:12px;margin:6px 0 0">
            Monthly movement builds from sync snapshots: each sync records the running totals, and the difference
            between months becomes the monthly view. Check back after the next month's syncs.
          </p>
        ) : (
          <table style="border-collapse:collapse;font-size:13px;min-width:520px;margin-top:6px">
            <thead>
              <tr>{["Month", "Charge added", "Invoiced added", "Cumulative charge", "Cumulative invoiced"].map((h) => (
                <th style={`text-align:${h === "Month" ? "left" : "right"};padding:4px 12px 4px 0;color:var(--muted)`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr>
                  <td style="padding:3px 12px 3px 0">{label(d.month)}{d.charge == null ? <span class="cellhint"> opening</span> : null}</td>
                  <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{d.charge == null ? "—" : formatZAR(d.charge)}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums">{d.invoiced == null ? "—" : formatZAR(d.invoiced)}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums" class="muted">{formatZAR(d.cumCharge)}</td>
                  <td style="padding:3px 0 3px 12px;text-align:right;font-variant-numeric:tabular-nums" class="muted">{formatZAR(d.cumInvoiced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
