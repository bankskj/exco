import type { FC } from "hono/jsx";
import { Layout, AsAt, Info } from "./layout";
import type { XeroRepeatingSchedule } from "../lib/xero";
import type { ProjectedInvoice } from "../lib/recurring";
import { formatZAR } from "../lib/money";
import { label, formatDMY } from "../lib/period";
import { FinanceTabs } from "./income";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string; info?: string }> = ({ label, value, sub, tone, info }) => (
  <div class="kpi">
    <div class="k-label">{label} {info ? <Info text={info} /> : null}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const TERMS: Record<string, (d: number) => string> = {
  DAYSAFTERBILLDATE: (d) => `${d} days after invoice date`,
  DAYSAFTERBILLMONTH: (d) => `${d} days after end of invoice month`,
  OFCURRENTMONTH: (d) => `day ${d} of the invoice month`,
  OFFOLLOWINGMONTH: (d) => `day ${d} of the following month`,
};
const terms = (s: XeroRepeatingSchedule) =>
  s.due_type && s.due_day != null && TERMS[s.due_type] ? TERMS[s.due_type](s.due_day) : "on invoice date (no terms)";
const every = (s: XeroRepeatingSchedule) =>
  s.unit === "WEEKLY"
    ? s.period === 1 ? "weekly" : `every ${s.period} weeks`
    : s.period === 1 ? "monthly" : s.period === 3 ? "quarterly" : s.period === 12 ? "annually" : `every ${s.period} months`;

/** Finance · Recurring — Xero repeating schedules and the invoices they will raise. */
export const RecurringPage: FC<{
  schedules: XeroRepeatingSchedule[];
  projected: ProjectedInvoice[];
  horizonMonths: number;
  synced: string | null;
  error: string | null;
}> = ({ schedules, projected, horizonMonths, synced, error }) => {
  const sales = schedules.filter((s) => s.type === "ACCREC");
  const bills = schedules.filter((s) => s.type === "ACCPAY");
  const projSales = projected.filter((p) => p.type === "ACCREC");
  const confirmed = projSales.reduce((t, p) => t + p.amount, 0);
  const drafts = schedules.filter((s) => s.status === "DRAFT").length;
  const committed = projected.filter((p) => p.type === "ACCPAY").reduce((t, p) => t + p.amount, 0);
  const countBy = new Map<string, number>();
  for (const p of projected) countBy.set(p.xero_id, (countBy.get(p.xero_id) ?? 0) + 1);

  const ScheduleTable: FC<{ rows: XeroRepeatingSchedule[]; who: string }> = ({ rows, who }) => (
    <div class="tablewrap">
      <table class="grid">
        <thead>
          <tr>
            <th style="text-align:left">{who}</th><th style="text-align:left">Reference</th><th>Per invoice (excl VAT)</th>
            <th style="text-align:left">Frequency</th><th>Next invoice</th><th>Ends</th><th style="text-align:left">Payment terms</th><th>In horizon</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr>
              <td style="text-align:left">
                {s.contact ?? "—"}
                {s.status === "DRAFT" ? <> <span class="badge estimate" title="Creates draft invoices that must be approved — not included in the forecast">draft · not in forecast</span></> : null}
                {s.currency !== "ZAR" ? <> <span class="badge" title="Not in ZAR — listed only, kept out of the forecast">{s.currency}</span></> : null}
              </td>
              <td style="text-align:left" class="muted">{s.reference ?? ""}</td>
              <td class="num">{formatZAR(s.sub_total)}</td>
              <td style="text-align:left">{every(s)}</td>
              <td class="num">{s.next_date ? formatDMY(s.next_date) : "—"}</td>
              <td class="num">{s.end_date ? formatDMY(s.end_date) : <span class="muted">no end</span>}</td>
              <td style="text-align:left" class="muted">{terms(s)}</td>
              <td class="num">{countBy.get(s.xero_id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Layout title="Recurring invoices" authed section="finance" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Finance · Scheduled recurring</h1>
            <p class="muted" style="margin-top:0">
              Income and bills already scheduled in Xero as repeating invoices. Each future invoice is projected from
              its next scheduled date for {horizonMonths} months (open-ended schedules too) and placed in the month it
              falls due under its payment terms. Invoices Xero has already raised are not counted again. Refreshed daily.
            </p>
            <AsAt lastSync={synced} />
          </div>
        </div>

        <FinanceTabs active="forecast" />
        {error ? <div class="callout section-block">Last refresh failed: {error}</div> : null}

        <div class="kpis section-block">
          <Kpi label="Recurring invoices" value={formatZAR(confirmed)} tone="pos" sub={`next ${horizonMonths} months · excl VAT`} />
          <Kpi label="Committed recurring bills" value={formatZAR(committed)} tone={committed ? "neg" : ""} sub={`next ${horizonMonths} months · excl VAT`} />
          <Kpi label="Templates" value={String(schedules.length)} sub={`${sales.length} sales · ${bills.length} bills${drafts ? ` · ${drafts} draft (not in forecast)` : ""}`} />
        </div>

        {schedules.length === 0 ? (
          <div class="card section-block">
            <p class="muted" style="margin:0">
              No repeating schedules yet. They load with the next Xero sync (Admin → Sync now, or the daily refresh).
            </p>
          </div>
        ) : (
          <>
            <div class="section-block">
              <h3>Sales templates — recurring invoices</h3>
              {sales.length ? <ScheduleTable rows={sales} who="Customer" /> : <p class="muted">No repeating sales invoices in Xero.</p>}
            </div>
            <div class="section-block">
              <h3>Bill templates — committed costs</h3>
              {bills.length ? <ScheduleTable rows={bills} who="Supplier" /> : <p class="muted">No repeating bills in Xero.</p>}
            </div>
            <div class="section-block">
              <h3>Projected invoices by due date</h3>
              <div class="tablewrap">
                <table class="grid">
                  <thead>
                    <tr><th style="text-align:left">Due month</th><th>Due</th><th>Invoice date</th><th style="text-align:left">Contact</th><th style="text-align:left">Type</th><th>Excl VAT</th><th>Incl VAT</th></tr>
                  </thead>
                  <tbody>
                    {projected.map((p) => (
                      <tr>
                        <td style="text-align:left">{label(p.dueDate.slice(0, 7))}</td>
                        <td class="num">{formatDMY(p.dueDate)}</td>
                        <td class="num muted">{formatDMY(p.invoiceDate)}</td>
                        <td style="text-align:left">{p.contact ?? "—"}</td>
                        <td style="text-align:left">
                          {p.type === "ACCREC" ? <span class="badge income">income</span> : <span class="badge cost">bill</span>}
                        </td>
                        <td class={`num ${p.type === "ACCPAY" ? "neg" : ""}`}>{formatZAR(p.amount)}</td>
                        <td class="num muted">{formatZAR(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p class="muted" style="font-size:12px;margin-top:8px">
                The forecast uses excl-VAT amounts to match the Profit &amp; Loss basis it is built on; VAT settles on
                the SARS line. In months covered here, the trend-based collections and other-cost figures on the{" "}
                <a href="/app/finance/forecast?t=monthly">Forecast</a> are reduced by the recurring run-rate, so these
                invoices are not counted twice.
              </p>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};
