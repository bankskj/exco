import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, StateBadge } from "./layout";
import type { Snapshot } from "../lib/metrics";
import { formatZAR } from "../lib/money";
import { label, fyLabel } from "../lib/period";
import { RISK_LABEL, riskSub } from "./cashflow_derived";

const Big: FC<{ href: string; label: string; value: string; tone?: string; badge?: "actual" | "forecast" | "estimate" | "manual"; info?: string; children?: unknown }> =
  ({ href, label: l, value, tone, badge, info, children }) => (
  <a class="card" href={href} style="color:var(--text);display:block">
    <div class="k-label" style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.4px">
      {l} {info ? <Info text={info} /> : null} {badge ? <StateBadge state={badge} /> : null}
    </div>
    <div class={`k-value ${tone ?? ""}`} style="font-size:28px;font-weight:700;margin-top:8px">{value}</div>
    <div style="margin-top:8px;font-size:13px">{children}</div>
  </a>
);

const Attention: FC<{ href: string; title: string; tone: string; children?: unknown }> = ({ href, title, tone, children }) => (
  <a class="card" href={href} style={`color:var(--text);display:block;border-left:3px solid ${tone}`}>
    <div style="font-weight:700;font-size:14px">{title}</div>
    <div class="muted" style="font-size:13px;margin-top:6px">{children}</div>
  </a>
);

export const Dashboard: FC<{ s: Snapshot; lastSyncLabel: string | null; msg?: string }> = ({ s, lastSyncLabel, msg }) => {
  const overdueShare = s.receivables.outstanding ? Math.round((s.receivables.overdue30 / s.receivables.outstanding) * 100) : 0;
  return (
    <Layout title="Overview" authed section="overview" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:16px">Overview</h1>
            <p class="muted" style="margin:0">How is the business doing? Click any card for the detail behind it.</p>
            <AsAt lastSync={lastSyncLabel} />
          </div>
          <div class="row" style="margin-top:20px">
            <form method="post" action="/app/expenses/sync" style="margin:0">
              <input type="hidden" name="back" value="overview" />
              <button class="btn btn-sm" type="submit">↻ Sync now</button>
            </form>
            <span class={`risk ${s.cash.risk}`} title={riskSub(s.cash.risk, s.cash.fundingMonth, s.cash.lowest)}>
              Cash risk: {RISK_LABEL[s.cash.risk]}
            </span>
          </div>
        </div>

        {msg ? <div class="callout" style="margin-top:16px">{msg}</div> : null}

        <div class="grid section-block" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
          <Big href="/app/finance/cash" label="Cash available" badge="estimate"
            value={formatZAR(s.cash.bankEstimate)} tone={s.cash.bankEstimate < 0 ? "neg" : "pos"}
            info="Estimated bank balance: the anchored statement balance plus every cash movement since. Not a live bank feed.">
            <span class="muted">bank balance as at {label(s.cash.asAtMonth)}</span>
            {s.liquidity != null ? <div class="muted">available liquidity {formatZAR(s.liquidity)} (incl. undrawn facility)</div> : null}
          </Big>

          <Big href="/app/finance/receivables" label="Outstanding customer invoices" badge="actual"
            value={formatZAR(s.receivables.outstanding)} tone="warn"
            info="Open balances on Xero sales invoices — money customers still owe us.">
            <div class="muted">Overdue 30+ days: <span class={s.receivables.overdue30 > 0 ? "warn" : ""}>{formatZAR(s.receivables.overdue30)}</span></div>
            <div class="muted">Raised in the last 30 days: {formatZAR(s.receivables.dueSoon)}</div>
          </Big>

          <Big href="/app/finance/pnl" label={`Profit ${fyLabel(s.profit.fy)}`} badge="actual"
            value={formatZAR(s.profit.netProfit)} tone={s.profit.netProfit < 0 ? "neg" : "pos"}
            info={`Revenue earned less expenses recorded in Xero over completed months (${label(s.profit.periodStart)}–${label(s.profit.periodEnd)}). The current month is excluded while it is still being invoiced and reconciled. Not cash — invoices and bills may be paid later.`}>
            <div class="muted">{s.profit.netMarginPct}% net margin · revenue {formatZAR(s.profit.revenue)}</div>
            <div class="muted">{label(s.profit.periodStart)} – {label(s.profit.periodEnd)} · completed months only</div>
          </Big>

          <Big href="/app/finance/forecast" label="Forecast cash low point" badge="forecast"
            value={formatZAR(s.cash.lowest.balance)} tone={s.cash.lowest.balance < 0 ? "neg" : "pos"}
            info={`The lowest projected bank balance within ${fyLabel(s.profit.fy)} (to end Feb), from the Forecast model. The Forecast page shows the full horizon.`}>
            <div class="muted">lowest projected balance in {fyLabel(s.profit.fy)} · {label(s.cash.lowest.month)}</div>
            {s.cash.fundingMonth ? <div class="warn">⚠ Funding pressure {s.cash.risk === "overdrawn" ? "now" : `begins ${label(s.cash.fundingMonth)}`}</div> : <div class="pos">cash stays above zero</div>}
          </Big>
        </div>

        <h3 class="section-block">Attention required</h3>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
          <Attention href="/app/finance/receivables" title="Collections" tone={overdueShare > 30 ? "var(--danger)" : "#f6c453"}>
            {formatZAR(s.receivables.outstanding)} outstanding across {s.receivables.openInvoices} invoice(s) ·{" "}
            {formatZAR(s.receivables.overdue30)} overdue 30+ days ({overdueShare}%)
          </Attention>
          <Attention href="/app/finance/forecast" title="Forecast" tone={s.cash.fundingMonth ? "var(--danger)" : "var(--accent-2)"}>
            {s.cash.fundingMonth
              ? `Cash below zero from ${label(s.cash.fundingMonth)} — lowest ${formatZAR(s.cash.lowest.balance)} in ${label(s.cash.lowest.month)}`
              : "Forecast cash stays above zero for the full horizon"}
          </Attention>
          <Attention href="/app/finance/pnl" title="Profitability" tone={s.profit.lossMonths > s.profit.monthsCounted / 2 ? "var(--danger)" : s.profit.lossMonths > 0 ? "#f6c453" : "var(--accent-2)"}>
            {s.profit.lossMonths} of the last {s.profit.monthsCounted} completed months were loss-making
          </Attention>
          <Attention href="/app/finance/costs" title="Costs" tone="var(--accent)">
            Recurring operating costs {formatZAR(s.costs.recurringMonthly)}/month across {s.costs.activeN} active item(s)
          </Attention>
        </div>

        <h3 class="section-block">Around the business</h3>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
          <a class="card" href="/app/pipeline" style="color:var(--text);display:block">
            <div class="row spread"><h2 style="margin:0;font-size:16px">🤝 Pipeline</h2><span class="muted" style="font-size:12px">open →</span></div>
            <div class="muted" style="font-size:13px;margin-top:8px">
              Potential {formatZAR(s.pipeline.potential)} · committed {formatZAR(s.pipeline.committed)} · billed {formatZAR(s.pipeline.billed)}
              <br />commission owed to staff {formatZAR(s.pipeline.commissionEarned)}{s.pipeline.commissionEstimated ? ` · potential ${formatZAR(s.pipeline.commissionEstimated)}` : ""}
            </div>
          </a>
          <a class="card" href="/app/payroll" style="color:var(--text);display:block">
            <div class="row spread"><h2 style="margin:0;font-size:16px">🧾 Payroll — {s.payroll.month ? label(s.payroll.month) : "—"}</h2><span class="muted" style="font-size:12px">open →</span></div>
            <div class="muted" style="font-size:13px;margin-top:8px">
              Gross {formatZAR(s.payroll.gross)} · nett {formatZAR(s.payroll.nett)} · {s.payroll.paid} people paid
            </div>
          </a>
          <a class="card" href="/app/hr" style="color:var(--text);display:block">
            <div class="row spread"><h2 style="margin:0;font-size:16px">👥 People</h2><span class="muted" style="font-size:12px">open →</span></div>
            <div class="muted" style="font-size:13px;margin-top:8px">
              {s.people.hrActive} employees · {s.people.contractors} contractors/international · {s.people.payrollPaid} paid last run
            </div>
          </a>
        </div>
      </div>
    </Layout>
  );
};
