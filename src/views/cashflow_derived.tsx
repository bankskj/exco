import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { DerivedCashflow } from "../lib/cashflow_engine";
import type { CFSettings } from "../lib/forecast";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf, fyLabel } from "../lib/period";
import { lineChart, comboBars } from "../lib/charts";
import { AccountsTabs } from "./income";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

export const CashflowDerivedPage: FC<{
  cf: DerivedCashflow;
  settings: CFSettings;
  fy: number | null;
  fys: number[];
  syncNote?: string;
  saved?: boolean;
}> = ({ cf, settings, fy, fys, syncNote, saved }) => {
  const inFy = (m: string) => fy == null || fiscalYearOf(m) === fy;
  const visible = cf.columns.filter((c) => inFy(c.month));
  const boundary = settings.actuals_through;
  const rw = cf.kpis;
  const net = rw.avgMonthlyNet;

  const balanceLine = visible.map((c) => ({ label: shortLabel(c.month), value: c.balance, forecast: c.isForecast }));
  const combo = visible.map((c) => ({ label: shortLabel(c.month), income: c.income, cost: c.cost, net: c.net, forecast: c.isForecast }));

  return (
    <Layout title="Accounts — Cashflow" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Accounts · Cashflow</h1>
            <p class="muted" style="margin-top:0">
              Actuals from Xero P&amp;L through <strong>{label(boundary)}</strong> (books complete); forecast from the
              Payroll grid and the {cf.avgBasis.length}-month average of {cf.avgBasis.map(label).join(", ") || "—"}.
            </p>
          </div>
          <a class="btn btn-sm" href="/app/accounts/export.csv">⬇ Export CSV</a>
        </div>

        {saved ? <div class="callout" style="margin-bottom:16px">✓ Saved.</div> : null}
        {syncNote ? <div class="callout" style="margin-bottom:16px;border-left-color:var(--danger)">{syncNote}</div> : null}

        <AccountsTabs active="cashflow" />

        <div class="row spread section-block" style="align-items:center">
          <div class="segmented">
            <a href="/app/accounts" class={fy == null ? "seg active" : "seg"}>All</a>
            {fys.map((y) => (
              <a href={`/app/accounts?fy=${y}`} class={fy === y ? "seg active" : "seg"}>{fyLabel(y)}</a>
            ))}
          </div>
          <form method="post" action="/app/accounts/actuals-through" class="row" style="gap:8px;margin:0">
            <label style="margin:0">Books complete through</label>
            <select name="actuals_through" style="width:auto;padding:8px 12px">
              {cf.months.filter((m) => m <= new Date().toISOString().slice(0, 7)).map((m) => (
                <option value={m} selected={m === boundary}>{label(m)}</option>
              ))}
            </select>
            <button class="btn btn-sm btn-primary" type="submit">Set</button>
          </form>
        </div>

        <div class="kpis section-block">
          <Kpi label="Cash on hand (model)" value={formatZAR(rw.currentCash)} sub={`As at ${label(boundary)}`} tone={rw.currentCash < 0 ? "neg" : ""} />
          <Kpi label={net >= 0 ? "Avg monthly surplus" : "Avg monthly burn"} value={formatZAR(Math.abs(net))} tone={net >= 0 ? "pos" : "neg"} sub={`Avg of ${cf.avgBasis.map(shortLabel).join(", ")}`} />
          <Kpi label="Runway" value={rw.runwayMonths == null ? "Cash-positive" : `${rw.runwayMonths} mo`}
            tone={rw.runwayMonths == null ? "pos" : rw.runwayMonths <= 6 ? "neg" : "warn"}
            sub={rw.runwayMonth ? `Cash out ${label(rw.runwayMonth)}` : "Stays above zero through the forecast"} />
          <Kpi label="Projected balance" value={formatZAR(rw.projectedEndBalance)} tone={rw.projectedEndBalance < 0 ? "neg" : "pos"}
            sub={`End of forecast · low ${formatZAR(rw.lowest.balance)} (${label(rw.lowest.month)})`} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Cash balance &amp; runway</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#4f8cff"></span>Actual</span>
              <span><span class="swatch" style="background:#4f8cff;opacity:.5"></span>Forecast</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: lineChart(balanceLine, { height: 260 }) }} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Income vs costs &amp; net</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#3fb984"></span>Income</span>
              <span><span class="swatch" style="background:#ff6b6b"></span>Costs</span>
              <span><span class="swatch" style="background:#4f8cff"></span>Net</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: comboBars(combo, { height: 280 }) }} />
        </div>

        <div class="section-block">
          <h3>Scenarios</h3>
          <div class="grid grid-3">
            {(["base", "best", "worst"] as const).map((k) => {
              const sc = cf.scenarios[k];
              const note = k === "base" ? "Payroll grid + 3-month averages" : k === "best"
                ? `Income +${settings.best_income_pct}% · costs −${settings.best_cost_pct}%`
                : `Income −${settings.worst_income_pct}% · costs +${settings.worst_cost_pct}%`;
              return (
                <div class="card">
                  <h2 style="font-size:16px">{k === "base" ? "Base case" : k === "best" ? "Best case" : "Worst case"}</h2>
                  <div class={`k-value ${k === "best" ? "pos" : k === "worst" ? "neg" : ""}`} style="font-size:22px">{formatZAR(sc.endBalance)}</div>
                  <div class="muted" style="font-size:12px">projected end balance</div>
                  <div style="margin-top:12px;font-size:13px">
                    <div class="row spread"><span class="muted">Lowest point</span><span class={sc.lowest.balance < 0 ? "neg" : ""}>{formatZAR(sc.lowest.balance)}</span></div>
                    <div class="row spread"><span class="muted">Cash-out</span><span class={sc.runwayMonth ? "neg" : "pos"}>{sc.runwayMonth ? label(sc.runwayMonth) : "never"}</span></div>
                  </div>
                  <p class="muted" style="font-size:11px;margin:12px 0 0">{note}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div class="section-block">
          <h3>Monthly detail — interlocked rows</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Month</th><th>Income (P&amp;L)</th><th>People (salaries + contractors)</th>
                  <th>Other expenses</th><th>Recurring (manual)</th><th>Grid adj.</th><th>Net</th><th>Balance</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr>
                    <td style="text-align:left">{label(c.month)}</td>
                    <td class="num">{formatZAR(c.income)}{c.isForecast ? <span class="cellhint"> {c.incomeSrc === "manual" ? "manual" : "avg"}</span> : null}</td>
                    <td class="num">{formatZAR(c.people)}{c.isForecast ? <span class="cellhint"> {c.peopleSrc === "manual" ? "manual" : c.peopleSrc === "payroll" ? "payroll grid" : "avg"}</span> : null}</td>
                    <td class="num">{formatZAR(c.other)}{c.isForecast ? <span class="cellhint"> {c.otherSrc === "manual" ? "manual" : "avg"}</span> : null}</td>
                    <td class="num">{formatZAR(c.recurring)}</td>
                    <td class={`num ${c.adjIncome - c.adjCost < 0 ? "neg" : ""}`}>{c.adjIncome || c.adjCost ? formatZAR(c.adjIncome - c.adjCost) : "—"}</td>
                    <td class={`num ${c.net < 0 ? "neg" : "pos"}`}>{formatZAR(c.net)}</td>
                    <td class={`num ${c.balance < 0 ? "neg" : ""}`}>{formatZAR(c.balance)}</td>
                    <td>{c.isForecast ? <span class="badge forecast">forecast</span> : <span class="badge actual">actual</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="muted" style="font-size:12px;margin-top:8px">
            Actual months come from Xero's P&amp;L (matches the Income tab); <em>People</em> = salary accounts +
            developer/contractor accounts combined, because most of the team is paid on contractor invoices — the
            Payroll grid covers the same people, which is why it drives the forecast (tagged <em>payroll grid</em>;
            months beyond the grid fall back to the 3-month average). Income and other expenses forecast at the
            average of the last three complete months. The staff-vs-dev split by account lives on the Income tab.
          </p>
        </div>

        <div class="card section-block">
          <h3>Model settings</h3>
          <form method="post" action="/app/accounts/settings" class="formgrid">
            <div><label>Opening cash balance</label><input type="text" inputmode="decimal" name="opening_balance" value={String(settings.opening_balance)} /></div>
            <div><label>Opening month (YYYY-MM)</label><input type="text" name="opening_period" value={settings.opening_period} /></div>
            <div><label>Forecast horizon (months)</label><input type="number" name="horizon_months" value={String(settings.horizon_months)} /></div>
            <div><label>Best · income +%</label><input type="number" name="best_income_pct" value={String(settings.best_income_pct)} /></div>
            <div><label>Best · costs −%</label><input type="number" name="best_cost_pct" value={String(settings.best_cost_pct)} /></div>
            <div><label>Worst · income −%</label><input type="number" name="worst_income_pct" value={String(settings.worst_income_pct)} /></div>
            <div><label>Worst · costs +%</label><input type="number" name="worst_cost_pct" value={String(settings.worst_cost_pct)} /></div>
            <div><button class="btn btn-primary" type="submit">Save settings</button></div>
          </form>
          <p class="muted" style="font-size:12px;margin-top:10px">
            The old manual grid still exists at <a href="/app/accounts/edit">/app/accounts/edit</a> for reference, but
            this derived model is the live one.
          </p>
        </div>
      </div>
    </Layout>
  );
};
