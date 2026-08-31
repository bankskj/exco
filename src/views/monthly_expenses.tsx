import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { VendorBill } from "../data/expenses";
import { formatZAR } from "../lib/money";
import { label, formatDMY } from "../lib/period";

export const ExpenseTabs: FC<{ active: "recurring" | "monthly" | "vendors" }> = ({ active }) => (
  <div class="segmented" style="margin:14px 0 4px">
    <a href="/app/expenses" class={active === "recurring" ? "seg active" : "seg"}>Recurring</a>
    <a href="/app/expenses/monthly" class={active === "monthly" ? "seg active" : "seg"}>Monthly log</a>
    <a href="/app/expenses/vendors" class={active === "vendors" ? "seg active" : "seg"}>Vendor review</a>
  </div>
);

export type MonthSummary = { month: string; total: number; billTotal: number; manualTotal: number; billCount: number; vendorCount: number };
export type VendorGroup = { key: string; name: string; total: number; bills: VendorBill[] };
export type ManualItem = { name: string; amount: number; frequency: string };

const Kpi: FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class="k-value">{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

export const MonthlyExpensesPage: FC<{
  months: MonthSummary[]; // newest first
  selected: string | null;
  groups: VendorGroup[]; // vendor groups for the selected month, desc by total
  manualItems: ManualItem[]; // active manually-captured recurring expenses (monthly equivalents)
  excludedCount: number; // payroll/contractor vendors filtered out
  currentMonth: string; // 'YYYY-MM' — flagged as partial
}> = ({ months, selected, groups, manualItems, excludedCount, currentMonth }) => {
  const complete = months.filter((m) => m.month !== currentMonth);
  const latest = complete[0] ?? months[0];
  const avg = complete.length ? complete.reduce((s, m) => s + m.total, 0) / complete.length : 0;
  const selTotal = groups.reduce((s, g) => s + g.total, 0) + manualItems.reduce((s, i) => s + i.amount, 0);

  return (
    <Layout title="Monthly expenses" authed section="expenses" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Monthly expenses</h1>
            <p class="muted" style="margin-top:0">
              Everything the business spends by month — Xero supplier bills plus manually captured recurring
              expenses — with staff, developers and payroll-matched vendors excluded
              {excludedCount > 0 ? ` (${excludedCount} vendor(s) filtered out)` : ""}.
            </p>
          </div>
        </div>

        <ExpenseTabs active="monthly" />

        <div class="callout section-block">
          <strong>What this covers:</strong> supplier bills and direct bank payments (spend money) from Xero, plus
          manual recurring entries. <strong>Not included:</strong> salaries and dev/contractor pay — those live in{" "}
          <a href="/app/payroll">Payroll</a>. Total business outflow ≈ this log + payroll nett. Recent months read low
          until the bookkeeping in Xero catches up.
        </div>

        <div class="kpis section-block">
          <Kpi label={`Latest full month — ${latest ? label(latest.month) : "—"}`} value={formatZAR(latest?.total ?? 0)}
            sub={latest ? `${latest.billCount} bills · ${latest.vendorCount} vendors` : undefined} />
          <Kpi label="Monthly average" value={formatZAR(avg)} sub={`over ${complete.length} full month(s)`} />
          <Kpi label="Highest month" value={formatZAR(complete.length ? Math.max(...complete.map((m) => m.total)) : 0)} />
          <Kpi label="Lowest month" value={formatZAR(complete.length ? Math.min(...complete.map((m) => m.total)) : 0)} />
        </div>

        <div class="section-block">
          <h3>By month — click to drill down</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr><th style="text-align:left">Month</th><th>Bills</th><th>Vendors</th><th>Xero bills</th><th>Recurring (manual)</th><th>Total</th><th></th></tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr style={selected === m.month ? "background:rgba(79,140,255,.08)" : ""}>
                    <td style="text-align:left">
                      <a href={`/app/expenses/monthly?m=${m.month}`} style="font-weight:600">
                        {label(m.month)}{m.month === currentMonth ? <span class="muted"> · partial</span> : ""}
                      </a>
                    </td>
                    <td class="num">{m.billCount}</td>
                    <td class="num">{m.vendorCount}</td>
                    <td class="num">{formatZAR(m.billTotal)}</td>
                    <td class="num">{formatZAR(m.manualTotal)}</td>
                    <td class="num"><strong>{formatZAR(m.total)}</strong></td>
                    <td><a class="btn btn-sm" href={`/app/expenses/monthly?m=${m.month}`}>{selected === m.month ? "Viewing" : "View log"}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selected ? (
          <div class="section-block">
            <div class="row spread">
              <h3 style="margin:0">{label(selected)} — full log · {formatZAR(selTotal)}</h3>
              <a class="btn btn-sm" href="/app/expenses/monthly">Close</a>
            </div>
            {manualItems.length > 0 ? (
              <div class="card" style="margin-top:12px">
                <div class="row spread">
                  <strong>Recurring — captured manually <span class="badge actual" style="margin-left:6px">standing charge</span></strong>
                  <span>{formatZAR(manualItems.reduce((s, i) => s + i.amount, 0))} <span class="muted" style="font-size:12px">· {manualItems.length} item(s) / month</span></span>
                </div>
                <table style="border-collapse:collapse;font-size:13px;margin-top:8px;min-width:420px">
                  <tbody>
                    {manualItems.map((i) => (
                      <tr>
                        <td style="padding:3px 18px 3px 0">{i.name}</td>
                        <td style="padding:3px 18px 3px 0" class="muted">{i.frequency}</td>
                        <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {groups.length === 0 && manualItems.length === 0 ? <p class="muted">No expenses recorded for this month.</p> : null}
            {groups.map((g) => (
              <div class="card" style="margin-top:12px">
                <div class="row spread">
                  <strong>{g.name}</strong>
                  <span>{formatZAR(g.total)} <span class="muted" style="font-size:12px">· {g.bills.length} bill(s)</span></span>
                </div>
                <table style="border-collapse:collapse;font-size:13px;margin-top:8px;min-width:420px">
                  <tbody>
                    {g.bills.map((b) => (
                      <tr>
                        <td style="padding:3px 18px 3px 0" class="muted">{formatDMY(b.bill_date)}</td>
                        <td style="padding:3px 18px 3px 0" class="muted">{b.reference || "—"}</td>
                        <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <p class="muted section-block">Select a month above to see its full vendor-by-vendor log.</p>
        )}
      </div>
    </Layout>
  );
};
