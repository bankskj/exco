import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { CFCategory, CFSettings, Forecast } from "../lib/forecast";
import { formatZAR } from "../lib/money";
import { label, shortLabel, fiscalYearOf, fyLabel, fyRangeLabel } from "../lib/period";
import { lineChart, comboBars, hBars } from "../lib/charts";
import { AccountsTabs } from "./income";

/** Fiscal-year (Mar–Feb) selector. fy=null means the full timeline. */
export const FySelector: FC<{ base: string; fys: number[]; fy: number | null }> = ({ base, fys, fy }) => (
  <div class="row" style="gap:10px;align-items:center">
    <div class="segmented">
      <a href={base} class={fy == null ? "seg active" : "seg"}>All</a>
      {fys.map((y) => (
        <a href={`${base}${base.includes("?") ? "&" : "?"}fy=${y}`} class={fy === y ? "seg active" : "seg"} title={fyRangeLabel(y)}>
          {fyLabel(y)}
        </a>
      ))}
    </div>
    {fy != null ? <span class="muted" style="font-size:12px">{fyRangeLabel(fy)}</span> : null}
  </div>
);

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

function runwayText(f: Forecast): { value: string; tone: string; sub: string } {
  const { runwayMonths, runwayPeriod } = f.kpis;
  if (runwayMonths == null) {
    return { value: "Cash-positive", tone: "pos", sub: "Balance stays above zero across the forecast" };
  }
  return {
    value: `${runwayMonths} mo`,
    tone: runwayMonths <= 6 ? "neg" : "warn",
    sub: `Cash runs out ${runwayPeriod ? label(runwayPeriod) : ""}`,
  };
}

export const CashflowDashboard: FC<{
  forecast: Forecast;
  categories: CFCategory[];
  settings: CFSettings;
  fys: number[];
  fy: number | null;
  saved?: boolean;
}> = ({ forecast, categories, settings, fys, fy, saved }) => {
  const rw = runwayText(forecast);
  const net = forecast.kpis.avgMonthlyNet;
  const inFy = (p: string) => fy == null || fiscalYearOf(p) === fy;
  const visibleCols = forecast.base.filter((c) => inFy(c.period));
  const balanceLine = forecast.scenarios.base.columns
    .filter((c) => inFy(c.period))
    .map((c) => ({
      label: shortLabel(c.period),
      value: c.balance,
      forecast: c.isForecast,
    }));
  const combo = visibleCols.map((c) => ({
    label: shortLabel(c.period),
    income: c.income,
    cost: c.cost,
    net: c.net,
    forecast: c.isForecast,
  }));

  // Category breakdown for the latest actual month.
  const latest = forecast.lastActual;
  const latestCol = forecast.base.find((c) => c.period === latest);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const incomeBreak: { label: string; value: number }[] = [];
  const costBreak: { label: string; value: number }[] = [];
  if (latestCol) {
    for (const [cid, cell] of Object.entries(latestCol.cells)) {
      const cat = catById.get(cid);
      if (!cat || cell.amount === 0) continue;
      (cat.kind === "income" ? incomeBreak : costBreak).push({ label: cat.name, value: cell.amount });
    }
    incomeBreak.sort((a, b) => b.value - a.value);
    costBreak.sort((a, b) => b.value - a.value);
  }

  const sc = forecast.scenarios;

  return (
    <Layout title="Accounts — Cashflow" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Accounts · Cashflow</h1>
            <p class="muted" style="margin-top:0">
              Actuals through <strong>{latest ? label(latest) : "—"}</strong>, forecast to{" "}
              <strong>{forecast.timeline.length ? label(forecast.timeline[forecast.timeline.length - 1]) : "—"}</strong>.
            </p>
          </div>
          <div class="row">
            <a class="btn btn-sm" href={fy != null ? `/app/accounts/export.csv?fy=${fy}` : "/app/accounts/export.csv"}>⬇ Export CSV</a>
            <a class="btn btn-sm btn-primary" href={fy != null ? `/app/accounts/edit?fy=${fy}` : "/app/accounts/edit"}>Edit &amp; forecast</a>
          </div>
        </div>

        {saved ? <div class="callout" style="margin-bottom:16px">✓ Saved.</div> : null}

        <AccountsTabs active="cashflow" />

        <div class="section-block"><FySelector base="/app/accounts" fys={fys} fy={fy} /></div>

        <div class="kpis section-block">
          <Kpi label="Cash on hand" value={formatZAR(forecast.kpis.currentCash)} sub={`As at ${latest ? label(latest) : "—"}`}
            tone={forecast.kpis.currentCash < 0 ? "neg" : ""} />
          <Kpi label={net >= 0 ? "Avg monthly surplus" : "Avg monthly burn"} value={formatZAR(Math.abs(net))}
            tone={net >= 0 ? "pos" : "neg"} sub="Trailing 3 actual months" />
          <Kpi label="Runway" value={rw.value} tone={rw.tone} sub={rw.sub} />
          <Kpi label="Projected balance" value={formatZAR(forecast.kpis.projectedEndBalance)}
            tone={forecast.kpis.projectedEndBalance < 0 ? "neg" : "pos"}
            sub={`End of forecast · low ${formatZAR(forecast.kpis.lowest.balance)}`} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Cash balance &amp; runway</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#4f8cff"></span>Actual</span>
              <span><span class="swatch" style="background:#4f8cff;opacity:.5"></span>Forecast</span>
              <span><span class="swatch" style="background:#ff6b6b"></span>Zero line</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: lineChart(balanceLine, { height: 260 }) }} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">Income vs cost &amp; net</h3>
            <div class="legend">
              <span><span class="swatch" style="background:#3fb984"></span>Income</span>
              <span><span class="swatch" style="background:#ff6b6b"></span>Cost</span>
              <span><span class="swatch" style="background:#4f8cff"></span>Net</span>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: comboBars(combo, { height: 280 }) }} />
        </div>

        <div class="section-block">
          <h3>Scenarios · projected end balance &amp; runway</h3>
          <div class="grid grid-3">
            <ScenarioCard title="Base case" tone="" end={sc.base.endBalance} rwPeriod={sc.base.runwayPeriod} lowest={sc.base.lowest.balance} note="Recurring carried forward; variable items on trailing average." />
            <ScenarioCard title="Best case" tone="pos" end={sc.best.endBalance} rwPeriod={sc.best.runwayPeriod} lowest={sc.best.lowest.balance} note={`Income +${settings.best_income_pct}% · cost −${settings.best_cost_pct}%`} />
            <ScenarioCard title="Worst case" tone="neg" end={sc.worst.endBalance} rwPeriod={sc.worst.runwayPeriod} lowest={sc.worst.lowest.balance} note={`Income −${settings.worst_income_pct}% · cost +${settings.worst_cost_pct}%`} />
          </div>
        </div>

        <div class="grid section-block" style="grid-template-columns:1fr 1fr;gap:18px">
          <div class="card">
            <h3>Income sources — {latest ? label(latest) : "—"}</h3>
            {incomeBreak.length ? <div dangerouslySetInnerHTML={{ __html: hBars(incomeBreak, { color: "#3fb984" }) }} /> : <p class="muted">No income recorded.</p>}
          </div>
          <div class="card">
            <h3>Cost drivers — {latest ? label(latest) : "—"}</h3>
            {costBreak.length ? <div dangerouslySetInnerHTML={{ __html: hBars(costBreak, { color: "#ff6b6b" }) }} /> : <p class="muted">No costs recorded.</p>}
          </div>
        </div>

        <MonthlySummary cols={visibleCols} />
      </div>
    </Layout>
  );
};

const ScenarioCard: FC<{ title: string; tone: string; end: number; rwPeriod: string | null; lowest: number; note: string }> = ({
  title,
  tone,
  end,
  rwPeriod,
  lowest,
  note,
}) => (
  <div class="card">
    <h2 style="font-size:16px">{title}</h2>
    <div class={`k-value ${tone}`} style="font-size:22px">{formatZAR(end)}</div>
    <div class="muted" style="font-size:12px;margin-top:2px">projected end balance</div>
    <div style="margin-top:12px;font-size:13px">
      <div class="row spread"><span class="muted">Lowest point</span><span class={lowest < 0 ? "neg" : ""}>{formatZAR(lowest)}</span></div>
      <div class="row spread"><span class="muted">Cash-out</span><span class={rwPeriod ? "neg" : "pos"}>{rwPeriod ? label(rwPeriod) : "never"}</span></div>
    </div>
    <p class="muted" style="font-size:11px;margin-top:12px;margin-bottom:0">{note}</p>
  </div>
);

const MonthlySummary: FC<{ cols: Forecast["base"] }> = ({ cols }) => (
  <div class="section-block">
    <h3>Monthly summary</h3>
    <div class="tablewrap">
      <table class="grid">
        <thead>
          <tr><th>Month</th><th>Income</th><th>Cost</th><th>Net</th><th>Cash balance</th><th></th></tr>
        </thead>
        <tbody>
          {cols.map((c) => (
            <tr>
              <td>{label(c.period)}</td>
              <td class="num">{formatZAR(c.income)}</td>
              <td class="num">{formatZAR(c.cost)}</td>
              <td class={`num ${c.net < 0 ? "neg" : "pos"}`}>{formatZAR(c.net)}</td>
              <td class={`num ${c.balance < 0 ? "neg" : ""}`}>{formatZAR(c.balance)}</td>
              <td>{c.isForecast ? <span class="badge forecast">forecast</span> : <span class="badge actual">actual</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
