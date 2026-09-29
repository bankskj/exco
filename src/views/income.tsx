import type { FC } from "hono/jsx";
import { Layout, AsAt, Info } from "./layout";
import type { PnL, PnLRow } from "../lib/xero";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fyLabel, fyRangeLabel } from "../lib/period";
import { comboBars, hBars } from "../lib/charts";

/** Finance section tabs — one home per question. */
export const FinanceTabs: FC<{ active: "overview" | "cash" | "pnl" | "receivables" | "forecast" | "costs" }> = ({ active }) => (
  <div class="segmented" style="margin:14px 0 4px">
    <a href="/app/finance" class={active === "overview" ? "seg active" : "seg"}>Overview</a>
    <a href="/app/finance/cash" class={active === "cash" ? "seg active" : "seg"}>Cash &amp; Liquidity</a>
    <a href="/app/finance/pnl" class={active === "pnl" ? "seg active" : "seg"}>Profit &amp; Loss</a>
    <a href="/app/finance/receivables" class={active === "receivables" ? "seg active" : "seg"}>Receivables</a>
    <a href="/app/finance/forecast" class={active === "forecast" ? "seg active" : "seg"}>Forecast</a>
    <a href="/app/finance/costs" class={active === "costs" ? "seg active" : "seg"}>Costs</a>
  </div>
);

export type ExpenseBucket = { key: string; title: string; rows: PnLRow[]; total: number[] };

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string; info?: string }> = ({ label, value, sub, tone, info }) => (
  <div class="kpi">
    <div class="k-label">{label} {info ? <Info text={info} /> : null}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

function deltaSub(cur: number, prior: number | null): { sub: string; tone: string } {
  if (prior == null || prior === 0) return { sub: "no prior-year data", tone: "" };
  const d = ((cur - prior) / Math.abs(prior)) * 100;
  return { sub: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}% vs prior year (${formatZAR(prior)})`, tone: d >= 0 ? "pos" : "neg" };
}

const BUCKET_COLORS: Record<string, string> = {
  employees: "#f6c453", contractors: "#c792ea", infra: "#4f8cff", software: "#6ee7b7",
  marketing: "#ff9f43", admin: "#ff6b6b", other: "#9aa7b4",
};

export const IncomePage: FC<{
  fy: number;
  fys: number[];
  pnl: PnL;
  prior: PnL | null;
  buckets: ExpenseBucket[];
  lastSync?: string | null;
  error?: string;
}> = ({ fy, fys, pnl, prior, buckets, lastSync, error }) => {
  const revenue = sum(pnl.incomeTotal);
  const expenses = sum(pnl.cosTotal) + sum(pnl.opexTotal);
  const net = revenue - expenses;
  const gp = revenue - sum(pnl.cosTotal);
  const gpm = pct(gp, revenue);
  const nm = pct(net, revenue);

  const pRevenue = prior ? sum(prior.incomeTotal) : null;
  const pExpenses = prior ? sum(prior.cosTotal) + sum(prior.opexTotal) : null;
  const pNet = pRevenue != null && pExpenses != null ? pRevenue - pExpenses : null;

  const combo = pnl.months.map((m, i) => ({
    label: shortLabel(m),
    income: pnl.incomeTotal[i],
    cost: pnl.cosTotal[i] + pnl.opexTotal[i],
    net: pnl.incomeTotal[i] - pnl.cosTotal[i] - pnl.opexTotal[i],
  }));

  return (
    <Layout title="Profit & Loss" authed section="finance" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Finance · Profit &amp; Loss</h1>
            <p class="muted" style="margin-top:0">
              Are we making or losing money? Straight from Xero's Profit &amp; Loss (accrual — what was invoiced and
              billed, not what's in the bank) — {fyLabel(fy)} to date ({fyRangeLabel(fy)}), against the same months last year.
            </p>
            <AsAt lastSync={lastSync} />
          </div>
          <div class="segmented">
            {fys.map((y) => (
              <a href={`/app/finance/pnl?fy=${y}`} class={fy === y ? "seg active" : "seg"} title={fyRangeLabel(y)}>
                {fyLabel(y)}
              </a>
            ))}
          </div>
        </div>

        <FinanceTabs active="pnl" />

        {error ? <div class="callout section-block" style="border-left-color:var(--danger)">{error}</div> : null}

        <div class="kpis section-block">
          <Kpi label="Revenue" value={formatZAR(revenue)} {...deltaSub(revenue, pRevenue)} info="Everything invoiced and earned this FY, whether or not it has been paid yet." />
          <Kpi label="Operating expenses" value={formatZAR(expenses)} {...(() => { const d = deltaSub(expenses, pExpenses); return { sub: d.sub, tone: d.tone === "pos" ? "neg" : d.tone === "neg" ? "pos" : "" }; })()} info="All costs recorded in Xero for the period — cost of sales plus overheads." />
          <Kpi label="Net profit" value={formatZAR(net)} tone={net < 0 ? "neg" : "pos"} sub={pNet != null ? `prior year: ${formatZAR(pNet)}` : undefined}
            info="Revenue less expenses. This is earnings, not cash — invoices and bills may be paid later." />
          <Kpi label="Margins" value={`Net ${nm}%`} sub={`Gross margin ${gpm}%`} tone={nm < 0 ? "neg" : ""} info="Net margin = net profit ÷ revenue. Gross margin excludes only cost of sales." />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Revenue vs expenses &amp; profit — {fyLabel(fy)} to date</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#3fb984"></span>Revenue</span>
              <span><span class="swatch" style="background:#ff6b6b"></span>Expenses</span>
              <span><span class="swatch" style="background:#4f8cff"></span>Profit</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: comboBars(combo, { height: 280 }) }} />
        </div>

        <div class="section-block">
          <h3>Where the money goes — cost categories</h3>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px">
            {buckets.filter((b) => sum(b.total) !== 0).map((b) => {
              const t = sum(b.total);
              return (
                <div class="card" style="align-self:start">
                  <h2 style="font-size:15px">{b.title}</h2>
                  <div class="k-value" style="font-size:20px">{formatZAR(t)}</div>
                  <div class="muted" style="font-size:12px">{pct(t, expenses)}% of expenses · avg {formatZAR(pnl.months.length ? t / pnl.months.length : 0)}/mo</div>
                  <div style="margin-top:12px" dangerouslySetInnerHTML={{
                    __html: hBars(
                      b.rows.map((r) => ({ label: r.name, value: sum(r.values) })).filter((r) => r.value !== 0).sort((a, b2) => b2.value - a.value).slice(0, 8),
                      { color: BUCKET_COLORS[b.key] ?? "#9aa7b4" },
                    ),
                  }} />
                </div>
              );
            })}
          </div>
        </div>

        <div class="section-block">
          <h3>Monthly performance</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr><th style="text-align:left">Month</th><th>Revenue</th><th>Expenses</th><th>Net profit</th><th>Cumulative profit</th><th>Net margin</th><th></th></tr>
              </thead>
              <tbody>
                {(() => { let cum = 0; return pnl.months.map((m, i) => {
                  const exp = pnl.cosTotal[i] + pnl.opexTotal[i];
                  const netM = pnl.incomeTotal[i] - exp;
                  cum += netM;
                  return (
                    <tr>
                      <td style="text-align:left">{label(m)}</td>
                      <td class="num">{formatZAR(pnl.incomeTotal[i])}</td>
                      <td class="num">{formatZAR(exp)}</td>
                      <td class={`num ${netM < 0 ? "neg" : "pos"}`}>{formatZAR(netM)}</td>
                      <td class={`num ${cum < 0 ? "neg" : "pos"}`}>{formatZAR(cum)}</td>
                      <td class={`num ${netM < 0 ? "neg" : ""}`}>{pct(netM, pnl.incomeTotal[i])}%</td>
                      <td><a href={`/app/finance/transactions?m=${m}`} class="muted" style="font-size:12px">view transactions →</a></td>
                    </tr>
                  );
                }); })()}
                <tr class="total">
                  <td style="text-align:left">Total</td>
                  <td class="num">{formatZAR(revenue)}</td>
                  <td class="num">{formatZAR(expenses)}</td>
                  <td class={`num ${net < 0 ? "neg" : "pos"}`}>{formatZAR(net)}</td>
                  <td class={`num ${net < 0 ? "neg" : "pos"}`}>{formatZAR(net)}</td>
                  <td class="num">{nm}%</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted" style="font-size:12px;margin-top:8px">
            Every figure here is <span class="badge actual">ACTUAL</span> from Xero. "View transactions" opens the
            underlying documents for that month.
          </p>
        </div>

        <div class="section-block">
          <h3>Drill down — every expense account</h3>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px">
            {buckets.filter((b) => b.rows.length > 0).map((b) => (
              <div class="card" style="align-self:start">
                <h3>{b.title}</h3>
                <table style="border-collapse:collapse;font-size:13px;width:100%">
                  <tbody>
                    {b.rows
                      .map((r) => ({ name: r.name, total: sum(r.values) }))
                      .sort((a, b2) => b2.total - a.total)
                      .map((r) => (
                        <tr>
                          <td style="padding:3px 12px 3px 0">{r.name}</td>
                          <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(r.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};
