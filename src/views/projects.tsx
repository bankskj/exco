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

export const ProjectsPage: FC<{
  projects: XeroProject[];
  filter: "inprogress" | "closed" | "all";
  openId: string | null;
  tasks: XeroProjectTask[]; // tasks of the open project
  snapshots: ProjectSnapshot[]; // snapshots of the open project
  lastSyncLabel: string | null;
  scopeError?: string | null;
}> = ({ projects, filter, openId, tasks, snapshots, lastSyncLabel, scopeError }) => {
  const visible = projects.filter((p) =>
    filter === "all" ? true : filter === "closed" ? p.status !== "INPROGRESS" : p.status === "INPROGRESS",
  );
  const charge = (p: XeroProject) => p.task_amount + p.expense_amount;
  const profit = (p: XeroProject) => p.invoiced - charge(p);
  const tot = visible.reduce(
    (a, p) => ({ charge: a.charge + charge(p), invoiced: a.invoiced + p.invoiced }),
    { charge: 0, invoiced: 0 },
  );
  const open = openId ? projects.find((p) => p.id === openId) ?? null : null;
  const qs = (over: { f?: string; open?: string | null }) => {
    const f = over.f ?? filter;
    const o = over.open === undefined ? openId : over.open;
    return `/app/projects?f=${f}${o ? `&open=${o}` : ""}`;
  };

  // Month deltas from cumulative snapshots.
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
              been invoiced, project-to-date. Click a project to drill down.
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
              <div class="segmented">
                <a href={qs({ f: "inprogress", open: null })} class={filter === "inprogress" ? "seg active" : "seg"}>In progress</a>
                <a href={qs({ f: "closed", open: null })} class={filter === "closed" ? "seg active" : "seg"}>Closed</a>
                <a href={qs({ f: "all", open: null })} class={filter === "all" ? "seg active" : "seg"}>All</a>
              </div>
              <span class="muted" style="font-size:12px">
                Figures are project-to-date (all time) <Info text="Xero's Project Financials report can be date-ranged; the Projects API returns lifetime totals, so a project spanning financial years shows its full history here." />
              </span>
            </div>

            <div class="kpis section-block">
              <Kpi label="Charge (cost of work)" value={formatZAR(tot.charge)} sub={`${visible.length} project(s)`} />
              <Kpi label="Invoiced" value={formatZAR(tot.invoiced)} />
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
                    {visible.map((p) => {
                      const pr = profit(p);
                      const isOpen = openId === p.id;
                      return (
                        <>
                          <tr style={isOpen ? "background:rgba(79,140,255,.08)" : ""}>
                            <td style="text-align:left">
                              <a href={isOpen ? qs({ open: null }) : qs({ open: p.id })} style="font-weight:600">
                                {p.name} <span class="muted" style="font-size:10px">{isOpen ? "▲" : "▼"}</span>
                              </a>
                            </td>
                            <td>{p.status === "INPROGRESS" ? <span class="badge income">in progress</span> : <span class="badge actual">closed</span>}</td>
                            <td class="num">{formatZAR(charge(p))}</td>
                            <td class="num">{formatZAR(p.invoiced)}</td>
                            <td class={`num ${pr < 0 ? "neg" : "pos"}`}>{formatZAR(pr)}</td>
                            <td class={`num ${pr < 0 ? "neg" : ""}`}>{p.invoiced ? `${pct(pr, p.invoiced)}%` : "—"}</td>
                          </tr>
                          {isOpen && open ? (
                            <tr>
                              <td colspan={6} style="text-align:left;background:#0c0f14;padding:16px 20px">
                                <ProjectDrill p={open} tasks={tasks} deltas={deltas} />
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
                cost-collector project (e.g. Head Office) shows negative until billed. Updates on every Xero sync.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
};

const ProjectDrill: FC<{
  p: XeroProject;
  tasks: XeroProjectTask[];
  deltas: { month: string; charge: number | null; invoiced: number | null; cumCharge: number; cumInvoiced: number }[];
}> = ({ p, tasks, deltas }) => (
  <div>
    <div class="row spread" style="margin-bottom:12px">
      <strong>{p.name} — breakdown</strong>
      <span class="muted" style="font-size:12px">
        {p.minutes_logged ? `${hours(p.minutes_logged)} logged` : "no time logged"}
        {p.estimate != null && p.estimate > 0 ? ` · estimate ${formatZAR(p.estimate)}` : ""}
        {p.deposit ? ` · deposit ${formatZAR(p.deposit)}` : ""}
      </span>
    </div>

    <div class="kpis" style="margin-bottom:14px">
      <div class="kpi"><div class="k-label">Time / tasks charge</div><div class="k-value" style="font-size:18px">{formatZAR(p.task_amount)}</div></div>
      <div class="kpi"><div class="k-label">Expenses charge</div><div class="k-value" style="font-size:18px">{formatZAR(p.expense_amount)}</div><div class="k-sub muted">bills assigned to the project</div></div>
      <div class="kpi"><div class="k-label">Invoiced</div><div class="k-value" style="font-size:18px">{formatZAR(p.invoiced)}</div></div>
      <div class="kpi"><div class="k-label">Profit</div><div class={`k-value ${p.invoiced - p.task_amount - p.expense_amount < 0 ? "neg" : "pos"}`} style="font-size:18px">{formatZAR(p.invoiced - p.task_amount - p.expense_amount)}</div></div>
    </div>

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
            {tasks.map((t) => (
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
        {p.expense_amount > 0 ? (
          <p class="muted" style="font-size:12px;margin:8px 0 0">
            Plus {formatZAR(p.expense_amount)} of expenses (supplier bills and spend assigned to this project). Xero's
            API doesn't expose expense line items — open the project in Xero for that detail.
          </p>
        ) : null}
      </div>
    ) : null}

    <div>
      <strong style="font-size:13px">By month</strong>
      {deltas.length <= 1 ? (
        <p class="muted" style="font-size:12px;margin:6px 0 0">
          Monthly movement builds from sync snapshots: each sync records the project's running totals, and the
          difference between months becomes the monthly view. Check back after the next month's syncs.
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
