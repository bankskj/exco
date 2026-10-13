import type { FC } from "hono/jsx";
import { Layout, AsAt, Info } from "./layout";
import { formatZAR } from "../lib/money";
import { formatDMY } from "../lib/period";
import { FinanceTabs } from "./income";
import type { CostPeriodKey } from "./expenses";

export const ExpenseTabs: FC<{ active: "recurring" | "monthly" }> = ({ active }) => (
  <div class="segmented" style="margin:8px 0 4px">
    <a href="/app/finance/costs" class={active === "recurring" ? "seg active" : "seg"}>Recurring costs</a>
    <a href="/app/finance/costs/monthly" class={active === "monthly" ? "seg active" : "seg"}>Spend detail</a>
  </div>
);

const PERIOD_TABS: { key: CostPeriodKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This FY" },
];

export type SpendVendorRow = {
  vendor: string;
  docs: number;
  excl: number;
  vat: number;
  incl: number;
  recurring: boolean; // tracked as a recurring cost
  tax: boolean; // SARS
  manual: boolean; // modelled manual recurring item (no Xero documents)
};

export type SpendDoc = { date: string; kind: string; reference: string | null; excl: number; vat: number; incl: number };

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

/**
 * Spend detail — every vendor and supplier paid in the window (recurring or
 * not), from the synced Xero documents. Staff/contractor payments are
 * excluded (they live in Payroll); SARS stays, badged as tax.
 */
export const SpendDetailPage: FC<{
  rows: SpendVendorRow[];
  openVendor: string | null;
  openDocs: SpendDoc[];
  costPeriod: CostPeriodKey;
  periodLabel: string;
  windowMonths: number;
  excludedCount: number;
  lastSyncLabel: string | null;
}> = ({ rows, openVendor, openDocs, costPeriod, periodLabel, windowMonths, excludedCount, lastSyncLabel }) => {
  const total = rows.reduce((s, r) => s + r.incl, 0);
  const vatTotal = rows.reduce((s, r) => s + Math.max(0, r.vat), 0);
  const docTotal = rows.reduce((s, r) => s + r.docs, 0);
  const qs = (over: { p?: string; open?: string | null }) => {
    const p = over.p ?? costPeriod;
    const o = over.open === undefined ? openVendor : over.open;
    return `/app/finance/costs/monthly?p=${p}${o ? `&open=${encodeURIComponent(o)}` : ""}`;
  };
  return (
    <Layout title="Spend detail" authed section="finance" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Costs · Spend detail</h1>
            <p class="muted" style="margin-top:0">
              Everything the business paid in the window — every vendor and supplier, recurring or once-off, from the
              synced Xero documents. Salaries and dev/contractor pay are excluded (they live in{" "}
              <a href="/app/payroll">Payroll</a>); SARS is included, badged as tax.
            </p>
            <AsAt lastSync={lastSyncLabel} />
          </div>
        </div>

        <FinanceTabs active="costs" />
        <div class="row" style="gap:10px;align-items:center">
          <ExpenseTabs active="monthly" />
          <div class="segmented" style="margin:8px 0 4px">
            {PERIOD_TABS.map((t) => (
              <a href={qs({ p: t.key, open: null })} class={costPeriod === t.key ? "seg active" : "seg"}>{t.label}</a>
            ))}
          </div>
        </div>

        <div class="kpis section-block">
          <Kpi label={`Total spend — ${periodLabel}`} value={formatZAR(total)} sub={`${docTotal} document(s) · ${rows.filter((r) => !r.manual).length} vendor(s)`} />
          <Kpi label="VAT on spend" value={formatZAR(vatTotal)} sub="input VAT claimable" />
          <Kpi label="Average per month" value={formatZAR(windowMonths ? total / windowMonths : total)} sub={`over ${windowMonths} month(s)`} />
          <Kpi label="Largest vendor" value={rows[0] ? formatZAR(rows[0].incl) : "—"} sub={rows[0]?.vendor} />
        </div>

        <div class="section-block">
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Vendor / supplier</th><th>Docs</th><th>Excl VAT</th><th>VAT</th>
                  <th>Billed (incl)</th><th>% of spend</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = openVendor === r.vendor;
                  return (
                    <>
                      <tr style={isOpen ? "background:rgba(79,140,255,.08)" : ""}>
                        <td style="text-align:left">
                          {r.manual ? r.vendor : (
                            <a href={isOpen ? qs({ open: null }) : qs({ open: r.vendor })} style="font-weight:600">
                              {r.vendor} <span class="muted" style="font-size:10px">{isOpen ? "▲" : "▼"}</span>
                            </a>
                          )}
                          {r.tax ? <span class="badge forecast" style="margin-left:8px">tax</span> : null}
                          {r.recurring ? <span class="badge recurring" style="margin-left:8px">recurring</span> : null}
                          {r.manual ? <span class="badge manual" style="margin-left:8px">MANUAL</span> : null}
                        </td>
                        <td class="num">{r.manual ? "—" : r.docs}</td>
                        <td class="num">{formatZAR(r.excl)}</td>
                        <td class={`num ${r.vat > 0.005 ? "" : "muted"}`}>{r.vat > 0.005 ? formatZAR(r.vat) : "no VAT"}</td>
                        <td class="num"><strong>{formatZAR(r.incl)}</strong></td>
                        <td class="num muted">{total ? `${Math.round((r.incl / total) * 1000) / 10}%` : "—"}</td>
                        <td>{r.manual ? <span class="cellhint">modelled — no Xero documents</span> : null}</td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colspan={7} style="text-align:left;background:#0c0f14;padding:14px 18px">
                            <strong>{r.vendor}</strong> — documents in {periodLabel}
                            <table style="border-collapse:collapse;font-size:13px;min-width:560px;margin-top:8px">
                              <thead>
                                <tr>{["Date", "Type", "Reference", "Excl VAT", "VAT", "Incl VAT"].map((h) => (
                                  <th style={`text-align:${h === "Date" || h === "Type" || h === "Reference" ? "left" : "right"};padding:4px 14px 4px 0;color:var(--muted)`}>{h}</th>
                                ))}</tr>
                              </thead>
                              <tbody>
                                {openDocs.map((d) => (
                                  <tr>
                                    <td style="padding:3px 14px 3px 0">{formatDMY(d.date)}</td>
                                    <td style="padding:3px 14px 3px 0" class="muted">{d.kind === "bill" ? "supplier bill" : "spend money"}</td>
                                    <td style="padding:3px 14px 3px 0" class="muted">{d.reference || "—"}</td>
                                    <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(d.excl)}</td>
                                    <td style="padding:3px 0 3px 14px;text-align:right;font-variant-numeric:tabular-nums" class={d.vat > 0.005 ? "" : "muted"}>{d.vat > 0.005 ? formatZAR(d.vat) : "—"}</td>
                                    <td style="padding:3px 0 3px 14px;text-align:right;font-variant-numeric:tabular-nums"><strong>{formatZAR(d.incl)}</strong></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
                <tr class="total">
                  <td style="text-align:left">Total ({rows.length} rows)</td>
                  <td class="num">{docTotal}</td>
                  <td class="num">{formatZAR(rows.reduce((s, r) => s + r.excl, 0))}</td>
                  <td class="num">{formatZAR(vatTotal)}</td>
                  <td class="num">{formatZAR(total)}</td>
                  <td></td><td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted" style="font-size:12px;margin-top:8px">
            {excludedCount > 0 ? `${excludedCount} staff/contractor payee(s) excluded — they're counted in Payroll, not here. ` : ""}
            Manual recurring rows are modelled (monthly equivalent × months in the window) because they have no Xero
            documents <Info text="Everything else is actual synced documents: supplier bills plus spend-money bank payments, incl and excl VAT." />
          </p>
        </div>
      </div>
    </Layout>
  );
};
