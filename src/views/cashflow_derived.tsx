import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, StateBadge } from "./layout";
import type { DerivedCashflow } from "../lib/cashflow_engine";
import type { CFSettings } from "../lib/forecast";
import type { CashRisk } from "../lib/metrics";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf, fyLabel } from "../lib/period";
import { lineChart, comboBars } from "../lib/charts";
import { FinanceTabs } from "./income";

const srcLabel = (s: string): string =>
  s === "manual" ? "override" : s === "yoy" ? "YoY" : s === "payroll" ? "payroll" : s === "ctc" ? "payroll CTC" : "avg";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string; info?: string; badge?: "actual" | "forecast" | "estimate" | "manual" }> = ({ label, value, sub, tone, info, badge }) => (
  <div class="kpi">
    <div class="k-label">{label} {info ? <Info text={info} /> : null} {badge ? <StateBadge state={badge} /> : null}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

export const RISK_LABEL: Record<CashRisk, string> = {
  healthy: "Healthy",
  watch: "Watch",
  funding: "Funding required",
  overdrawn: "Overdrawn",
};

export const riskSub = (risk: CashRisk, fundingMonth: string | null, lowest: { month: string; balance: number }): string =>
  risk === "healthy" ? "Cash stays above zero through the forecast"
  : risk === "watch" ? `Lowest point ${formatZAR(lowest.balance)} in ${label(lowest.month)}`
  : risk === "overdrawn" ? "Estimated bank balance is already below zero"
  : `Forecast cash drops below zero in ${fundingMonth ? label(fundingMonth) : "—"}`;

export const CashLiquidityPage: FC<{
  cf: DerivedCashflow;
  settings: CFSettings;
  fy: number | null;
  fys: number[];
  bankEstimate: number;
  facility: { used: number; limit: number | null; available: number | null };
  liquidity: number | null;
  risk: CashRisk;
  fundingMonth: string | null;
  next30Net: number;
  receivablesOutstanding: number;
  commissionOwed: number;
  syncNote?: string;
  lastSync?: string | null;
  msg?: string;
}> = ({ cf, settings, fy, fys, bankEstimate, facility, liquidity, risk, fundingMonth, next30Net, receivablesOutstanding, commissionOwed, syncNote, lastSync, msg }) => {
  const walkAway = bankEstimate + receivablesOutstanding - facility.used - commissionOwed;
  const inFy = (m: string) => fy == null || fiscalYearOf(m) === fy;
  const visible = cf.columns.filter((c) => inFy(c.month));
  const boundary = settings.actuals_through;

  const balanceLine = visible.map((c) => ({ label: shortLabel(c.month), value: c.balance, forecast: c.isForecast }));
  const combo = visible.map((c) => ({ label: shortLabel(c.month), income: c.income, cost: c.cost, net: c.net, forecast: c.isForecast }));

  return (
    <Layout title="Cash & Liquidity" authed section="finance" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Finance · Cash &amp; Liquidity</h1>
            <p class="muted" style="margin-top:0">
              How much money do we have, and can we pay our bills? Everything here is cash — money actually received
              and paid. Actual months run through <strong>{label(boundary)}</strong>; later months come from the{" "}
              <a href="/app/finance/forecast">Forecast</a>.
            </p>
            <AsAt lastSync={lastSync} />
          </div>
          <a class="btn btn-sm" href="/app/accounts/export.csv" style="margin-top:16px">⬇ Export CSV</a>
        </div>

        {msg ? <div class="callout" style="margin-bottom:16px">{msg}</div> : null}
        {syncNote ? <div class="callout" style="margin-bottom:16px;border-left-color:var(--danger)">{syncNote}</div> : null}

        <FinanceTabs active="cash" />

        <div class="row spread section-block" style="align-items:center">
          <div class="segmented">
            <a href="/app/finance/cash?fy=all" class={fy == null ? "seg active" : "seg"}>All</a>
            {fys.map((y) => (
              <a href={`/app/finance/cash?fy=${y}`} class={fy === y ? "seg active" : "seg"}>{fyLabel(y)}</a>
            ))}
          </div>
          <span class={`risk ${risk}`} title={riskSub(risk, fundingMonth, cf.kpis.lowest)}>Cash risk: {RISK_LABEL[risk]}</span>
        </div>

        <div class="kpis section-block">
          <Kpi label="Bank balance" badge="estimate" value={formatZAR(bankEstimate)} tone={bankEstimate < 0 ? "neg" : "pos"}
            sub={`modelled from the ${label(settings.opening_period)} statement anchor`}
            info="Cash currently in the bank, estimated by the model: the anchored statement balance plus every cash movement since. Not a live bank feed." />
          <Kpi label="Credit facility" value={facility.limit != null ? `${formatZAR(facility.used)} of ${formatZAR(facility.limit)}` : formatZAR(facility.used)}
            sub={facility.available != null ? `${formatZAR(facility.available)} available` : "set the facility limit under Forecast → Assumptions to see headroom"}
            tone={facility.used > 0 ? "warn" : ""}
            info="Amount currently drawn on the revolving access facility." />
          <Kpi label="Available liquidity" value={liquidity != null ? formatZAR(liquidity) : "—"}
            tone={liquidity != null && liquidity < 0 ? "neg" : "pos"}
            sub="bank cash + undrawn facility"
            info="What could be paid tomorrow: estimated bank cash plus the undrawn part of the facility." />
          <Kpi label="Next 30 days" badge="forecast" value={formatZAR(next30Net)} tone={next30Net < 0 ? "neg" : "pos"}
            sub="expected receipts − expected payments"
            info="The next forecast month's net cash movement, from the Forecast model." />
          <Kpi label="Walk-away balance" badge="estimate" value={formatZAR(walkAway)} tone={walkAway < 0 ? "neg" : "pos"}
            sub="bank + invoices owed − facility − staff commission"
            info="Where we'd stand right now if every outstanding customer invoice was collected, the facility settled and owed commission paid out. The full calculation is at the bottom of this page." />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Cash position</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#4f8cff"></span>ACTUAL</span>
              <span style="font-weight:700">←&nbsp;|&nbsp;→</span>
              <span><span class="swatch" style="background:#4f8cff;opacity:.5"></span>FORECAST from {label(boundary)}</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: lineChart(balanceLine, { height: 260 }) }} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Cash received vs paid</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#3fb984"></span>Received</span>
              <span><span class="swatch" style="background:#ff6b6b"></span>Paid</span>
              <span><span class="swatch" style="background:#4f8cff"></span>Net</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: comboBars(combo, { height: 280 }) }} />
        </div>

        <div class="section-block">
          <h3>Cash movements by month</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Month</th><th>Cash received</th><th>People paid</th>
                  <th>Other paid</th><th>SARS (tax)</th><th>Recurring (manual)</th><th>Adjustments</th><th>Net movement</th><th>Closing cash</th><th></th>
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
                    <td>{c.isForecast ? <span class="badge forecast">FORECAST</span> : <span class="badge actual">ACTUAL</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="muted" style="font-size:12px;margin-top:8px">
            Closing cash rolls forward: each month's closing balance is the previous month's closing plus the net
            movement. The invoiced/accrual view that matches Xero's net profit is on{" "}
            <a href="/app/finance/pnl">Profit &amp; Loss</a>; every document behind a month is in{" "}
            <a href="/app/finance/transactions">Transaction Detail</a>.
          </p>
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Walk-away balance — the calculation, shown in full</h3>
            <span class="muted" style="font-size:12px">analytic view — debtors are not cash until collected</span>
          </div>
          <div class="kpis" style="margin-top:14px">
            <div class="kpi"><div class="k-label">Bank balance <StateBadge state="estimate" /></div><div class={`k-value ${bankEstimate < 0 ? "neg" : "pos"}`}>{formatZAR(bankEstimate)}</div><div class="k-sub muted">anchored {label(settings.opening_period)} at {formatZAR(settings.opening_balance)}</div></div>
            <div class="kpi"><div class="k-label">+ Amount owed by customers</div><div class="k-value warn">{formatZAR(receivablesOutstanding)}</div><div class="k-sub muted"><a href="/app/finance/receivables">open invoices</a> — credit notes not netted</div></div>
            <div class="kpi"><div class="k-label">− Credit facility used</div><div class="k-value neg">{formatZAR(facility.used)}</div><div class="k-sub muted">owed on the access facility</div></div>
            <div class="kpi"><div class="k-label">− Commission owed to staff</div><div class="k-value neg">{formatZAR(commissionOwed)}</div><div class="k-sub muted"><a href="/app/pipeline">invoiced/paid deals</a></div></div>
            <div class="kpi"><div class="k-label">= Walk-away balance</div><div class={`k-value ${walkAway < 0 ? "neg" : "pos"}`}>{formatZAR(walkAway)}</div><div class="k-sub muted">only if every debtor pays, the facility is settled and commission paid</div></div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
