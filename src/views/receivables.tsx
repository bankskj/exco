import type { FC } from "hono/jsx";
import { Layout, AsAt, Info, StateBadge } from "./layout";
import type { ActualTxn } from "../data/actuals";
import { formatZAR } from "../lib/money";
import { label, formatDMY } from "../lib/period";
import { hBars } from "../lib/charts";
import { FinanceTabs } from "./income";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string; info?: string }> = ({ label, value, sub, tone, info }) => (
  <div class="kpi">
    <div class="k-label">{label} {info ? <Info text={info} /> : null}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

export type CustomerRow = {
  customer: string;
  invoiced: number; // total invoiced (window)
  outstanding: number;
  oldestOpen: string | null; // oldest open invoice date
  daysOverdue: number; // days since oldest open invoice
  openCount: number;
};

/**
 * Receivables — who owes us money and when will we get it?
 * Everything here is live open balances on Xero sales invoices.
 */
export const ReceivablesPage: FC<{
  openSales: ActualTxn[]; // sales invoices with an open balance
  customers: CustomerRow[];
  aging: { bucket: string; value: number }[];
  collectedThisMonth: number;
  collections: { month: string; invoiced: number; received: number; stillDue: number | null }[];
  openCustomer: string | null;
  lastSyncLabel: string | null;
}> = ({ openSales, customers, aging, collectedThisMonth, collections, openCustomer, lastSyncLabel }) => {
  const outstanding = openSales.reduce((s, t) => s + t.amount_due, 0);
  const now = Date.now();
  const overdue30 = openSales.filter((t) => now - Date.parse(t.txn_date) > 30 * 86400_000).reduce((s, t) => s + t.amount_due, 0);
  const drill = openCustomer ? openSales.filter((t) => t.contact === openCustomer) : [];

  return (
    <Layout title="Receivables" authed section="finance" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Finance · Receivables</h1>
            <p class="muted" style="margin-top:0">
              Who owes us money and when will we get it? Open balances straight from Xero sales invoices{" "}
              <StateBadge state="actual" />. Credit notes are not netted against these balances — a customer with an
              unallocated credit shows the gross amount.
            </p>
            <AsAt lastSync={lastSyncLabel} />
          </div>
        </div>

        <FinanceTabs active="receivables" />

        <div class="kpis section-block">
          <Kpi label="Outstanding" value={formatZAR(outstanding)} tone="warn" sub={`${openSales.length} open invoice(s)`}
            info="Total open balances on customer invoices." />
          <Kpi label="Overdue 30+ days" value={formatZAR(overdue30)} tone={overdue30 > 0 ? "neg" : "pos"}
            sub="invoiced more than 30 days ago" info="Open balances on invoices raised more than 30 days ago (by invoice date — Xero due dates aren't synced)." />
          <Kpi label="Raised in the last 30 days" value={formatZAR(outstanding - overdue30)} sub="recent billing, not yet due" />
          <Kpi label="Collected this month" value={formatZAR(collectedThisMonth)} tone="pos"
            sub="cash received (may relate to earlier invoices)" info="Cash income received this calendar month, from the cash-basis P&L." />
        </div>

        <div class="card section-block">
          <h3>Aging — open balances by invoice age</h3>
          <div dangerouslySetInnerHTML={{ __html: hBars(aging.map((a) => ({ label: a.bucket, value: a.value })), { color: "#f6c453" }) }} />
        </div>

        <div class="section-block">
          <h3>By customer — click a row for their invoices</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr><th style="text-align:left">Customer</th><th>Invoiced (18 mo)</th><th>Outstanding</th><th>Open invoices</th><th>Oldest open</th><th>Days old</th></tr>
              </thead>
              <tbody>
                {customers.map((r) => (
                  <>
                    <tr style={openCustomer === r.customer ? "background:rgba(79,140,255,.08)" : ""}>
                      <td style="text-align:left">
                        <a href={openCustomer === r.customer ? "/app/finance/receivables" : `/app/finance/receivables?c=${encodeURIComponent(r.customer)}`} style="font-weight:600">
                          {r.customer} <span class="muted" style="font-size:10px">{openCustomer === r.customer ? "▲" : "▼"}</span>
                        </a>
                      </td>
                      <td class="num">{formatZAR(r.invoiced)}</td>
                      <td class={`num ${r.outstanding > 0 ? "warn" : ""}`}>{formatZAR(r.outstanding)}</td>
                      <td class="num">{r.openCount}</td>
                      <td class="num">{r.oldestOpen ? formatDMY(r.oldestOpen) : "—"}</td>
                      <td class={`num ${r.daysOverdue > 60 ? "neg" : r.daysOverdue > 30 ? "warn" : ""}`}>{r.daysOverdue || "—"}</td>
                    </tr>
                    {openCustomer === r.customer ? (
                      <tr>
                        <td colspan={6} style="text-align:left;background:#0c0f14;padding:14px 18px">
                          <strong>{r.customer}</strong> — open invoices
                          <table style="border-collapse:collapse;font-size:13px;width:100%;margin-top:8px">
                            <thead><tr>{["Date", "Invoice", "Total (incl VAT)", "Still due", "Status"].map((h) => <th style={`text-align:${h === "Date" || h === "Invoice" ? "left" : "right"};padding:4px 12px 4px 0;color:var(--muted)`}>{h}</th>)}</tr></thead>
                            <tbody>
                              {drill.map((t) => (
                                <tr>
                                  <td style="padding:3px 12px 3px 0">{formatDMY(t.txn_date)}</td>
                                  <td style="padding:3px 12px 3px 0" class="muted">{t.reference || "—"}</td>
                                  <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(t.total)}</td>
                                  <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums" class="warn">{formatZAR(t.amount_due)}</td>
                                  <td style="padding:3px 0 3px 12px;text-align:right" class="muted">{t.status.toLowerCase()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div class="section-block">
          <h3>Collections by billing month</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr><th style="text-align:left">Month</th><th>Invoices raised</th><th>Cash received during month</th><th>Invoices still unpaid today</th></tr>
              </thead>
              <tbody>
                {collections.map((r) => (
                  <tr>
                    <td style="text-align:left">{label(r.month)}</td>
                    <td class="num">{formatZAR(r.invoiced)}</td>
                    <td class="num">{formatZAR(r.received)}</td>
                    <td class={`num ${(r.stillDue ?? 0) > 0 ? "warn" : "pos"}`}>{r.stillDue != null ? formatZAR(r.stillDue) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="muted" style="font-size:12px;margin-top:8px">
            "Cash received during month" is all cash income that month — it can include collections of earlier months'
            invoices, so it is not a collection rate. "Still unpaid today" is the live open balance on that month's
            invoices — the real debtors number.
          </p>
        </div>
      </div>
    </Layout>
  );
};
