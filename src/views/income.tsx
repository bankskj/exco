import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { PnL, PnLRow } from "../lib/xero";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fyLabel, fyRangeLabel } from "../lib/period";
import { comboBars, hBars } from "../lib/charts";

export const AccountsTabs: FC<{ active: "cashflow" | "income" | "grid" | "deals" }> = ({ active }) => (
  <div class="segmented" style="margin:14px 0 4px">
    <a href="/app/accounts" class={active === "cashflow" ? "seg active" : "seg"}>Cashflow</a>
    <a href="/app/accounts/edit" class={active === "grid" ? "seg active" : "seg"}>Forecast grid</a>
    <a href="/app/accounts/income" class={active === "income" ? "seg active" : "seg"}>Income</a>
    <a href="/app/accounts/deals" class={active === "deals" ? "seg active" : "seg"}>Deals</a>
  </div>
);

export type ExpenseBucket = { key: "staff" | "dev" | "other"; title: string; rows: PnLRow[]; total: number[] };

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

function deltaSub(cur: number, prior: number | null): { sub: string; tone: string } {
  if (prior == null || prior === 0) return { sub: "no prior-year data", tone: "" };
  const d = ((cur - prior) / Math.abs(prior)) * 100;
  return { sub: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}% vs prior year (${formatZAR(prior)})`, tone: d >= 0 ? "pos" : "neg" };
}

export const IncomePage: FC<{
  fy: number;
  fys: number[];
  pnl: PnL;
  prior: PnL | null;
  buckets: ExpenseBucket[];
  error?: string;
}> = ({ fy, fys, pnl, prior, buckets, error }) => {
  const income = sum(pnl.incomeTotal);
  const expenses = sum(pnl.cosTotal) + sum(pnl.opexTotal);
  const net = income - expenses;
  const gp = income - sum(pnl.cosTotal);
  const gpm = pct(gp, income);
  const nim = pct(net, income);

  const pIncome = prior ? sum(prior.incomeTotal) : null;
  const pExpenses = prior ? sum(prior.cosTotal) + sum(prior.opexTotal) : null;
  const pNet = pIncome != null && pExpenses != null ? pIncome - pExpenses : null;

  const combo = pnl.months.map((m, i) => ({
    label: shortLabel(m),
    income: pnl.incomeTotal[i],
    cost: pnl.cosTotal[i] + pnl.opexTotal[i],
    net: pnl.incomeTotal[i] - pnl.cosTotal[i] - pnl.opexTotal[i],
  }));

  return (
    <Layout title="Income" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Accounts · Income</h1>
            <p class="muted" style="margin-top:0">
              Straight from Xero's Profit &amp; Loss — {fyLabel(fy)} to date ({fyRangeLabel(fy)}), compared with the same
              months a year earlier.
            </p>
          </div>
          <div class="segmented">
            {fys.map((y) => (
              <a href={`/app/accounts/income?fy=${y}`} class={fy === y ? "seg active" : "seg"} title={fyRangeLabel(y)}>
                {fyLabel(y)}
              </a>
            ))}
          </div>
        </div>

        <AccountsTabs active="income" />

        {error ? <div class="callout section-block" style="border-left-color:var(--danger)">{error}</div> : null}

        <div class="kpis section-block">
          <Kpi label="Total income" value={formatZAR(income)} {...deltaSub(income, pIncome)} />
          <Kpi label="Total expenses" value={formatZAR(expenses)} {...(() => { const d = deltaSub(expenses, pExpenses); return { sub: d.sub, tone: d.tone === "pos" ? "neg" : d.tone === "neg" ? "pos" : "" }; })()} />
          <Kpi label="Net income" value={formatZAR(net)} tone={net < 0 ? "neg" : "pos"} sub={pNet != null ? `prior year: ${formatZAR(pNet)}` : undefined} />
          <Kpi label="Margins" value={`GP ${gpm}%`} sub={`Net income margin ${nim}%`} tone={nim < 0 ? "neg" : ""} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Income vs expenses &amp; net — {fyLabel(fy)} to date</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#3fb984"></span>Income</span>
              <span><span class="swatch" style="background:#ff6b6b"></span>Expenses</span>
              <span><span class="swatch" style="background:#4f8cff"></span>Net</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: comboBars(combo, { height: 280 }) }} />
        </div>

        <div class="section-block">
          <h3>Expenses split — staff vs dev/freelancers vs the rest</h3>
          <div class="grid grid-3">
            {buckets.map((b) => {
              const t = sum(b.total);
              return (
                <div class="card">
                  <h2 style="font-size:16px">{b.title}</h2>
                  <div class="k-value" style="font-size:22px">{formatZAR(t)}</div>
                  <div class="muted" style="font-size:12px">{pct(t, expenses)}% of expenses · avg {formatZAR(pnl.months.length ? t / pnl.months.length : 0)}/mo</div>
                  <div style="margin-top:12px" dangerouslySetInnerHTML={{
                    __html: hBars(
                      b.rows.map((r) => ({ label: r.name, value: sum(r.values) })).sort((a, b2) => b2.value - a.value).slice(0, 8),
                      { color: b.key === "staff" ? "#f6c453" : b.key === "dev" ? "#c792ea" : "#ff6b6b" },
                    ),
                  }} />
                </div>
              );
            })}
          </div>
        </div>

        <div class="section-block">
          <h3>Monthly summary</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr><th style="text-align:left">Month</th><th>Income</th><th>Staff</th><th>Dev / freelance</th><th>Other expenses</th><th>Total expenses</th><th>Net</th><th>Cumulative net</th><th>NI margin</th></tr>
              </thead>
              <tbody>
                {(() => { let cum = 0; return pnl.months.map((m, i) => {
                  const exp = pnl.cosTotal[i] + pnl.opexTotal[i];
                  const netM = pnl.incomeTotal[i] - exp;
                  cum += netM;
                  const staff = buckets.find((b) => b.key === "staff")!.total[i];
                  const dev = buckets.find((b) => b.key === "dev")!.total[i];
                  const other = buckets.find((b) => b.key === "other")!.total[i];
                  return (
                    <tr>
                      <td style="text-align:left">{label(m)}</td>
                      <td class="num">{formatZAR(pnl.incomeTotal[i])}</td>
                      <td class="num">{formatZAR(staff)}</td>
                      <td class="num">{formatZAR(dev)}</td>
                      <td class="num">{formatZAR(other)}</td>
                      <td class="num">{formatZAR(exp)}</td>
                      <td class={`num ${netM < 0 ? "neg" : "pos"}`}>{formatZAR(netM)}</td>
                      <td class={`num ${cum < 0 ? "neg" : "pos"}`}>{formatZAR(cum)}</td>
                      <td class={`num ${netM < 0 ? "neg" : ""}`}>{pct(netM, pnl.incomeTotal[i])}%</td>
                    </tr>
                  );
                }); })()}
                <tr class="total">
                  <td style="text-align:left">Total</td>
                  <td class="num">{formatZAR(income)}</td>
                  <td class="num">{formatZAR(sum(buckets.find((b) => b.key === "staff")!.total))}</td>
                  <td class="num">{formatZAR(sum(buckets.find((b) => b.key === "dev")!.total))}</td>
                  <td class="num">{formatZAR(sum(buckets.find((b) => b.key === "other")!.total))}</td>
                  <td class="num">{formatZAR(expenses)}</td>
                  <td class={`num ${net < 0 ? "neg" : "pos"}`}>{formatZAR(net)}</td>
                  <td class={`num ${net < 0 ? "neg" : "pos"}`}>{formatZAR(net)}</td>
                  <td class="num">{nim}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="section-block">
          <h3>Drill down — every expense account</h3>
          <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:18px">
            {buckets.map((b) => (
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
