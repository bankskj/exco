import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, ExportPdfButton } from "./layout";
import type { PeriodResult, ClientResult, ProjectResult } from "../lib/billing_types";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf, fyLabel } from "../lib/period";

/** Cents → whole-rand display (grids never show decimals). */
const R = (c: number) => formatZAR(Math.round(c / 100));
const pct1 = (p: number | null): string => (p == null ? "—" : `${p.toFixed(1)}%`);
const netPctOf = (netC: number, revenueC: number): number | null =>
  revenueC !== 0 ? Math.round((netC / revenueC) * 1000) / 10 : null;

// ---------------------------------------------------------------------------
// Shared period filter
// ---------------------------------------------------------------------------

export type BillingPeriodKey = "month" | "lastmonth" | "quarter" | "lastquarter" | "fy" | "all";

export const BILLING_PERIOD_TABS: { key: BillingPeriodKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "lastquarter", label: "Last quarter" },
  { key: "fy", label: "This FY" },
  { key: "all", label: "All time" },
];

/** Segmented ?p=… period links, shared by every Clients-section page. */
export const BillingPeriodTabs: FC<{ active: BillingPeriodKey; base: string; extraQS?: string }> = ({
  active,
  base,
  extraQS,
}) => (
  <div class="segmented">
    {BILLING_PERIOD_TABS.map((t) => (
      <a href={`${base}?p=${t.key}${extraQS ? `&${extraQS}` : ""}`} class={active === t.key ? "seg active" : "seg"}>
        {t.label}
      </a>
    ))}
  </div>
);

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

// ---------------------------------------------------------------------------
// Summary page
// ---------------------------------------------------------------------------

export type ClientsSummaryPageProps = {
  result: PeriodResult | null;
  periodKey: BillingPeriodKey;
  periodLabel: string;
  months: string[];
  view: "table" | "grid";
  monthlyNet: { month: string; byClient: Record<string, number> }[] | null;
  lastSyncLabel: string | null;
  closedBadge?: string | null;
};

const budgetVariance = (c: { netC: number; budgetRevenueC: number | null; budgetCostC: number | null }): number | null =>
  c.budgetRevenueC == null && c.budgetCostC == null ? null : c.netC - ((c.budgetRevenueC ?? 0) - (c.budgetCostC ?? 0));

/**
 * Clients summary — per-client P&L for the selected period, with a month-grid
 * alternative view, reconciliation status and exception queues.
 */
export const ClientsSummaryPage: FC<ClientsSummaryPageProps> = ({
  result,
  periodKey,
  periodLabel,
  months,
  view,
  monthlyNet,
  lastSyncLabel,
  closedBadge,
}) => {
  const base = `/app/clients?p=${periodKey}`;
  return (
    <Layout title="Clients" authed section="clients" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">
              Clients{closedBadge ? <span class="badge income" style="margin-left:10px;vertical-align:middle">{closedBadge}</span> : null}
            </h1>
            <p class="muted" style="margin-top:0">
              Who makes us money? Revenue, people cost, direct cost and the overhead recovery per client —{" "}
              every cent of cost lands on exactly one line.{" "}
              <Info text="People = allocated staff cost; Direct = supplier costs assigned to the client; Overhead = the shared pool recovered on the configured basis; Carry = a General Sales loss carried by the key accounts in proportion to revenue (General Sales gets the offsetting credit and nets zero). Net = Revenue − People − Direct − Overhead − Carry." />
            </p>
            <AsAt lastSync={lastSyncLabel} />
          </div>
          <div class="row" style="gap:8px;margin-top:16px">
            <ExportPdfButton />
            <a class="btn btn-sm" href={`/app/clients/export.csv?view=summary&p=${periodKey}`}>⤓ CSV</a>
            <a class="btn btn-sm" href="/app/clients/settings">Settings</a>
            <a class="btn btn-sm" href="/app/clients/close">Month-end close</a>
          </div>
        </div>

        <div class="row spread section-block" style="align-items:center">
          <BillingPeriodTabs active={periodKey} base="/app/clients" extraQS={view === "grid" ? "view=grid" : undefined} />
          <div class="segmented">
            <a href={base} class={view === "table" ? "seg active" : "seg"}>Table</a>
            <a href={`${base}&view=grid`} class={view === "grid" ? "seg active" : "seg"}>Month grid</a>
          </div>
        </div>

        {result == null ? (
          <div class="card section-block">
            <h2>No billing data yet</h2>
            <p class="muted" style="margin:6px 0 0">
              Nothing computed for {periodLabel}. Run a Xero sync (Overview → Sync now) to pull revenue and cost
              lines in, then map contacts and categories under <a href="/app/clients/settings">Settings</a>.
            </p>
          </div>
        ) : (
          <>
            <div class="kpis section-block">
              <Kpi label={`Revenue — ${periodLabel}`} value={R(result.totals.revenueC)} />
              <Kpi
                label="Contribution"
                value={R(result.totals.contributionC)}
                tone={result.totals.contributionC < 0 ? "neg" : "pos"}
                sub="revenue − people − direct"
              />
              <Kpi label="Overhead pool" value={R(result.poolC)} sub={`recovered on ${result.overheadBasis.replace("_", " ")}`} />
              <Kpi label="Net" value={R(result.totals.netC)} tone={result.totals.netC < 0 ? "neg" : "pos"} />
            </div>

            {result.reconciliation.ok ? (
              <p style="margin:14px 0 0">
                <span class="badge income">✓ Reconciles to the cent</span>{" "}
                <span class="muted" style="font-size:12px">
                  cost in {R(result.reconciliation.costInC)} = allocated {R(result.reconciliation.costAllocatedC)} · revenue in{" "}
                  {R(result.reconciliation.revenueInC)} = allocated {R(result.reconciliation.revenueAllocatedC)}
                </span>
              </p>
            ) : (
              <div class="callout section-block" style="border-left-color:var(--danger)">
                <strong class="neg">Does not reconcile.</strong> Cost in {R(result.reconciliation.costInC)} vs allocated{" "}
                {R(result.reconciliation.costAllocatedC)}; revenue in {R(result.reconciliation.revenueInC)} vs allocated{" "}
                {R(result.reconciliation.revenueAllocatedC)}.
              </div>
            )}

            {(() => {
              const ex = result.exceptions;
              const chips: { count: number; text: string; href: string }[] = [
                { count: ex.unmappedContacts.length, text: "unmapped revenue contact(s)", href: `/app/revenue?p=${periodKey}` },
                { count: ex.unassignedDirect.length, text: "unassigned direct cost(s)", href: `/app/costs?p=${periodKey}&tab=unassigned` },
                { count: ex.unmatchedStaff.length, text: "unmatched staff payment(s)", href: `/app/costs?p=${periodKey}&tab=unmatched` },
                { count: ex.estimatedStaff.length, text: "payroll estimate(s)", href: "/app/allocations" },
                { count: ex.overAllocated.length, text: "over-allocated staff", href: "/app/allocations" },
              ].filter((c) => c.count > 0);
              return chips.length ? (
                <div class="row" style="gap:8px;margin-top:12px">
                  {chips.map((c) => (
                    <a href={c.href} class="badge cost" style="text-decoration:none">
                      {c.count} {c.text} →
                    </a>
                  ))}
                </div>
              ) : (
                <p class="muted" style="font-size:12px;margin:12px 0 0">No open exceptions for this period.</p>
              );
            })()}

            {view === "table" ? (
              <div class="section-block tablewrap">
                <table class="grid">
                  <thead>
                    <tr>
                      <th style="text-align:left">Client</th>
                      <th>Revenue</th>
                      <th>People</th>
                      <th>Direct</th>
                      <th>Contribution</th>
                      <th>Contr %</th>
                      <th>Overhead</th>
                      <th title="General Sales loss carried by the key accounts, by revenue share">Carry</th>
                      <th>Net</th>
                      <th>Net %</th>
                      <th title="Net − (budget revenue − budget cost)">Budget var</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.clients.map((c) => {
                      const bv = budgetVariance(c);
                      return (
                        <tr>
                          <td style="text-align:left">
                            <a href={`/app/clients/${c.clientId}?p=${periodKey}`} style="font-weight:600">{c.name}</a>
                            {c.isGeneral ? <span class="badge manual" style="margin-left:8px">general</span> : null}
                          </td>
                          <td class="num">{R(c.revenueC)}</td>
                          <td class="num">{R(c.peopleC)}</td>
                          <td class="num">{R(c.directC)}</td>
                          <td class={`num ${c.contributionC < 0 ? "neg" : ""}`}>{R(c.contributionC)}</td>
                          <td class={`num ${c.contributionPct != null && c.contributionPct < 0 ? "neg" : ""}`}>{pct1(c.contributionPct)}</td>
                          <td class="num">{R(c.overheadC)}</td>
                          <td class={`num ${c.carryC < 0 ? "muted" : ""}`}>{c.carryC === 0 ? <span class="muted">—</span> : R(c.carryC)}</td>
                          <td class={`num ${c.netC < 0 ? "neg" : ""}`}>{R(c.netC)}</td>
                          <td class={`num ${c.netPct != null && c.netPct < 0 ? "neg" : ""}`}>{pct1(c.netPct)}</td>
                          <td class={`num ${bv != null && bv < 0 ? "neg" : ""}`}>{bv == null ? "—" : R(bv)}</td>
                        </tr>
                      );
                    })}
                    <tr class="total">
                      <td style="text-align:left">Total</td>
                      <td class="num">{R(result.totals.revenueC)}</td>
                      <td class="num">{R(result.totals.peopleC)}</td>
                      <td class="num">{R(result.totals.directC)}</td>
                      <td class={`num ${result.totals.contributionC < 0 ? "neg" : ""}`}>{R(result.totals.contributionC)}</td>
                      <td class="num">{pct1(netPctOf(result.totals.contributionC, result.totals.revenueC))}</td>
                      <td class="num">{R(result.totals.overheadC)}</td>
                      <td class="num muted" title={result.carriedLossC ? `General Sales loss of ${R(result.carriedLossC)} redistributed — nets to zero` : undefined}>
                        {result.carriedLossC ? `(${R(result.carriedLossC)})` : "—"}
                      </td>
                      <td class={`num ${result.totals.netC < 0 ? "neg" : ""}`}>{R(result.totals.netC)}</td>
                      <td class="num">{pct1(netPctOf(result.totals.netC, result.totals.revenueC))}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div class="section-block tablewrap">
                <table class="grid">
                  <thead>
                    <tr>
                      <th style="text-align:left">Net by client</th>
                      {months.map((m) => <th>{shortLabel(m)}</th>)}
                      <th>{months.length ? fyLabel(fiscalYearOf(months[months.length - 1])) : "FY"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.clients.map((c) => {
                      const row = months.map((m) => monthlyNet?.find((e) => e.month === m)?.byClient[c.clientId] ?? 0);
                      const fy = row.reduce((s, v) => s + v, 0);
                      return (
                        <tr>
                          <td style="text-align:left">
                            <a href={`/app/clients/${c.clientId}?p=${periodKey}`} style="font-weight:600">{c.name}</a>
                          </td>
                          {row.map((v) => <td class={`num ${v < 0 ? "neg" : ""}`}>{R(v)}</td>)}
                          <td class={`num ${fy < 0 ? "neg" : ""}`} style="font-weight:700">{R(fy)}</td>
                        </tr>
                      );
                    })}
                    <tr class="total">
                      <td style="text-align:left">Total</td>
                      {months.map((m) => {
                        const v = result.clients.reduce((s, c) => s + (monthlyNet?.find((e) => e.month === m)?.byClient[c.clientId] ?? 0), 0);
                        return <td class={`num ${v < 0 ? "neg" : ""}`}>{R(v)}</td>;
                      })}
                      {(() => {
                        const fy = result.clients.reduce(
                          (s, c) => s + months.reduce((s2, m) => s2 + (monthlyNet?.find((e) => e.month === m)?.byClient[c.clientId] ?? 0), 0),
                          0,
                        );
                        return <td class={`num ${fy < 0 ? "neg" : ""}`}>{R(fy)}</td>;
                      })()}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};

// ---------------------------------------------------------------------------
// Client tracker (per-client, 2025-tracker layout)
// ---------------------------------------------------------------------------

/** One aggregate block of the tracker (a quarter subtotal or the FY total). */
export type TrackerAggregate = {
  revenueC: number;
  peopleC: number;
  directC: number;
  contributionC: number;
  overheadC: number;
  carryC: number;
  netC: number;
  budgetRevenueC: number | null;
  budgetCostC: number | null;
};

export type ClientTrackerPageProps = {
  client: { id: string; name: string; isGeneral: boolean };
  /** The FY months, Mar..Feb. */
  months: string[];
  /** Aligned to months. */
  perMonth: (ClientResult | null)[];
  quarterTotals: TrackerAggregate[];
  fyTotal: TrackerAggregate;
  /** Open expansion: "revenue" | "people" | "direct" | "suppliers" | null. */
  expand: string | null;
  projectCount: number;
  periodLabel: string;
};

type TrackerCol = { t: "m"; i: number } | { t: "q"; i: number } | { t: "fy" };

const buildCols = (months: string[]): TrackerCol[] => {
  // YTD leads so the headline is visible without scrolling; months follow.
  const cols: TrackerCol[] = [{ t: "fy" }];
  months.forEach((_, i) => {
    cols.push({ t: "m", i });
    if (i % 3 === 2) cols.push({ t: "q", i: Math.floor(i / 3) });
  });
  return cols;
};

const QCOL_STYLE = "font-weight:600;background:var(--panel-2)";

const TrackerHead: FC<{ months: string[]; cols: TrackerCol[]; firstLabel: string }> = ({ months, cols, firstLabel }) => (
  <thead>
    <tr>
      <th style="text-align:left">{firstLabel}</th>
      {cols.map((c) => (
        <th style={c.t !== "m" ? QCOL_STYLE : ""}>
          {c.t === "m" ? shortLabel(months[c.i]) : c.t === "q" ? `Q${c.i + 1}` : months.length ? `YTD ${fyLabel(fiscalYearOf(months[months.length - 1]))}` : "YTD"}
        </th>
      ))}
    </tr>
  </thead>
);

/**
 * Per-client tracker — the 2025 layout: FY months across, Q1..Q4 subtotal
 * columns and an FY total, with server-rendered expandable Revenue / People /
 * Direct rows (?expand=…) one level deep.
 */
export const ClientTrackerPage: FC<ClientTrackerPageProps> = ({
  client,
  months,
  perMonth,
  quarterTotals,
  fyTotal,
  expand,
  projectCount,
  periodLabel,
}) => {
  const cols = buildCols(months);
  const aggOf = (c: TrackerCol): TrackerAggregate | null =>
    c.t === "m" ? perMonth[c.i] ?? null : c.t === "q" ? quarterTotals[c.i] ?? null : fyTotal;

  const numRow = (
    name: string,
    get: (a: TrackerAggregate) => number | null,
    opts?: { expandKey?: string; negRed?: boolean; strong?: boolean },
  ) => {
    const isOpen = opts?.expandKey != null && expand === opts.expandKey;
    return (
      <tr>
        <td style={`text-align:left${opts?.strong ? ";font-weight:700" : ""}`}>
          {opts?.expandKey ? (
            <a href={isOpen ? "?" : `?expand=${opts.expandKey}`} style="font-weight:600">
              {name} <span class="muted" style="font-size:10px">{isOpen ? "▲" : "▼"}</span>
            </a>
          ) : (
            name
          )}
        </td>
        {cols.map((c) => {
          const a = aggOf(c);
          const v = a ? get(a) : null;
          return (
            <td class={`num ${v != null && opts?.negRed && v < 0 ? "neg" : ""}`} style={c.t !== "m" ? QCOL_STYLE : ""}>
              {v == null ? "—" : R(v)}
            </td>
          );
        })}
      </tr>
    );
  };

  /** Indented sub-row from per-month cent values (quarters/FY summed). */
  const subRow = (name: string, monthVals: (number | null)[], badge?: string | null, hint?: string | null) => {
    const sumRange = (from: number, to: number) => monthVals.slice(from, to).reduce<number>((s, v) => s + (v ?? 0), 0);
    return (
      <tr style="opacity:.85">
        <td style="text-align:left;padding-left:26px" class="muted">
          {name}
          {badge ? <span class="badge estimate" style="margin-left:6px">{badge}</span> : null}
          {hint ? <div class="cellhint">{hint}</div> : null}
        </td>
        {cols.map((c) => {
          const v =
            c.t === "m" ? monthVals[c.i] : c.t === "q" ? sumRange(c.i * 3, c.i * 3 + 3) : sumRange(0, monthVals.length);
          return (
            <td class={`num ${v != null && v < 0 ? "neg" : ""}`} style={c.t !== "m" ? QCOL_STYLE : ""}>
              {v == null || v === 0 ? <span class="muted">—</span> : R(v)}
            </td>
          );
        })}
      </tr>
    );
  };

  // Expansion data, collected across the months present.
  const revenueGroups = [...new Set(perMonth.flatMap((m) => (m ? m.revenueByGroup.map((g) => g.group) : [])))];
  const staffPieces = (() => {
    const map = new Map<string, { name: string; estimated: boolean }>();
    for (const m of perMonth)
      for (const s of m?.peopleByStaff ?? [])
        map.set(s.employeeId, { name: s.name, estimated: (map.get(s.employeeId)?.estimated ?? false) || s.estimated });
    return [...map.entries()];
  })();
  const directGroups = [...new Set(perMonth.flatMap((m) => (m ? m.directByGroup.map((g) => g.group) : [])))];
  const suppliers = [...new Set(perMonth.flatMap((m) => (m ? m.directBySupplier.map((s) => s.supplier) : [])))];

  const projects = (() => {
    const map = new Map<string, string>();
    for (const m of perMonth) for (const p of m?.projects ?? []) if (!map.has(p.projectId)) map.set(p.projectId, p.name);
    return [...map.entries()];
  })();

  const hasBudget =
    fyTotal.budgetRevenueC != null ||
    fyTotal.budgetCostC != null ||
    perMonth.some((m) => m != null && (m.budgetRevenueC != null || m.budgetCostC != null));

  return (
    <Layout title={client.name} authed section="clients" wide>
      <div class="container" style="max-width:1320px">
        <p style="margin:14px 0 0;font-size:13px">
          <a href="/app/clients">← Clients</a>
        </p>
        <div class="row spread">
          <div>
            <h1 style="margin-top:4px">
              {client.name}
              {client.isGeneral ? <span class="badge manual" style="margin-left:10px;vertical-align:middle">general</span> : null}
            </h1>
            <p class="muted" style="margin-top:0">
              {periodLabel} tracker — click Revenue, People or Direct to break the row down.{" "}
              <Info text="YTD and quarter columns are subtotals of the computed months. People breaks down by staff member, Direct by report group (and from there by supplier)." />
            </p>
          </div>
          <div class="row" style="gap:8px;margin-top:10px">
            <ExportPdfButton />
            <a class="btn btn-sm" href={`/app/clients/export.csv?view=client&id=${client.id}`}>⤓ CSV</a>
          </div>
        </div>

        {projectCount > 1 && projects.length ? (
          <div style="margin:10px 0 2px">
            {projects.map(([id, name]) => (
              <a class="subnav" href={`/app/clients/${client.id}/projects/${id}`}>{name} →</a>
            ))}
          </div>
        ) : null}

        <div class="section-block tablewrap">
          <table class="grid">
            <TrackerHead months={months} cols={cols} firstLabel={client.name} />
            <tbody>
              {numRow("Revenue", (a) => a.revenueC, { expandKey: "revenue" })}
              {expand === "revenue"
                ? revenueGroups.map((g) =>
                    subRow(g, perMonth.map((m) => (m ? m.revenueByGroup.find((x) => x.group === g)?.amountC ?? 0 : null))),
                  )
                : null}
              {numRow("People", (a) => a.peopleC, { expandKey: "people" })}
              {expand === "people"
                ? staffPieces.map(([empId, s]) =>
                    subRow(
                      s.name,
                      perMonth.map((m) => (m ? m.peopleByStaff.find((x) => x.employeeId === empId)?.amountC ?? 0 : null)),
                      s.estimated ? "estimated" : null,
                      (() => {
                        const parts = perMonth
                          .map((m, i) => {
                            const amt = m?.peopleByStaff.find((x) => x.employeeId === empId)?.amountC ?? 0;
                            return m && m.peopleC > 0 && amt > 0
                              ? `${shortLabel(months[i])} ${Math.round((amt / m.peopleC) * 100)}%`
                              : null;
                          })
                          .filter((p): p is string => p != null);
                        return parts.length ? `of month people: ${parts.join(" · ")}` : null;
                      })(),
                    ),
                  )
                : null}
              {numRow("Direct", (a) => a.directC, { expandKey: "direct" })}
              {expand === "direct" ? (
                <>
                  {directGroups.map((g) =>
                    subRow(g, perMonth.map((m) => (m ? m.directByGroup.find((x) => x.group === g)?.amountC ?? 0 : null))),
                  )}
                  <tr>
                    <td style="text-align:left;padding-left:26px" colspan={cols.length + 1}>
                      <a href="?expand=suppliers" style="font-size:12px">by supplier →</a>
                    </td>
                  </tr>
                </>
              ) : null}
              {expand === "suppliers" ? (
                <>
                  {suppliers.map((sup) =>
                    subRow(sup, perMonth.map((m) => (m ? m.directBySupplier.find((x) => x.supplier === sup)?.amountC ?? 0 : null))),
                  )}
                  <tr>
                    <td style="text-align:left;padding-left:26px" colspan={cols.length + 1}>
                      <a href="?expand=direct" style="font-size:12px">← by report group</a>
                    </td>
                  </tr>
                </>
              ) : null}
              {numRow("Contribution", (a) => a.contributionC, { negRed: true, strong: true })}
              {numRow("Overhead recovery", (a) => a.overheadC)}
              {numRow("Carry (General Sales loss)", (a) => (a.carryC === 0 ? null : a.carryC))}
              {numRow("Net", (a) => a.netC, { negRed: true, strong: true })}
              <tr>
                <td style="text-align:left">Net %</td>
                {cols.map((c) => {
                  const a = aggOf(c);
                  const p = a ? netPctOf(a.netC, a.revenueC) : null;
                  return (
                    <td class={`num ${p != null && p < 0 ? "neg" : ""}`} style={c.t !== "m" ? QCOL_STYLE : ""}>
                      {pct1(p)}
                    </td>
                  );
                })}
              </tr>
              {hasBudget ? (
                <>
                  {numRow("Budget revenue", (a) => a.budgetRevenueC)}
                  {numRow("Budget cost", (a) => a.budgetCostC)}
                  {numRow(
                    "Variance",
                    (a) => (a.budgetRevenueC == null && a.budgetCostC == null ? null : budgetVariance(a)),
                    { negRed: true },
                  )}
                </>
              ) : null}
            </tbody>
          </table>
        </div>
        <p class="muted" style="font-size:12px;margin-top:8px">
          Variance = Net − (budget revenue − budget cost). Months with no computed result show “—”.
        </p>
      </div>
    </Layout>
  );
};

// ---------------------------------------------------------------------------
// Project view (per-project tracker)
// ---------------------------------------------------------------------------

export type ProjectViewPageProps = {
  client: { id: string; name: string };
  project: {
    id: string;
    name: string;
    billingType: string;
    contractValueC: number | null;
    invoicedToDateC: number;
  };
  months: string[];
  perMonth: (ProjectResult | null)[];
  fyTotal: TrackerAggregate;
  periodLabel: string;
};

/**
 * Per-project tracker — same month layout as the client tracker (months + FY
 * total, no quarter columns), plus contract-value and invoiced-to-date KPIs.
 */
export const ProjectViewPage: FC<ProjectViewPageProps> = ({ client, project, months, perMonth, fyTotal, periodLabel }) => {
  const cols: TrackerCol[] = [{ t: "fy" }, ...months.map((_, i): TrackerCol => ({ t: "m", i }))];
  const aggOf = (c: TrackerCol): TrackerAggregate | null => (c.t === "m" ? perMonth[c.i] ?? null : c.t === "fy" ? fyTotal : null);
  const row = (name: string, get: (a: TrackerAggregate) => number | null, negRed?: boolean, strong?: boolean) => (
    <tr>
      <td style={`text-align:left${strong ? ";font-weight:700" : ""}`}>{name}</td>
      {cols.map((c) => {
        const a = aggOf(c);
        const v = a ? get(a) : null;
        return (
          <td class={`num ${v != null && negRed && v < 0 ? "neg" : ""}`} style={c.t === "fy" ? QCOL_STYLE : ""}>
            {v == null ? "—" : R(v)}
          </td>
        );
      })}
    </tr>
  );
  const hasBudget = fyTotal.budgetRevenueC != null || fyTotal.budgetCostC != null;

  return (
    <Layout title={`${client.name} · ${project.name}`} authed section="clients" wide>
      <div class="container" style="max-width:1320px">
        <p style="margin:14px 0 0;font-size:13px">
          <a href="/app/clients">← Clients</a> · <a href={`/app/clients/${client.id}`}>{client.name}</a>
        </p>
        <div class="row spread">
          <div>
            <h1 style="margin-top:4px">
              {project.name} <span class="badge recurring" style="vertical-align:middle">{project.billingType}</span>
            </h1>
            <p class="muted" style="margin-top:0">{client.name} · {periodLabel}</p>
          </div>
          <div style="margin-top:10px"><ExportPdfButton /></div>
        </div>

        <div class="kpis section-block">
          <Kpi label="Contract value" value={project.contractValueC == null ? "—" : R(project.contractValueC)} />
          <Kpi
            label="Invoiced to date"
            value={R(project.invoicedToDateC)}
            sub={
              project.contractValueC
                ? `${Math.round((project.invoicedToDateC / project.contractValueC) * 100)}% of contract`
                : undefined
            }
          />
          <Kpi label={`Revenue — ${periodLabel}`} value={R(fyTotal.revenueC)} />
          <Kpi label={`Net — ${periodLabel}`} value={R(fyTotal.netC)} tone={fyTotal.netC < 0 ? "neg" : "pos"} />
        </div>

        <div class="section-block tablewrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="text-align:left">{project.name}</th>
                {cols.map((c) => (
                  <th style={c.t === "fy" ? QCOL_STYLE : ""}>
                    {c.t === "m" ? shortLabel(months[c.i]) : "Total"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("Revenue", (a) => a.revenueC)}
              {row("People", (a) => a.peopleC)}
              {row("Direct", (a) => a.directC)}
              {row("Contribution", (a) => a.contributionC, true, true)}
              {row("Overhead recovery", (a) => a.overheadC)}
              {row("Carry", (a) => (a.carryC === 0 ? null : a.carryC))}
              {row("Net", (a) => a.netC, true, true)}
              <tr>
                <td style="text-align:left">Net %</td>
                {cols.map((c) => {
                  const a = aggOf(c);
                  const p = a ? netPctOf(a.netC, a.revenueC) : null;
                  return (
                    <td class={`num ${p != null && p < 0 ? "neg" : ""}`} style={c.t === "fy" ? QCOL_STYLE : ""}>{pct1(p)}</td>
                  );
                })}
              </tr>
              {hasBudget ? (
                <>
                  {row("Budget revenue", (a) => a.budgetRevenueC)}
                  {row("Budget cost", (a) => a.budgetCostC)}
                  {row("Variance", (a) => (a.budgetRevenueC == null && a.budgetCostC == null ? null : budgetVariance(a)), true)}
                </>
              ) : null}
            </tbody>
          </table>
        </div>
        <p class="muted" style="font-size:12px;margin-top:8px">
          {months.length ? <>Figures for {label(months[0])}{months.length > 1 ? ` – ${label(months[months.length - 1])}` : ""}; </> : null}
          Overhead is recovered at client level and apportioned to projects by contribution.
        </p>
      </div>
    </Layout>
  );
};
