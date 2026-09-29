import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, StateBadge } from "./layout";
import type { CFCategory } from "../lib/forecast";
import type { CFSettings } from "../lib/forecast";
import type { DerivedCashflow } from "../lib/cashflow_engine";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf } from "../lib/period";
import { lineChart } from "../lib/charts";
import { FinanceTabs } from "./income";

export type EntryMap = Map<string, Map<string, { amount: number; status: string }>>;
export type ForecastTab = "overview" | "monthly" | "assumptions";

const srcLabel = (s: string): string =>
  s === "manual" ? "MANUAL" : s === "yoy" ? "prior-year trend" : s === "payroll" ? "payroll" : s === "ctc" ? "payroll CTC" : s === "avg" ? "historical avg" : "actual";

const SCENARIO_LABEL: Record<"base" | "best" | "worst", string> = { base: "Expected", best: "Optimistic", worst: "Conservative" };

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string; badge?: "actual" | "forecast" | "estimate" | "manual" }> = ({ label, value, sub, tone, badge }) => (
  <div class="kpi">
    <div class="k-label">{label} {badge ? <StateBadge state={badge} /> : null}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const Tabs: FC<{ active: ForecastTab }> = ({ active }) => (
  <div class="segmented" style="margin:16px 0 0">
    <a href="/app/finance/forecast" class={active === "overview" ? "seg active" : "seg"}>Overview</a>
    <a href="/app/finance/forecast?t=monthly" class={active === "monthly" ? "seg active" : "seg"}>Monthly forecast</a>
    <a href="/app/finance/forecast?t=assumptions" class={active === "assumptions" ? "seg active" : "seg"}>Assumptions &amp; scenarios</a>
  </div>
);

export const ForecastPage: FC<{
  cf: DerivedCashflow;
  settings: CFSettings;
  overrideCats: CFCategory[]; // the three fixed override rows
  adjCats: CFCategory[]; // user-defined additional rows
  entries: EntryMap;
  dealValues?: Map<string, number>; // pipeline income from deals' expected payment dates (read-only)
  boundary: string;
  tab: ForecastTab;
  facility: { used: number; limit: number | null };
  bankEstimate: number;
  lastSync?: string | null;
  line?: string; // open the details drawer for this row key
  saved?: boolean;
}> = ({ cf, settings, overrideCats, adjCats, entries, dealValues, boundary, tab, facility, bankEstimate, lastSync, line, saved }) => {
  // Show the boundary FY's actual months (read-only context) before the editable forecast months.
  const actualMonths = cf.columns
    .filter((c) => !c.isForecast && fiscalYearOf(c.month) === fiscalYearOf(boundary))
    .map((c) => c.month);
  const months = cf.columns.filter((c) => c.isForecast).map((c) => c.month);
  const allMonths = [...actualMonths, ...months];
  const colByMonth = new Map(cf.columns.map((c) => [c.month, c]));

  const rowKind = (name: string): "income" | "people" | "other" =>
    /income/i.test(name) ? "income" : /people/i.test(name) ? "people" : "other";
  const modelValue = (name: string, m: string): number => {
    const c = colByMonth.get(m);
    return c ? c[rowKind(name)] : 0;
  };
  const modelSrc = (name: string, m: string): string => {
    const c = colByMonth.get(m);
    if (!c) return "avg";
    const k = rowKind(name);
    return k === "income" ? c.incomeSrc : k === "people" ? c.peopleSrc : c.otherSrc;
  };
  const catFor = (k: "income" | "people" | "other") => overrideCats.find((c2) => rowKind(c2.name) === k);

  // ---- Details drawer (additional rows) --------------------------------------
  const lineHref = (key: string) => `/app/finance/forecast?t=monthly&line=${key}`;
  type DrawerRow = {
    month: string;
    value: number | null;
    src: string | null;
    forecast: boolean;
    input?: { name: string; value: string; placeholder: string };
  };
  type Drawer = { title: string; badge?: string; desc: string; how: string; rows: DrawerRow[] };
  const buildDrawer = (key: string): Drawer | null => {
    if (!key.startsWith("adj_")) return null;
    const cat = adjCats.find((c2) => c2.id === key.slice(4));
    if (!cat) return null;
    return {
      title: cat.name, badge: cat.kind,
      desc: `A manual ${cat.kind} row you added — e.g. an outstanding project, pipeline item or once-off. It adds on top of the model in forecast months (actual months always come from the books).`,
      how: "Type amounts into the forecast months below and Save; clear a value to remove it. Delete the whole row under “Add a row” below the grid.",
      rows: allMonths.map((m) => {
        const v = entries.get(cat.id)?.get(m)?.amount ?? null;
        const input = m > boundary ? { name: `e_${cat.id}_${m}`, value: v != null ? String(v) : "", placeholder: "" } : undefined;
        return { month: m, value: v, src: v != null ? "manual" : null, forecast: m > boundary, input };
      }),
    };
  };
  const drawer = line ? buildDrawer(line) : null;

  // ---- Overview figures -------------------------------------------------------
  const forecast12 = cf.columns.filter((c) => c.isForecast).slice(0, 12);
  const net12 = forecast12.reduce((s, c) => s + c.net, 0);
  const fundingMonth = bankEstimate < 0 ? cf.kpis.runwayMonth ?? boundary : cf.columns.find((c) => c.isForecast && c.balance < 0)?.month ?? null;
  const balanceLine = cf.columns.map((c) => ({ label: shortLabel(c.month), value: c.balance, forecast: c.isForecast }));

  // Read-only model row (SARS / recurring) inside the grid.
  const ModelRow: FC<{ title: string; hint: string; pick: (c: NonNullable<ReturnType<typeof colByMonth.get>>) => number; tag?: string }> = ({ title, hint, pick, tag }) => (
    <tr>
      <td style="text-align:left">{title}<div class="cellhint">{hint}</div></td>
      {allMonths.map((m) => {
        const c = colByMonth.get(m);
        return (
          <td class={`num ${c?.isForecast ? "" : "muted"}`}>
            {c ? formatZAR(pick(c)) : ""}{c?.isForecast && tag ? <span class="cellhint"> {tag}</span> : null}
          </td>
        );
      })}
    </tr>
  );

  // Editable model row (Income / People / Other) with source tags.
  const OverrideRow: FC<{ k: "income" | "people" | "other"; title: string; hint: string }> = ({ k, title, hint }) => {
    const cat = catFor(k);
    if (!cat) return null;
    return (
      <tr>
        <td style="text-align:left">{title}<div class="cellhint">{hint}</div></td>
        {actualMonths.map((m) => (
          <td class="num muted">{formatZAR(modelValue(cat.name, m))}<span class="cellhint"> actual</span></td>
        ))}
        {months.map((m) => {
          const v = entries.get(cat.id)?.get(m);
          return (
            <td>
              <input type="text" inputmode="decimal" name={`e_${cat.id}_${m}`}
                value={v ? String(v.amount) : ""} placeholder={String(Math.round(modelValue(cat.name, m)))} autocomplete="off" />
              <span class="cellhint"> {srcLabel(modelSrc(cat.name, m))}</span>
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <Layout title="Forecast" authed section="finance" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Finance · Forecast</h1>
            <p class="muted" style="margin-top:0">
              Where will cash be over the next {settings.horizon_months} months? One model: actuals through{" "}
              <strong>{label(boundary)}</strong>, then payroll, recurring costs, deals and assumptions.
            </p>
            <AsAt lastSync={lastSync} />
          </div>
        </div>

        <FinanceTabs active="forecast" />
        <Tabs active={tab} />

        {saved ? <div class="callout section-block">✓ Saved — the forecast, scenarios and every dependent page updated.</div> : null}

        {tab === "overview" ? (
          <>
            <div class="kpis section-block">
              <Kpi label="Current cash" badge="estimate" value={formatZAR(bankEstimate)} tone={bankEstimate < 0 ? "neg" : "pos"} sub="modelled bank balance today" />
              <Kpi label="Lowest projected cash" badge="forecast" value={formatZAR(cf.kpis.lowest.balance)} tone={cf.kpis.lowest.balance < 0 ? "neg" : "pos"} sub={label(cf.kpis.lowest.month)} />
              <Kpi label={fundingMonth ? "Funding pressure from" : "Funding required"} badge="forecast"
                value={fundingMonth ? label(fundingMonth) : "Not in this forecast"}
                tone={fundingMonth ? "neg" : "pos"} sub={fundingMonth ? "forecast cash below zero" : "cash stays above zero"} />
              <Kpi label="12-month net movement" badge="forecast" value={formatZAR(net12)} tone={net12 < 0 ? "neg" : "pos"} sub="sum of the next 12 forecast months" />
            </div>

            <div class="card section-block">
              <div class="row spread">
                <h3 style="margin:0">Cash position — actual → forecast</h3>
                <div class="legend">
                  <span><span class="swatch" style="background:#4f8cff"></span>ACTUAL</span>
                  <span style="font-weight:700">←&nbsp;|&nbsp;→</span>
                  <span><span class="swatch" style="background:#4f8cff;opacity:.5"></span>FORECAST from {label(boundary)}</span>
                </div>
              </div>
              <div dangerouslySetInnerHTML={{ __html: lineChart(balanceLine, { height: 280 }) }} />
            </div>

            <div class="card section-block">
              <h3>How each figure is forecast — one policy, everywhere</h3>
              <div class="grid" style="grid-template-columns:1fr 1fr;gap:18px">
                <div>
                  <strong style="font-size:14px">Cash in</strong>
                  <ol class="muted" style="font-size:13px;margin:8px 0 0;padding-left:20px">
                    <li>Manual override typed in the grid (<span class="badge manual">MANUAL</span>)</li>
                    <li>Deal expected payments (<span class="badge income">deal</span>)</li>
                    <li>Prior-year trend — last year's month × FY-to-date growth (<span class="badge forecast">FORECAST</span>)</li>
                    <li>3-month historical average (fallback)</li>
                  </ol>
                </div>
                <div>
                  <strong style="font-size:14px">Cash out</strong>
                  <ol class="muted" style="font-size:13px;margin:8px 0 0;padding-left:20px">
                    <li>Manual override typed in the grid (<span class="badge manual">MANUAL</span>)</li>
                    <li>People — payroll capture grid, then active-staff CTC</li>
                    <li>Recurring costs — tracked on the Costs tab</li>
                    <li>Other — prior-year trend, then 3-month average; SARS at its 3-month average</li>
                  </ol>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === "monthly" ? (
          <>
            <form method="post" action="/app/accounts/save">
              <div class="tablewrap section-block">
                <table class="grid fixed" style={`min-width:${240 + allMonths.length * 104}px`}>
                  <colgroup>
                    <col style="width:240px" />
                    {allMonths.map(() => <col style="width:104px" />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style="text-align:left">Row</th>
                      {actualMonths.map((m) => <th class="muted">{shortLabel(m)} · A</th>)}
                      {months.map((m) => <th class="fc">{shortLabel(m)} · F</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr class="group"><td colspan={allMonths.length + 1}>Cash in</td></tr>
                    <OverrideRow k="income" title="Customer collections" hint="cash received — the invoiced view is on Profit & Loss" />
                    {dealValues && dealValues.size > 0 ? (
                      <tr>
                        <td style="text-align:left">
                          <a href="/app/pipeline">Deals — expected payments</a> <span class="badge income">income</span>
                          <div class="cellhint">read-only · set per deal on the Pipeline page</div>
                        </td>
                        {actualMonths.map((m) => <td class="num muted">{dealValues.get(m) ? formatZAR(dealValues.get(m)!) : "—"}</td>)}
                        {months.map((m) => <td class="num">{dealValues.get(m) ? formatZAR(dealValues.get(m)!) : ""}</td>)}
                      </tr>
                    ) : null}
                    {adjCats.filter((c2) => c2.kind === "income").map((cat) => (
                      <tr>
                        <td style="text-align:left">
                          <a href={lineHref(`adj_${cat.id}`)} title="What is this line?">{cat.name} <span class="muted" style="font-size:11px">ⓘ</span></a> <span class="badge income">income</span>
                        </td>
                        {actualMonths.map(() => <td class="muted" style="text-align:center">—</td>)}
                        {months.map((m) => {
                          const v = entries.get(cat.id)?.get(m);
                          return <td><input type="text" inputmode="decimal" name={`e_${cat.id}_${m}`} value={v ? String(v.amount) : ""} autocomplete="off" /></td>;
                        })}
                      </tr>
                    ))}
                    <tr class="group"><td colspan={allMonths.length + 1}>People</td></tr>
                    <OverrideRow k="people" title="Employees & contractors" hint="from the Payroll capture grid, then active-staff CTC" />
                    <tr class="group"><td colspan={allMonths.length + 1}>Operating costs</td></tr>
                    <OverrideRow k="other" title="Other operating costs" hint="everything except people, tax and manual recurring" />
                    <ModelRow title="Recurring (manual)" hint="tracked on the Costs tab — outside Xero" pick={(c) => c.recurring} />
                    <tr class="group"><td colspan={allMonths.length + 1}>Tax</td></tr>
                    <ModelRow title="SARS — VAT / PAYE" hint="cash settlements to SARS; VAT is not in the P&L" pick={(c) => c.sars} tag="avg" />
                    <tr class="group"><td colspan={allMonths.length + 1}>One-off adjustments</td></tr>
                    {adjCats.filter((c2) => c2.kind === "cost").map((cat) => (
                      <tr>
                        <td style="text-align:left">
                          <a href={lineHref(`adj_${cat.id}`)} title="What is this line?">{cat.name} <span class="muted" style="font-size:11px">ⓘ</span></a> <span class="badge cost">cost</span>
                        </td>
                        {actualMonths.map(() => <td class="muted" style="text-align:center">—</td>)}
                        {months.map((m) => {
                          const v = entries.get(cat.id)?.get(m);
                          return <td><input type="text" inputmode="decimal" name={`e_${cat.id}_${m}`} value={v ? String(v.amount) : ""} autocomplete="off" /></td>;
                        })}
                      </tr>
                    ))}
                    <tr class="total">
                      <td style="text-align:left">Net cash movement</td>
                      {allMonths.map((m) => {
                        const c = colByMonth.get(m);
                        return <td class={`num ${c && c.net < 0 ? "neg" : ""}`}>{c ? formatZAR(c.net) : ""}</td>;
                      })}
                    </tr>
                    <tr class="total">
                      <td style="text-align:left">Closing cash</td>
                      {allMonths.map((m) => {
                        const c = colByMonth.get(m);
                        return <td class={`num ${c && c.balance < 0 ? "neg" : ""}`}>{c ? formatZAR(c.balance) : ""}</td>;
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="toolbar">
                <button class="btn btn-primary" type="submit">Save forecast</button>
                <span class="muted" style="font-size:12px">
                  Columns marked <strong>· A</strong> are actual (locked); <strong>· F</strong> are forecast. Typing a
                  value overrides the model (<span class="badge manual">MANUAL</span>); clearing returns to it.
                </span>
              </div>
            </form>

            <div class="card section-block">
              <h3>Add a one-off row</h3>
              <form method="post" action="/app/accounts/category" class="formgrid">
                <div><label>Name</label><input type="text" name="name" required placeholder="e.g. Illovo project — outstanding" /></div>
                <div><label>Type</label>
                  <select name="kind"><option value="income">income</option><option value="cost">cost</option></select>
                </div>
                <div><button class="btn btn-primary" type="submit">Add row</button></div>
              </form>
              {adjCats.length > 0 ? (
                <div class="tablewrap" style="margin-top:14px">
                  <table class="grid">
                    <thead><tr><th style="text-align:left">Row</th><th>Type</th><th></th></tr></thead>
                    <tbody>
                      {adjCats.map((cat) => (
                        <tr>
                          <td style="text-align:left">{cat.name}</td>
                          <td><span class={`badge ${cat.kind}`}>{cat.kind}</span></td>
                          <td>
                            <form method="post" action="/app/accounts/category/delete" style="margin:0"
                              onsubmit="return confirm('Delete this row and its values?')">
                              <input type="hidden" name="id" value={cat.id} />
                              <button class="btn btn-sm btn-danger" type="submit">Delete</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "assumptions" ? (
          <>
            <div class="card section-block">
              <div class="row spread" style="align-items:center">
                <h3 style="margin:0">Books complete through <Info text="The boundary between actual and forecast. Months up to and including this one are treated as complete, reconciled books." /></h3>
                <form method="post" action="/app/accounts/actuals-through" class="row" style="gap:8px;margin:0">
                  <select name="actuals_through" style="width:auto;padding:8px 12px">
                    {cf.months.filter((m) => m <= new Date().toISOString().slice(0, 7)).map((m) => (
                      <option value={m} selected={m === boundary}>{label(m)}</option>
                    ))}
                  </select>
                  <button class="btn btn-sm btn-primary" type="submit">Set</button>
                </form>
              </div>
              <p class="muted" style="font-size:12px;margin:10px 0 0">
                Set this to the last month that is fully reconciled in Xero. A half-captured month here drags every
                forecast month down.
              </p>
            </div>

            <div class="section-block">
              <h3>Scenarios</h3>
              <div class="tablewrap">
                <table class="grid">
                  <thead><tr><th style="text-align:left">Scenario</th><th>Lowest cash</th><th>Month</th><th>Funding needed</th><th>End of forecast</th></tr></thead>
                  <tbody>
                    {(["base", "best", "worst"] as const).map((k) => {
                      const sc = cf.scenarios[k];
                      return (
                        <tr>
                          <td style="text-align:left"><strong>{SCENARIO_LABEL[k]}</strong>
                            <div class="cellhint">{k === "base" ? "the model as configured" : k === "best" ? `income +${settings.best_income_pct}% · costs −${settings.best_cost_pct}%` : `income −${settings.worst_income_pct}% · costs +${settings.worst_cost_pct}%`}</div>
                          </td>
                          <td class={`num ${sc.lowest.balance < 0 ? "neg" : ""}`}>{formatZAR(sc.lowest.balance)}</td>
                          <td class="num">{label(sc.lowest.month)}</td>
                          <td class={`num ${sc.runwayMonth ? "neg" : "pos"}`}>{sc.runwayMonth ? `from ${label(sc.runwayMonth)}` : "not in forecast"}</td>
                          <td class={`num ${sc.endBalance < 0 ? "neg" : "pos"}`}>{formatZAR(sc.endBalance)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="card section-block">
              <h3>Model settings</h3>
              <form method="post" action="/app/accounts/settings" class="formgrid">
                <div><label>Opening cash balance (bank statement)</label><input type="text" inputmode="decimal" name="opening_balance" value={String(settings.opening_balance)} /></div>
                <div><label>Opening month (YYYY-MM)</label><input type="text" name="opening_period" value={settings.opening_period} /></div>
                <div><label>Forecast horizon (months)</label><input type="number" name="horizon_months" value={String(settings.horizon_months)} /></div>
                <div><label>Facility used (R)</label><input type="text" inputmode="decimal" name="revolving_owed" value={String(facility.used)} /></div>
                <div><label>Facility limit (R)</label><input type="text" inputmode="decimal" name="facility_limit" value={facility.limit != null ? String(facility.limit) : ""} placeholder="e.g. 250 000" /></div>
                <div><label>Optimistic · income +%</label><input type="number" name="best_income_pct" value={String(settings.best_income_pct)} /></div>
                <div><label>Optimistic · costs −%</label><input type="number" name="best_cost_pct" value={String(settings.best_cost_pct)} /></div>
                <div><label>Conservative · income −%</label><input type="number" name="worst_income_pct" value={String(settings.worst_income_pct)} /></div>
                <div><label>Conservative · costs +%</label><input type="number" name="worst_cost_pct" value={String(settings.worst_cost_pct)} /></div>
                <div><button class="btn btn-primary" type="submit">Save settings</button></div>
              </form>
              <p class="muted" style="font-size:12px;margin-top:10px">
                The opening balance anchors the whole cash model to a real bank statement; everything after it is
                derived from actual and forecast cash movements.
              </p>
            </div>
          </>
        ) : null}
      </div>

      {drawer ? (
        <>
          <a href="/app/finance/forecast?t=monthly" class="drawer-overlay" aria-label="Close details"></a>
          <aside class="drawer">
            <div class="row spread" style="align-items:flex-start">
              <h3>{drawer.title} {drawer.badge ? <span class={`badge ${drawer.badge}`}>{drawer.badge}</span> : null}</h3>
              <a href="/app/finance/forecast?t=monthly" class="btn btn-sm" title="Close">✕</a>
            </div>
            <p style="font-size:13px;margin-top:4px">{drawer.desc}</p>
            <p class="muted" style="font-size:13px"><strong>How it's calculated:</strong> {drawer.how}</p>
            {(() => {
              const editable = drawer.rows.some((r) => r.input);
              const tbl = (
                <table>
                  <thead><tr><th>Month</th><th style="text-align:right">Value</th><th style="text-align:right">Source</th></tr></thead>
                  <tbody>
                    {drawer.rows.map((r) => (
                      <tr>
                        <td class={r.forecast ? "" : "muted"}>{label(r.month)}</td>
                        <td class={`num ${r.value != null && r.value < 0 ? "neg" : ""}`}>
                          {r.input
                            ? <input type="text" inputmode="decimal" name={r.input.name} value={r.input.value} placeholder={r.input.placeholder} autocomplete="off" />
                            : r.value != null ? formatZAR(r.value) : "—"}
                        </td>
                        <td class="num muted" style="font-size:11px">{r.src ?? (r.forecast ? "forecast" : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
              return editable ? (
                <form method="post" action="/app/accounts/save">
                  <input type="hidden" name="line" value={line} />
                  {tbl}
                  <div class="row" style="gap:10px;align-items:center;margin-top:12px">
                    <button class="btn btn-sm btn-primary" type="submit">Save</button>
                    <span class="muted" style="font-size:12px">Typed values override the model; clear to return to it.</span>
                  </div>
                </form>
              ) : tbl;
            })()}
            <p class="muted" style="font-size:12px;margin-top:12px">Greyed months are actuals (books complete); the rest are forecast.</p>
          </aside>
        </>
      ) : null}
    </Layout>
  );
};
