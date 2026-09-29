import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, StateBadge } from "./layout";
import type { Snapshot } from "../lib/metrics";
import { formatZAR } from "../lib/money";
import { label, fyLabel } from "../lib/period";
import { FinanceTabs } from "./income";

const Line: FC<{ name: string; value: string; tone?: string; strong?: boolean }> = ({ name, value, tone, strong }) => (
  <div class="row spread" style={`font-size:${strong ? "15px" : "13px"};${strong ? "font-weight:700;border-top:1px solid var(--border);padding-top:8px;margin-top:8px" : ""}`}>
    <span class={strong ? "" : "muted"}>{name}</span>
    <span class={tone ?? ""} style="font-variant-numeric:tabular-nums">{value}</span>
  </div>
);

/**
 * Finance Overview — one simple bridge between profit and cash before the
 * detailed pages. Every figure comes from the canonical metrics snapshot.
 */
export const FinanceOverviewPage: FC<{ s: Snapshot; cashReceivedFy: number; cashPaidFy: number; invoicedFy: number; lastSyncLabel: string | null }> =
  ({ s, cashReceivedFy, cashPaidFy, invoicedFy, lastSyncLabel }) => (
  <Layout title="Finance" authed section="finance" wide>
    <div class="container">
      <h1 style="margin-top:12px">Finance</h1>
      <p class="muted" style="margin-top:0">
        <strong>Profit</strong> tells us whether the business earned money. <strong>Cash</strong> tells us whether the
        money has reached the bank. The four blocks below bridge the two — {fyLabel(s.profit.fy)},{" "}
        {label(s.profit.periodStart)} to {label(s.profit.periodEnd)}.
      </p>
      <AsAt lastSync={lastSyncLabel} />

      <FinanceTabs active="overview" />

      <div class="grid section-block" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
        <a class="card" href="/app/finance/pnl" style="color:var(--text);display:block">
          <h3>Profitability <StateBadge state="actual" /> <Info text="Accrual: what was invoiced and billed, from the Xero P&L. Are we making money?" /></h3>
          <Line name="Revenue" value={formatZAR(s.profit.revenue)} />
          <Line name="Expenses" value={formatZAR(s.profit.expenses)} />
          <Line name="Net profit" value={formatZAR(s.profit.netProfit)} tone={s.profit.netProfit < 0 ? "neg" : "pos"} strong />
          <div class="muted" style="font-size:12px;margin-top:8px">{s.profit.netMarginPct}% net margin → Profit &amp; Loss</div>
        </a>

        <a class="card" href="/app/finance/cash" style="color:var(--text);display:block">
          <h3>Cash movement <StateBadge state="actual" /> <Info text="Cash basis: money that actually arrived in and left the bank over the same period." /></h3>
          <Line name="Cash received" value={formatZAR(cashReceivedFy)} />
          <Line name="Cash paid" value={formatZAR(cashPaidFy)} />
          <Line name="Net cash movement" value={formatZAR(cashReceivedFy - cashPaidFy)} tone={cashReceivedFy - cashPaidFy < 0 ? "neg" : "pos"} strong />
          <div class="muted" style="font-size:12px;margin-top:8px">bank estimate {formatZAR(s.cash.bankEstimate)} → Cash &amp; Liquidity</div>
        </a>

        <a class="card" href="/app/finance/receivables" style="color:var(--text);display:block">
          <h3>Collections <StateBadge state="actual" /> <Info text="The gap between profit and cash usually sits here: invoiced but not yet collected." /></h3>
          <Line name="Invoices raised" value={formatZAR(invoicedFy)} />
          <Line name="Cash collected" value={formatZAR(cashReceivedFy)} />
          <Line name="Outstanding today" value={formatZAR(s.receivables.outstanding)} tone="warn" strong />
          <div class="muted" style="font-size:12px;margin-top:8px">{formatZAR(s.receivables.overdue30)} overdue 30+ days → Receivables</div>
        </a>

        <a class="card" href="/app/finance/forecast" style="color:var(--text);display:block">
          <h3>Forecast <StateBadge state="forecast" /> <Info text="Where cash goes next: payroll, recurring costs, deals and assumptions." /></h3>
          <Line name="Current cash (estimate)" value={formatZAR(s.cash.bankEstimate)} tone={s.cash.bankEstimate < 0 ? "neg" : ""} />
          <Line name="Next 30 days" value={formatZAR(s.cash.next30Net)} tone={s.cash.next30Net < 0 ? "neg" : "pos"} />
          <Line name="Lowest point" value={`${formatZAR(s.cash.lowest.balance)} · ${label(s.cash.lowest.month)}`} tone={s.cash.lowest.balance < 0 ? "neg" : "pos"} strong />
          <div class="muted" style="font-size:12px;margin-top:8px">
            {s.cash.fundingMonth ? `⚠ funding pressure from ${label(s.cash.fundingMonth)}` : "cash stays above zero"} → Forecast
          </div>
        </a>
      </div>

      <div class="callout section-block">
        Reading the numbers: profit of {formatZAR(s.profit.netProfit)} with a net cash movement of{" "}
        {formatZAR(cashReceivedFy - cashPaidFy)} means{" "}
        {s.profit.netProfit >= cashReceivedFy - cashPaidFy
          ? "money is earned but part of it hasn't reached the bank yet — it's sitting in outstanding invoices and tax payments."
          : "more cash moved than profit earned — collections from earlier months landed in this period."}{" "}
        The Receivables page shows exactly who owes the difference.
      </div>
    </div>
  </Layout>
);
