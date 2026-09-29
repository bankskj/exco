import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { ActualTxn } from "../data/actuals";
import { formatZAR } from "../lib/money";
import { label, formatDMY, fiscalYearOf, fyLabel } from "../lib/period";
import { AccountsTabs } from "./income";

type MonthSummary = {
  month: string;
  sales: number; // invoiced (excl VAT)
  bills: number; // supplier bills (excl VAT)
  spend: number; // spend-money bank txns excl SARS (excl VAT)
  sars: number; // payments to SARS — VAT portion is not in the P&L
  count: number;
};

const isSars = (t: ActualTxn) => /^SARS\b/i.test(t.contact) || /\bSARS\b/i.test(String(t.reference ?? ""));

const KIND_LABEL: Record<ActualTxn["kind"], string> = { sale: "Sales invoice", bill: "Supplier bill", spend: "Spend money" };

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const TxnTable: FC<{ rows: ActualTxn[] }> = ({ rows }) => (
  <div class="tablewrap">
    <table class="grid">
      <thead>
        <tr>
          <th>Date</th><th style="text-align:left">Contact</th><th>Reference</th><th>Type</th>
          <th>Excl VAT</th><th>Incl VAT</th><th>Still due</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr>
            <td>{formatDMY(t.txn_date)}</td>
            <td style="text-align:left">{t.contact}</td>
            <td class="muted">{t.reference || "—"}</td>
            <td><span class={`badge ${t.kind === "sale" ? "income" : "cost"}`}>{KIND_LABEL[t.kind]}</span></td>
            <td class="num">{formatZAR(t.sub_total)}</td>
            <td class="num muted">{formatZAR(t.total)}</td>
            <td class={`num ${t.amount_due > 0.005 ? "warn" : "muted"}`}>{t.amount_due > 0.005 ? formatZAR(t.amount_due) : "—"}</td>
            <td class="muted">{t.status.toLowerCase()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const ActualsPage: FC<{
  txns: ActualTxn[];
  fy: number | null;
  fys: number[];
  open: string | null; // month being drilled into
  pnlNet?: Map<string, number>; // accrual P&L net by month (tie-out column)
  lastSync: string | null;
  syncError?: string | null;
}> = ({ txns, fy, fys, open, pnlNet, lastSync, syncError }) => {
  const inFy = (m: string) => fy == null || fiscalYearOf(m) === fy;
  const byMonth = new Map<string, MonthSummary>();
  for (const t of txns) {
    const m = t.txn_date.slice(0, 7);
    if (!inFy(m)) continue;
    if (!byMonth.has(m)) byMonth.set(m, { month: m, sales: 0, bills: 0, spend: 0, sars: 0, count: 0 });
    const s = byMonth.get(m)!;
    if (t.kind === "sale") s.sales += t.sub_total;
    else if (t.kind === "bill") s.bills += t.sub_total;
    else if (isSars(t)) s.sars += t.sub_total;
    else s.spend += t.sub_total;
    s.count++;
  }
  const months = [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  const tot = months.reduce((a, s) => ({ sales: a.sales + s.sales, out: a.out + s.bills + s.spend + s.sars }), { sales: 0, out: 0 });
  // Running balance: cumulative net, oldest month first (within the FY view).
  const running = new Map<string, number>();
  let cum = 0;
  for (const s2 of [...months].sort((a, b) => (a.month < b.month ? -1 : 1))) {
    cum += s2.sales - s2.bills - s2.spend - s2.sars;
    running.set(s2.month, cum);
  }
  const nets = months.map((s2) => s2.sales - s2.bills - s2.spend - s2.sars);
  const avgNet = nets.length ? (tot.sales - tot.out) / nets.length : 0;
  const net1 = (x: MonthSummary) => x.sales - x.bills - x.spend - x.sars;
  const best = months.length ? months.reduce((a, b) => (net1(a) >= net1(b) ? a : b)) : null;
  const worst = months.length ? months.reduce((a, b) => (net1(a) <= net1(b) ? a : b)) : null;
  const openRows = open ? txns.filter((t) => t.txn_date.slice(0, 7) === open) : [];
  const qs = (m: string | null) => `/app/accounts/actuals?${fy != null ? `fy=${fy}&` : "fy=all&"}${m ? `m=${m}` : ""}`.replace(/[&?]$/, "");

  return (
    <Layout title="Accounts — Actuals" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Accounts · Actuals</h1>
            <p class="muted" style="margin-top:0">
              Straight from Xero, nothing filtered: every approved sales invoice, supplier bill and spend-money
              transaction, by the month it's dated (accrual). Figures are excl VAT so they tie back to the P&L.
              Click a month to see every document behind it.
            </p>
          </div>
          <span class="muted" style="font-size:12px;margin-top:16px">Synced {lastSync ? lastSync : "—"} · updates on every Xero sync</span>
        </div>

        <AccountsTabs active="actuals" />

        {syncError ? (
          <div class="callout section-block" style="border-left-color:var(--danger)">
            Last sync couldn't fetch everything from Xero: {syncError} — the figures below may be incomplete. Re-run the sync.
          </div>
        ) : null}

        <div class="segmented section-block">
          <a href="/app/accounts/actuals?fy=all" class={fy == null ? "seg active" : "seg"}>All</a>
          {fys.map((y) => (
            <a href={`/app/accounts/actuals?fy=${y}`} class={fy === y ? "seg active" : "seg"}>{fyLabel(y)}</a>
          ))}
        </div>

        {txns.length === 0 ? (
          <div class="callout section-block">No transactions synced yet — run <strong>Sync from Xero</strong> on the Expenses tab (or ↻ Sync now on the Cashflow tab) to pull them.</div>
        ) : (
          <>
            <div class="kpis section-block">
              <Kpi label="Invoiced (sales)" value={formatZAR(tot.sales)} sub="excl VAT" />
              <Kpi label="Spent (bills + spend money)" value={formatZAR(tot.out)} sub="excl VAT" />
              <Kpi label="Running balance" value={formatZAR(tot.sales - tot.out)} tone={tot.sales - tot.out < 0 ? "neg" : "pos"}
                sub={`net over ${months.length} month(s) · avg ${formatZAR(avgNet)}/mo`} />
              <Kpi label="Best month" value={best ? formatZAR(net1(best)) : "—"} tone="pos" sub={best ? label(best.month) : undefined} />
              <Kpi label="Worst month" value={worst ? formatZAR(net1(worst)) : "—"}
                tone={worst && net1(worst) < 0 ? "neg" : ""} sub={worst ? label(worst.month) : undefined} />
            </div>

            <div class="card section-block">
              <h3>By month — click a row to drill down</h3>
              <div class="tablewrap">
                <table class="grid">
                  <thead>
                    <tr>
                      <th style="text-align:left">Month</th><th>Invoiced (sales)</th><th>Supplier bills</th>
                      <th>Spend money</th><th>SARS (tax)</th><th>Total out</th><th>Net</th><th>P&amp;L net</th><th>Running</th><th>Docs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((s) => {
                      const out = s.bills + s.spend + s.sars;
                      const net = s.sales - out;
                      const pl = pnlNet?.get(s.month);
                      const isOpen = open === s.month;
                      return (
                        <>
                          <tr style={isOpen ? "background:rgba(79,140,255,.08)" : ""}>
                            <td style="text-align:left">
                              <a href={isOpen ? qs(null) : qs(s.month)} style="font-weight:600">
                                {label(s.month)} <span class="muted" style="font-size:10px">{isOpen ? "▲" : "▼"}</span>
                              </a>
                            </td>
                            <td class="num">{formatZAR(s.sales)}</td>
                            <td class="num">{formatZAR(s.bills)}</td>
                            <td class="num">{formatZAR(s.spend)}</td>
                            <td class="num warn">{s.sars ? formatZAR(s.sars) : "—"}</td>
                            <td class="num">{formatZAR(out)}</td>
                            <td class={`num ${net < 0 ? "neg" : "pos"}`}>{formatZAR(net)}</td>
                            <td class={`num muted ${pl != null && pl < 0 ? "neg" : ""}`}>{pl != null ? formatZAR(pl) : "—"}</td>
                            <td class={`num ${(running.get(s.month) ?? 0) < 0 ? "neg" : ""}`} style="font-weight:600">{formatZAR(running.get(s.month) ?? 0)}</td>
                            <td class="num muted">{s.count}</td>
                          </tr>
                          {isOpen ? (
                            <tr>
                              <td colspan={10} style="text-align:left;background:#0c0f14;padding:14px 18px">
                                <strong>{label(s.month)}</strong>
                                <span class="muted" style="font-size:12px"> — {openRows.filter((t) => t.kind === "sale").length} sales invoice(s), {openRows.filter((t) => t.kind !== "sale").length} outgoing</span>
                                <div style="margin-top:10px"><TxnTable rows={openRows} /></div>
                              </td>
                            </tr>
                          ) : null}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p class="muted" style="font-size:12px;margin-top:10px">
                <strong>Net vs P&amp;L net:</strong> Net is the full document picture; the P&amp;L excludes SARS VAT
                payments (a balance-sheet item — the SARS column here holds both VAT and PAYE settlements) and includes
                small non-invoice entries (journals, interest). Add the VAT portion of SARS back to Net and the two lines meet.
              </p>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};
