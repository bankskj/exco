import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { CFCategory, CFSettings, Forecast } from "../lib/forecast";
import { formatZAR } from "../lib/money";
import { label, shortLabel } from "../lib/period";

export type EntryMap = Map<string, Map<string, { amount: number; status: string }>>;

export const CashflowEditor: FC<{
  categories: CFCategory[];
  entries: EntryMap;
  forecast: Forecast;
  settings: CFSettings;
  actualsThrough: string;
}> = ({ categories, entries, forecast, settings, actualsThrough }) => {
  const periods = forecast.timeline;
  const income = categories.filter((c) => c.kind === "income");
  const cost = categories.filter((c) => c.kind === "cost");
  const colByPeriod = new Map(forecast.base.map((c) => [c.period, c]));

  const renderRow = (cat: CFCategory) => (
    <tr>
      <td>
        {cat.name}
        {cat.is_recurring ? <span class="badge recurring" style="margin-left:6px">recurring</span> : null}
      </td>
      {periods.map((p) => {
        const real = entries.get(cat.id)?.get(p);
        const isForecast = p > actualsThrough;
        const projected = colByPeriod.get(p)?.cells[cat.id];
        const placeholder = !real && isForecast && projected ? String(Math.round(projected.amount)) : "";
        return (
          <td class={isForecast ? "fc" : ""}>
            <input type="text" inputmode="decimal" name={`e_${cat.id}_${p}`}
              value={real ? String(real.amount) : ""} placeholder={placeholder} autocomplete="off" />
          </td>
        );
      })}
    </tr>
  );

  const totalsRow = (kind: "income" | "cost" | "net" | "balance", cls: string) => (
    <tr class={cls}>
      <td>{kind === "income" ? "Total income" : kind === "cost" ? "Total cost" : kind === "net" ? "Net" : "Cash balance"}</td>
      {periods.map((p) => {
        const col = colByPeriod.get(p);
        const v = col ? col[kind] : 0;
        return <td class={`num ${(kind === "net" || kind === "balance") && v < 0 ? "neg" : ""}`}>{formatZAR(v)}</td>;
      })}
    </tr>
  );

  return (
    <Layout title="Edit cashflow" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <p style="margin:12px 0 0"><a href="/app/accounts">← Cashflow dashboard</a></p>
            <h1 style="margin-top:8px">Edit &amp; forecast</h1>
          </div>
        </div>

        <div class="callout section-block">
          <strong>How the forecast works.</strong> Months up to <strong>{label(actualsThrough)}</strong> are
          <em> actuals</em>. After that, each line is projected: <span class="badge recurring">recurring</span> lines
          carry the last value forward, others use a 3-month trailing average. A greyed number is the projection —
          type over any future cell to override it. Blank a cell to clear it.
        </div>

        <form method="post" action="/app/accounts/save">
          <div class="tablewrap section-block">
            <table class="grid fixed" style={`min-width:${220 + periods.length * 104}px`}>
              <colgroup>
                <col style="width:220px" />
                {periods.map(() => <col style="width:104px" />)}
              </colgroup>
              <thead>
                <tr>
                  <th>Line item</th>
                  {periods.map((p) => (
                    <th>{shortLabel(p)}{p > actualsThrough ? <div class="cellhint">fcast</div> : null}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr class="group"><td colspan={periods.length + 1}>Income</td></tr>
                {income.map(renderRow)}
                {totalsRow("income", "total")}
                <tr class="group"><td colspan={periods.length + 1}>Costs</td></tr>
                {cost.map(renderRow)}
                {totalsRow("cost", "total")}
                {totalsRow("net", "total")}
                {totalsRow("balance", "total")}
              </tbody>
            </table>
          </div>
          <div class="toolbar">
            <button class="btn btn-primary" type="submit">Save all</button>
            <span class="muted" style="font-size:12px">Totals refresh after saving.</span>
          </div>
        </form>

        <CategoryManager categories={categories} />
        <SettingsForm settings={settings} actualsThrough={actualsThrough} />
      </div>
    </Layout>
  );
};

const CategoryManager: FC<{ categories: CFCategory[] }> = ({ categories }) => (
  <div class="section-block card">
    <h3>Line items</h3>
    <form method="post" action="/app/accounts/category" class="formgrid" style="margin-bottom:18px">
      <div><label>Name</label><input type="text" name="name" required /></div>
      <div><label>Type</label>
        <select name="kind"><option value="income">income</option><option value="cost">cost</option></select>
      </div>
      <div><label>Group</label><input type="text" name="grp" placeholder="e.g. Recurring income" /></div>
      <div><label>Recurring?</label>
        <select name="is_recurring"><option value="0">no</option><option value="1">yes — carry forward</option></select>
      </div>
      <div><button class="btn btn-primary" type="submit">Add line item</button></div>
    </form>
    <div class="tablewrap">
      <table class="grid">
        <thead><tr><th>Name</th><th>Type</th><th>Group</th><th>Recurring</th><th></th></tr></thead>
        <tbody>
          {categories.map((c) => (
            <tr>
              <td>{c.name}</td>
              <td><span class={`badge ${c.kind}`}>{c.kind}</span></td>
              <td class="muted">{c.grp || "—"}</td>
              <td>{c.is_recurring ? "yes" : "no"}</td>
              <td>
                <form method="post" action="/app/accounts/category/delete" style="margin:0"
                  onsubmit="return confirm('Delete this line item and all its values?')">
                  <input type="hidden" name="id" value={c.id} />
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

const SettingsForm: FC<{ settings: CFSettings; actualsThrough: string }> = ({ settings, actualsThrough }) => (
  <div class="section-block card">
    <h3>Forecast settings</h3>
    <form method="post" action="/app/accounts/settings" class="formgrid">
      <div><label>Opening cash balance</label><input type="text" inputmode="decimal" name="opening_balance" value={String(settings.opening_balance)} /></div>
      <div><label>Opening month (YYYY-MM)</label><input type="text" name="opening_period" value={settings.opening_period} /></div>
      <div><label>Actuals locked through (YYYY-MM)</label><input type="text" name="actuals_through" value={actualsThrough} /></div>
      <div><label>Forecast horizon (months)</label><input type="number" name="horizon_months" value={String(settings.horizon_months)} /></div>
      <div><label>Best case · income +%</label><input type="number" name="best_income_pct" value={String(settings.best_income_pct)} /></div>
      <div><label>Best case · cost −%</label><input type="number" name="best_cost_pct" value={String(settings.best_cost_pct)} /></div>
      <div><label>Worst case · income −%</label><input type="number" name="worst_income_pct" value={String(settings.worst_income_pct)} /></div>
      <div><label>Worst case · cost +%</label><input type="number" name="worst_cost_pct" value={String(settings.worst_cost_pct)} /></div>
      <div class="full"><button class="btn btn-primary" type="submit">Save settings</button></div>
    </form>
  </div>
);
