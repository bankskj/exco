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
  ledger: boolean; // right-drawer ledger view for the open project
  tasks: XeroProjectTask[]; // tasks across the open group
  snapshots: ProjectSnapshot[]; // month-summed snapshots across the open group
  lastSyncLabel: string | null;
  scopeError?: string | null;
}> = ({ projects, filter, period, periodValues, periodLabel, baselineMissing, openName, ledger, tasks, snapshots, lastSyncLabel, scopeError }) => {
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
  const qs = (over: { f?: string; p?: string; open?: string | null; ledger?: boolean }) => {
    const f = over.f ?? filter;
    const pd = over.p ?? period;
    const o = over.open === undefined ? openName : over.open;
    const lg = over.ledger ?? false;
    return `/app/projects?f=${f}&p=${pd}${o ? `&open=${encodeURIComponent(o)}` : ""}${o && lg ? "&ledger=1" : ""}`;
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

      {open && ledger ? (
        <>
          <a href={qs({ ledger: false })} class="drawer-overlay" aria-label="Close ledger"></a>
          <aside class="drawer">
            <div class="row spread" style="align-items:flex-start">
              <h3 style="text-transform:none;font-size:17px;color:var(--text)">{open.name} — ledger</h3>
              <a href={qs({ ledger: false })} class="btn btn-sm" title="Close">✕</a>
            </div>
            <p class="muted" style="font-size:12px;margin:2px 0 14px">
              Monthly ledger built from sync snapshots{open.members.length > 1 ? `, combined across ${open.members.length} Xero projects` : ""}.
              Charge and invoiced movement per month, with the running profit.
            </p>
            {deltas.length === 0 ? (
              <p class="muted" style="font-size:13px">No snapshots recorded yet — run a Xero sync.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Month</th><th style="text-align:right">Charge +</th><th style="text-align:right">Invoiced +</th><th style="text-align:right">Running profit</th></tr>
                </thead>
                <tbody>
                  {deltas.map((d) => {
                    const run = d.cumInvoiced - d.cumCharge;
                    return (
                      <tr>
                        <td>{label(d.month)}{d.charge == null ? <span class="cellhint"> opening</span> : null}</td>
                        <td class="num">{d.charge == null ? formatZAR(d.cumCharge) : formatZAR(d.charge)}</td>
                        <td class="num">{d.invoiced == null ? formatZAR(d.cumInvoiced) : formatZAR(d.invoiced)}</td>
                        <td class={`num ${run < 0 ? "neg" : "pos"}`}>{formatZAR(run)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p class="muted" style="font-size:12px;margin-top:12px">
              The opening line carries all history up to the first snapshot; each later line is that month's movement.
              History accumulates automatically with every monthly sync.
            </p>
          </aside>
        </>
      ) : null}
    </Layout>
  );
};

const Line: FC<{ name: string; value: string; tone?: string; strong?: boolean }> = ({ name, value, tone, strong }) => (
  <div class="row spread" style={`font-size:${strong ? "15px" : "13px"};${strong ? "font-weight:700;border-top:1px solid var(--border);padding-top:8px;margin-top:8px" : ""}`}>
    <span class={strong ? "" : "muted"}>{name}</span>
    <span class={tone ?? ""} style="font-variant-numeric:tabular-nums">{value}</span>
  </div>
);

const GroupDrill: FC<{
  g: ProjectGroup;
  tasks: XeroProjectTask[];
  ledgerHref: string;
}> = ({ g, tasks, ledgerHref }) => {
  const estimate = g.members.reduce((s, p) => s + (p.estimate ?? 0), 0);
  return (
    <div>
      <div class="row spread" style="margin-bottom:12px">
        <strong>{g.name} — breakdown{g.members.length > 1 ? ` (${g.members.length} Xero projects combined)` : ""}</strong>
        <a class="btn btn-sm" href={ledgerHref}>📒 Open ledger →</a>
      </div>

      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="k-label">Charge</div><div class="k-value" style="font-size:18px">{formatZAR(g.charge)}</div><div class="k-sub muted">bills &amp; spend assigned in Xero</div></div>
        <div class="kpi"><div class="k-label">Invoiced</div><div class="k-value" style="font-size:18px">{formatZAR(g.invoiced)}</div></div>
        <div class="kpi"><div class="k-label">Profit</div><div class={`k-value ${g.invoiced - g.charge < 0 ? "neg" : "pos"}`} style="font-size:18px">{formatZAR(g.invoiced - g.charge)}</div><div class="k-sub muted">{pct(g.invoiced - g.charge, g.invoiced)}% of invoiced</div></div>
        <div class="kpi"><div class="k-label">{estimate > 0 ? "Estimate" : "Xero projects"}</div><div class="k-value" style="font-size:18px">{estimate > 0 ? formatZAR(estimate) : String(g.members.length)}</div></div>
      </div>

      {g.members.length > 1 ? (
        <div style="margin-bottom:12px">
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
        <div style="margin-bottom:12px">
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
        </div>
      ) : null}

      <p class="muted" style="font-size:12px;margin:0">
        Charge is the supplier bills and spend assigned to this project in Xero (the API doesn't expose those line items
        individually). <a href={ledgerHref}>Open the ledger</a> for the month-by-month movement.
      </p>
    </div>
  );
};
