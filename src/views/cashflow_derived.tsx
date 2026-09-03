import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { DerivedCashflow } from "../lib/cashflow_engine";
import type { CFSettings } from "../lib/forecast";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf, fyLabel } from "../lib/period";
import { lineChart, comboBars } from "../lib/charts";
import { AccountsTabs } from "./income";

const srcLabel = (s: string): string =>
  s === "manual" ? "override" : s === "yoy" ? "YoY" : s === "payroll" ? "payroll grid" : s === "ctc" ? "payroll CTC" : "avg";

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
  position: { bankToday: number; debtorsDue: number; revolving: number; month: string };
  collections: { month: string; invoiced: number; received: number; gap: number; stillDue: number | null }[];
  syncNote?: string;
  saved?: boolean;
}> = ({ cf, settings, fy, fys, collections, position, syncNote, saved }) => {
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
              Cash basis — money actually received and paid, the truth for the bank balance. For the P&L view that
              matches Xero, use the <a href="/app/accounts/income">Income tab</a>. Actuals through <strong>{label(boundary)}</strong>. Forecast: people from the Payroll grid (falling back to
              active-staff CTC); income{cf.growthIncomePct != null ? ` at last year's month ${cf.growthIncomePct >= 0 ? "+" : ""}${cf.growthIncomePct}% YoY` : " from the 3-month average"} and
              other expenses{cf.growthOtherPct != null ? ` at ${cf.growthOtherPct >= 0 ? "+" : ""}${cf.growthOtherPct}% YoY` : " from the 3-month average"}. Typed grid values show as <em>override</em>.
            </p>
          </div>
          <a class="btn btn-sm" href="/app/accounts/export.csv">⬇ Export CSV</a>
        </div>

        {saved ? <div class="callout" style="margin-bottom:16px">✓ Saved.</div> : null}
        {syncNote ? <div class="callout" style="margin-bottom:16px;border-left-color:var(--danger)">{syncNote}</div> : null}
        {settings.opening_balance === 1000000 && settings.opening_period <= "2025-03" ? (
          <div class="callout" style="margin-bottom:16px;border-left-color:#f6c453">
            <strong>Balance line not anchored yet.</strong> The running balance starts from a placeholder
            (R 1 000 000 at Mar 2025), so its level is meaningless — only the month-to-month movement is real.
            In <strong>Model settings</strong> below, set the opening month to a recent month and enter the actual
            bank balance at the start of it; every figure after that becomes a true bank trajectory.
          </div>
        ) : null}

        <AccountsTabs active="cashflow" />

        <div class="row spread section-block" style="align-items:center">
          <div class="segmented">
            <a href="/app/accounts?fy=all" class={fy == null ? "seg active" : "seg"}>All</a>
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
            <h3 style="margin:0">Net position — bank + debtors − facilities</h3>
            <span class="muted" style="font-size:12px">as at {label(position.month)}</span>
          </div>
          <div class="kpis" style="margin-top:14px">
            <div class="kpi"><div class="k-label">Bank (modelled)</div><div class={`k-value ${position.bankToday < 0 ? "neg" : "pos"}`}>{formatZAR(position.bankToday)}</div><div class="k-sub muted">anchored {label(settings.opening_period)} at {formatZAR(settings.opening_balance)}</div></div>
            <div class="kpi"><div class="k-label">+ Debtors outstanding</div><div class="k-value warn">{formatZAR(position.debtorsDue)}</div><div class="k-sub muted">live open invoice balances (credit notes not netted)</div></div>
            <div class="kpi"><div class="k-label">− Revolving facility</div><div class="k-value neg">{formatZAR(position.revolving)}</div><div class="k-sub muted">owed on access facility</div></div>
            {(() => { const net = position.bankToday + position.debtorsDue - position.revolving;
              return <div class="kpi"><div class="k-label">= Net position</div><div class={`k-value ${net < 0 ? "neg" : "pos"}`}>{formatZAR(net)}</div><div class="k-sub muted">if all debtors paid &amp; facility settled</div></div>; })()}
          </div>
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

        <CollectionsCard collections={collections} />

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
                  <th>Other expenses</th><th>SARS (cash)</th><th>Recurring (manual)</th><th>Grid adj.</th><th>Net</th><th>Balance</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr>
                    <td style="text-align:left">{label(c.month)}</td>
                    <td class="num">{formatZAR(c.income)}{c.isForecast ? <span class="cellhint"> {srcLabel(c.incomeSrc)}</span> : null}</td>
                    <td class="num">{formatZAR(c.people)}{c.isForecast ? <span class="cellhint"> {srcLabel(c.peopleSrc)}</span> : null}</td>
                    <td class="num">{formatZAR(c.other)}{c.isForecast ? <span class="cellhint"> {srcLabel(c.otherSrc)}</span> : null}</td>
                    <td class="num">{formatZAR(c.sars)}{c.isForecast ? <span class="cellhint"> avg</span> : null}</td>
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
            <div><label>Revolving facility owed (R)</label><input type="text" inputmode="decimal" name="revolving_owed" value={String(position.revolving)} /></div>
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

const CollectionsCard: FC<{ collections: { month: string; invoiced: number; received: number; gap: number; stillDue: number | null }[] }> = ({ collections }) => {
  if (collections.length === 0) return null;
  const totInvoiced = collections.reduce((s, r) => s + r.invoiced, 0);
  const totReceived = collections.reduce((s, r) => s + r.received, 0);
  const totGap = totInvoiced - totReceived;
  const ratePct = totInvoiced ? Math.round((totReceived / totInvoiced) * 100) : 100;
  const totDue = collections.reduce((s, r) => s + (r.stillDue ?? 0), 0);
  const latest = collections[collections.length - 1];
  const gapLine = collections.map((r) => ({ label: shortLabel(r.month), value: r.gap }));
  return (
    <div class="card section-block">
      <div class="row spread">
        <h3 style="margin:0">Collections gap — invoiced vs received</h3>
        <span class="muted" style="font-size:12px">gap = billing vs banking timing inside each month; 'still unpaid' is the live open balance per billing month</span>
      </div>
      <div class="kpis" style="margin:14px 0">
        <div class="kpi">
          <div class="k-label">Still unpaid today — real debtors</div>
          <div class={`k-value ${totDue > totInvoiced * 0.05 ? "warn" : "pos"}`}>{formatZAR(totDue)}</div>
          <div class="k-sub muted">open balances on these months' invoices</div>
        </div>
        <div class="kpi">
          <div class="k-label">Collected to date</div>
          {(() => { const r = totInvoiced ? Math.max(0, Math.min(100, Math.round(((totInvoiced - totDue) / totInvoiced) * 100))) : 100;
            return <div class={`k-value ${r < 85 ? "neg" : r < 95 ? "warn" : "pos"}`}>{r}%</div>; })()}
          <div class="k-sub muted">of {formatZAR(totInvoiced)} billed in the window</div>
        </div>
        <div class="kpi">
          <div class="k-label">Timing gap (window)</div>
          <div class="k-value warn">{formatZAR(totGap)}</div>
          <div class="k-sub muted">cash landed after month-end — not bad debt</div>
        </div>
        <div class="kpi">
          <div class="k-label">Latest month gap</div>
          <div class={`k-value ${latest.gap > 0 ? "warn" : "pos"}`}>{formatZAR(latest.gap)}</div>
          <div class="k-sub muted">{label(latest.month)}</div>
        </div>
      </div>
      <div dangerouslySetInnerHTML={{ __html: lineChart(gapLine, { height: 180, color: "#f6c453" }) }} />
      <div class="tablewrap" style="margin-top:12px">
        <table class="grid">
          <thead><tr><th style="text-align:left">Month</th><th>Invoiced (accrual)</th><th>Received (cash)</th><th>Gap</th><th>Collected</th><th>Still unpaid today</th></tr></thead>
          <tbody>
            {collections.map((r) => (
              <tr>
                <td style="text-align:left">{label(r.month)}</td>
                <td class="num">{formatZAR(r.invoiced)}</td>
                <td class="num">{formatZAR(r.received)}</td>
                <td class={`num ${r.gap > 0 ? "warn" : "pos"}`}>{formatZAR(r.gap)}</td>
                <td class="num">{r.invoiced ? Math.round((r.received / r.invoiced) * 100) : 100}%</td>
                <td class={`num ${(r.stillDue ?? 0) > 0 ? "warn" : "pos"}`}>{r.stillDue != null ? formatZAR(r.stillDue) : "—"}</td>
              </tr>
            ))}
            <tr class="total">
              <td style="text-align:left">Total</td>
              <td class="num">{formatZAR(totInvoiced)}</td>
              <td class="num">{formatZAR(totReceived)}</td>
              <td class={`num ${totGap > 0 ? "warn" : "pos"}`}>{formatZAR(totGap)}</td>
              <td class="num">{ratePct}%</td>
              <td class={`num ${totDue > 0 ? "warn" : "pos"}`}>{formatZAR(totDue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
