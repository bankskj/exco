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
  boundary: string;
  saved?: boolean;
}> = ({ cf, overrideCats, adjCats, entries, boundary, saved }) => {
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
                    <td style="text-align:left">{cat.name}</td>
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
                {adjCats.map((cat) => (
                  <tr>
                    <td style="text-align:left">
                      {cat.name} <span class={`badge ${cat.kind}`}>{cat.kind}</span>
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
                  <td style="text-align:left">Net (model + grid)</td>
                  {allMonths.map((m) => {
                    const c = colByMonth.get(m);
                    return <td class={`num ${c && c.net < 0 ? "neg" : ""}`}>{c ? formatZAR(c.net) : ""}</td>;
                  })}
                </tr>
                <tr class="total">
                  <td style="text-align:left">Cash balance</td>
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
    </Layout>
  );
};
