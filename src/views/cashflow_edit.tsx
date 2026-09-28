import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { CFCategory } from "../lib/forecast";
import type { DerivedCashflow } from "../lib/cashflow_engine";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf } from "../lib/period";
import { AccountsTabs } from "./income";

export type EntryMap = Map<string, Map<string, { amount: number; status: string }>>;

const srcLabel = (s: string): string =>
  s === "manual" ? "override" : s === "yoy" ? "YoY" : s === "payroll" ? "payroll grid" : s === "ctc" ? "payroll CTC" : s === "avg" ? "avg" : "actual";

/**
 * Forecast grid: the derived model's forecast months as editable columns.
 * Override rows replace the modelled Income / People / Other values where
 * filled (blank = model); additional rows (projects, pipeline, once-offs)
 * add on top.
 */
export const ForecastGridPage: FC<{
  cf: DerivedCashflow;
  overrideCats: CFCategory[]; // the three fixed override rows
  adjCats: CFCategory[]; // user-defined additional rows
  entries: EntryMap;
  dealValues?: Map<string, number>; // pipeline income from deals' expected payment dates (read-only)
  boundary: string;
  line?: string; // open the details drawer for this row key
  saved?: boolean;
}> = ({ cf, overrideCats, adjCats, entries, dealValues, boundary, line, saved }) => {
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

  // ---- Details drawer -------------------------------------------------------
  const lineHref = (key: string) => `/app/accounts/edit?line=${key}`;
  type DrawerRow = { month: string; value: number | null; src: string | null; forecast: boolean };
  type Drawer = { title: string; badge?: string; desc: string; how: string; edit: { href: string; label: string }; rows: DrawerRow[] };

  const buildDrawer = (key: string): Drawer | null => {
    const yoyIncome = cf.growthIncomePct != null ? `${cf.growthIncomePct >= 0 ? "+" : ""}${cf.growthIncomePct}%` : null;
    const yoyOther = cf.growthOtherPct != null ? `${cf.growthOtherPct >= 0 ? "+" : ""}${cf.growthOtherPct}%` : null;
    const modelRows = (k: "income" | "people" | "other"): DrawerRow[] =>
      allMonths.map((m) => {
        const c = colByMonth.get(m);
        if (!c) return { month: m, value: null, src: null, forecast: false };
        const v = k === "income" ? c.income : k === "people" ? c.people : c.other;
        const src = c.isForecast ? srcLabel(k === "income" ? c.incomeSrc : k === "people" ? c.peopleSrc : c.otherSrc) : "actual";
        return { month: m, value: v, src, forecast: c.isForecast };
      });
    const editGrid = { href: "/app/accounts/edit", label: "Edit in the grid" };
    if (key === "income")
      return {
        title: "Income", badge: "income",
        desc: "Money actually received (cash basis) — the same series as the Income column on the Cashflow dashboard. Actual months come from the Xero cash-basis P&L.",
        how: yoyIncome
          ? `Forecast months take last year's same month adjusted by the year-on-year growth of the current FY's complete months (${yoyIncome}), keeping seasonality. Months with no prior-year data fall back to the 3-month average. A value typed in the grid overrides the model for that month.`
          : "Forecast months use the average of the last 3 complete months (not enough prior-year data for a YoY comparison yet). A value typed in the grid overrides the model for that month.",
        edit: editGrid, rows: modelRows("income"),
      };
    if (key === "people")
      return {
        title: "People (salaries + contractors)", badge: "cost",
        desc: "Everyone paid — salaried staff, developers, contractors and freelancers, as one consistent series. Actual months come from the P&L staff + developer buckets.",
        how: "Forecast months pull the total gross from the Payroll capture grid (including CTC prefill for active staff). Where the grid has nothing for a month, the sum of active employees' CTC is used; failing that, the 3-month average. A typed grid value overrides the model.",
        edit: { href: "/app/payroll/capture", label: "Edit in Payroll capture" }, rows: modelRows("people"),
      };
    if (key === "other")
      return {
        title: "Other expenses", badge: "cost",
        desc: "All operating costs excluding people — rent, software, insurance, fees and the rest of the P&L. Actual months come from the Xero cash-basis P&L.",
        how: yoyOther
          ? `Forecast months take last year's same month adjusted by the current FY's year-on-year growth (${yoyOther}). Months with no prior-year data fall back to the 3-month average. A typed grid value overrides the model. Manual recurring expenses and SARS are separate lines in the model and not part of this row.`
          : "Forecast months use the average of the last 3 complete months. A typed grid value overrides the model. Manual recurring expenses and SARS are separate lines in the model and not part of this row.",
        edit: editGrid, rows: modelRows("other"),
      };
    if (key === "deals" && dealValues)
      return {
        title: "Deals — expected payments", badge: "income",
        desc: "Pipeline income from the Deals tracker: every deal that is not yet Paid and has an expected payment date lands here, at its invoice nett, in the month the money is expected.",
        how: "Read-only in the grid — set or change each deal's expected payment date and invoice nett on the Deals page. Marking a deal Paid removes it (the cash then shows up in Income actuals). It adds on top of the modelled income in forecast months.",
        edit: { href: "/app/accounts/deals", label: "Edit on the Deals page" },
        rows: allMonths.map((m) => ({ month: m, value: dealValues.get(m) ?? null, src: dealValues.get(m) ? "deals" : null, forecast: m > boundary })),
      };
    if (key.startsWith("adj_")) {
      const cat = adjCats.find((c2) => c2.id === key.slice(4));
      if (!cat) return null;
      return {
        title: cat.name, badge: cat.kind,
        desc: `A manual ${cat.kind} row you added — e.g. an outstanding project, pipeline item or once-off. It adds on top of the model in forecast months (actual months always come from the books).`,
        how: "Type amounts directly into the grid cells for the months it lands; clear a cell to remove it. Delete the whole row under “Add a row” below the grid.",
        edit: editGrid,
        rows: allMonths.map((m) => ({ month: m, value: entries.get(cat.id)?.get(m)?.amount ?? null, src: entries.get(cat.id)?.get(m) ? "manual" : null, forecast: m > boundary })),
      };
    }
    if (key === "net")
      return {
        title: "Net (model + grid)",
        desc: "The month's cash movement: Income plus additional income rows, minus People, Other expenses, manual recurring expenses, SARS payments and additional cost rows.",
        how: "Calculated — it refreshes when you save the grid, change the payroll, or a Xero sync updates the actuals. Red means the month burns cash.",
        edit: editGrid,
        rows: allMonths.map((m) => { const c = colByMonth.get(m); return { month: m, value: c?.net ?? null, src: null, forecast: c?.isForecast ?? false }; }),
      };
    if (key === "balance")
      return {
        title: "Cash balance",
        desc: "The running bank balance: the anchored opening balance plus every month's net movement since. This is the line the runway and the projected-balance KPI read from.",
        how: "Calculated — anchor or re-anchor the opening month and balance under Model settings on the Cashflow dashboard.",
        edit: { href: "/app/accounts", label: "Model settings on the dashboard" },
        rows: allMonths.map((m) => { const c = colByMonth.get(m); return { month: m, value: c?.balance ?? null, src: null, forecast: c?.isForecast ?? false }; }),
      };
    return null;
  };
  const drawer = line ? buildDrawer(line) : null;

  return (
    <Layout title="Forecast grid" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Accounts · Forecast grid</h1>
            <p class="muted" style="margin-top:0">
              Actuals through <strong>{label(boundary)}</strong> shown for context. Later months are the model's
              forecast (tag shows the source); type a value to override it. Additional rows add on top — e.g.
              outstanding project income.
            </p>
          </div>
          <a class="btn btn-sm" href="/app/accounts">← Cashflow dashboard</a>
        </div>

        <AccountsTabs active="grid" />

        {saved ? <div class="callout section-block">✓ Saved — dashboard, scenarios and runway updated.</div> : null}

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
                  {actualMonths.map((m) => <th class="muted">{shortLabel(m)}</th>)}
                  {months.map((m) => <th class="fc">{shortLabel(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr class="group"><td colspan={allMonths.length + 1}>Income / People / Other — actuals, then forecast (type to override; blank = model)</td></tr>
                {overrideCats.map((cat) => (
                  <tr>
                    <td style="text-align:left"><a href={lineHref(rowKind(cat.name))} title="What is this line?">{cat.name} <span class="muted" style="font-size:11px">ⓘ</span></a></td>
                    {actualMonths.map((m) => (
                      <td class="num muted">
                        {formatZAR(modelValue(cat.name, m))}<span class="cellhint"> actual</span>
                      </td>
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
                ))}
                <tr class="group"><td colspan={allMonths.length + 1}>Additional rows — projects, pipeline, once-offs</td></tr>
                {dealValues && dealValues.size > 0 ? (
                  <tr>
                    <td style="text-align:left">
                      <a href={lineHref("deals")} title="What is this line?">Deals — expected payments <span class="muted" style="font-size:11px">ⓘ</span></a> <span class="badge income">income</span>
                      <div class="cellhint">read-only · set per deal on the Deals page</div>
                    </td>
                    {actualMonths.map((m) => {
                      const v = dealValues.get(m);
                      return <td class="num muted">{v ? formatZAR(v) : "—"}</td>;
                    })}
                    {months.map((m) => {
                      const v = dealValues.get(m);
                      return <td class="num">{v ? formatZAR(v) : ""}</td>;
                    })}
                  </tr>
                ) : null}
                {adjCats.map((cat) => (
                  <tr>
                    <td style="text-align:left">
                      <a href={lineHref(`adj_${cat.id}`)} title="What is this line?">{cat.name} <span class="muted" style="font-size:11px">ⓘ</span></a> <span class={`badge ${cat.kind}`}>{cat.kind}</span>
                    </td>
                    {actualMonths.map(() => <td class="muted" style="text-align:center">—</td>)}
                    {months.map((m) => {
                      const v = entries.get(cat.id)?.get(m);
                      return (
                        <td>
                          <input type="text" inputmode="decimal" name={`e_${cat.id}_${m}`}
                            value={v ? String(v.amount) : ""} autocomplete="off" />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr class="total">
                  <td style="text-align:left"><a href={lineHref("net")} title="What is this line?">Net (model + grid) <span class="muted" style="font-size:11px">ⓘ</span></a></td>
                  {allMonths.map((m) => {
                    const c = colByMonth.get(m);
                    return <td class={`num ${c && c.net < 0 ? "neg" : ""}`}>{c ? formatZAR(c.net) : ""}</td>;
                  })}
                </tr>
                <tr class="total">
                  <td style="text-align:left"><a href={lineHref("balance")} title="What is this line?">Cash balance <span class="muted" style="font-size:11px">ⓘ</span></a></td>
                  {allMonths.map((m) => {
                    const c = colByMonth.get(m);
                    return <td class={`num ${c && c.balance < 0 ? "neg" : ""}`}>{c ? formatZAR(c.balance) : ""}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div class="toolbar">
            <button class="btn btn-primary" type="submit">Save grid</button>
            <span class="muted" style="font-size:12px">Totals refresh after saving. Clearing a cell returns it to the model.</span>
          </div>
        </form>

        <div class="card section-block">
          <h3>Add a row</h3>
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
      </div>

      {drawer ? (
        <>
          <a href="/app/accounts/edit" class="drawer-overlay" aria-label="Close details"></a>
          <aside class="drawer">
            <div class="row spread" style="align-items:flex-start">
              <h3>{drawer.title} {drawer.badge ? <span class={`badge ${drawer.badge}`}>{drawer.badge}</span> : null}</h3>
              <a href="/app/accounts/edit" class="btn btn-sm" title="Close">✕</a>
            </div>
            <p style="font-size:13px;margin-top:4px">{drawer.desc}</p>
            <p class="muted" style="font-size:13px"><strong>How it's calculated:</strong> {drawer.how}</p>
            <a class="btn btn-sm" href={drawer.edit.href} style="margin:4px 0 14px">✏️ {drawer.edit.label}</a>
            <table>
              <thead><tr><th>Month</th><th style="text-align:right">Value</th><th style="text-align:right">Source</th></tr></thead>
              <tbody>
                {drawer.rows.map((r) => (
                  <tr>
                    <td class={r.forecast ? "" : "muted"}>{label(r.month)}</td>
                    <td class={`num ${r.value != null && r.value < 0 ? "neg" : ""}`}>{r.value != null ? formatZAR(r.value) : "—"}</td>
                    <td class="num muted" style="font-size:11px">{r.src ?? (r.forecast ? "forecast" : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="muted" style="font-size:12px;margin-top:12px">Greyed months are actuals (books complete); the rest are forecast.</p>
          </aside>
        </>
      ) : null}
    </Layout>
  );
};
