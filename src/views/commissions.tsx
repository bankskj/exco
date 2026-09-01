import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { type Commission, type CommissionLine, COMM_STAGES, STAGE_LABEL, TX_TYPES, commissionOf } from "../data/commissions";
import { formatZAR } from "../lib/money";
import { formatDMY } from "../lib/period";
import { AccountsTabs } from "./income";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const StageBadge: FC<{ stage: string }> = ({ stage }) => {
  const cls = stage === "paid" ? "income" : stage === "invoice" ? "recurring" : stage === "po" ? "forecast" : "actual";
  return <span class={`badge ${cls}`}>{STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage}</span>;
};

export type CommTotals = { invoiced: number; paid: number; commEarned: number | null };

export const CommissionsPage: FC<{
  deals: Commission[];
  linesByDeal: Map<string, CommissionLine[]>;
  staffNames: string[];
  openId: string | null;
  saved?: boolean;
}> = ({ deals, linesByDeal, staffNames, openId, saved }) => {
  const totalsOf = (d: Commission): CommTotals => {
    const lines = linesByDeal.get(d.id) ?? [];
    const invoiced = lines.reduce((s, l) => s + l.invoice, 0);
    const paid = lines.reduce((s, l) => s + l.payment, 0);
    const commEarned = commissionOf(d);
    return { invoiced, paid, commEarned };
  };
  const all = deals.map((d) => ({ d, t: totalsOf(d) }));
  const totInvoiced = all.reduce((s, x) => s + x.t.invoiced, 0);
  const totPaid = all.reduce((s, x) => s + x.t.paid, 0);
  const totComm = all.reduce((s, x) => s + (x.t.commEarned ?? 0), 0);
  const openDeals = deals.filter((d) => d.stage !== "paid").length;

  // Per-staff commission summary
  const byStaff = new Map<string, number>();
  for (const { d, t } of all) if (t.commEarned) byStaff.set(d.staff, (byStaff.get(d.staff) ?? 0) + t.commEarned);

  return (
    <Layout title="Deals" authed section="accounts" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Accounts · Deals</h1>
            <p class="muted" style="margin-top:0">Track every deal from Quote → PO → Invoice → Paid with a full transaction ledger — commission optional per deal.</p>
          </div>
          <a class="btn btn-sm" href="/app/accounts/deals/export.csv">⬇ Export CSV</a>
        </div>

        <AccountsTabs active="deals" />

        {saved ? <div class="callout section-block">✓ Saved.</div> : null}

        <div class="kpis section-block">
          <Kpi label="Invoiced (all deals)" value={formatZAR(totInvoiced)} />
          <Kpi label="Paid" value={formatZAR(totPaid)} sub={`${formatZAR(totInvoiced - totPaid)} outstanding`} />
          <Kpi label="Commission due" value={formatZAR(totComm)} sub="on invoice nett (editable per deal)" tone="pos" />
          <Kpi label="Open deals" value={String(openDeals)} sub={`${deals.length} total`} />
        </div>

        {byStaff.size > 0 ? (
          <div class="card section-block">
            <h3>Commission by staff member</h3>
            <div class="row" style="gap:24px;flex-wrap:wrap">
              {[...byStaff.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
                <div><strong>{name}</strong> <span class="pos">{formatZAR(amt)}</span></div>
              ))}
            </div>
          </div>
        ) : null}

        <div class="section-block">
          <h3>Deals — click a row to open its ledger</h3>
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Allocation</th><th>Date</th><th>Staff</th><th>Client</th>
                  <th>Quote #</th><th>PO #</th><th>Invoice #</th>
                  <th>Stage</th><th>Invoiced</th><th>Paid</th><th>Invoice nett</th><th>Comm %</th><th>Commission</th><th></th>
                </tr>
              </thead>
              <tbody>
                {all.map(({ d, t }) => (
                  <>
                  <tr style={openId === d.id ? "background:rgba(79,140,255,.08)" : ""}>
                    <td style="text-align:left">
                      <a href={openId === d.id ? "/app/accounts/deals" : `/app/accounts/deals?open=${d.id}`} style="font-weight:600">
                        {d.allocation} <span class="muted" style="font-size:10px">{openId === d.id ? "▲" : "▼"}</span>
                      </a>
                    </td>
                    <td>{d.deal_date ? formatDMY(d.deal_date) : "—"}</td>
                    <td>{d.staff}</td>
                    <td class="muted">{d.client || "—"}</td>
                    <td class="muted">{d.quote_no || "—"}</td>
                    <td class="muted">{d.po_number || "—"}</td>
                    <td class="muted">{d.invoice_no || "—"}</td>
                    <td>
                      <form method="post" action="/app/accounts/deals/stage" style="margin:0">
                        <input type="hidden" name="id" value={d.id} />
                        <select name="stage" onchange="this.form.submit()" style="padding:4px 8px;font-size:12px;width:auto">
                          {COMM_STAGES.map((s) => <option value={s} selected={d.stage === s}>{STAGE_LABEL[s]}</option>)}
                        </select>
                      </form>
                    </td>
                    <td class="num">{formatZAR(t.invoiced)}</td>
                    <td class="num">{formatZAR(t.paid)}</td>
                    <td>
                      <form method="post" action="/app/accounts/deals/amounts" id={`amt-${d.id}`} style="margin:0">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="text" inputmode="decimal" name="invoice_nett" value={d.invoice_nett != null ? String(d.invoice_nett) : ""}
                          placeholder="nett" onchange="this.form.submit()" style="width:90px;text-align:right" />
                      </form>
                    </td>
                    <td>
                      <input form={`amt-${d.id}`} type="text" inputmode="decimal" name="comm_pct"
                        value={d.comm_pct != null ? String(d.comm_pct) : ""} placeholder="%" onchange="this.form.submit()"
                        style="width:52px;text-align:right;padding:6px" />
                    </td>
                    <td>
                      <input form={`amt-${d.id}`} type="text" inputmode="decimal" name="comm_amount"
                        value={d.comm_amount != null ? String(d.comm_amount) : ""}
                        placeholder={t.commEarned != null ? String(Math.round(t.commEarned * 100) / 100) : "auto"}
                        onchange="this.form.submit()"
                        title={d.comm_amount != null ? "Manually set — clear to return to % × nett" : "Auto: % × invoice nett — type to override"}
                        style="width:90px;text-align:right" />
                    </td>
                    <td>
                      <form method="post" action="/app/accounts/deals/delete" style="margin:0"
                        onsubmit="return confirm('Delete this deal and its ledger?')">
                        <input type="hidden" name="id" value={d.id} />
                        <button class="btn btn-sm btn-danger" type="submit">✕</button>
                      </form>
                    </td>
                  </tr>
                  {openId === d.id ? (
                    <tr>
                      <td colspan={14} style="text-align:left;background:#0c0f14;padding:14px 18px">
                        <DealLedger deal={d} lines={linesByDeal.get(d.id) ?? []} />
                      </td>
                    </tr>
                  ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card section-block">
          <h3>New deal</h3>
          <form method="post" action="/app/accounts/deals/add" class="formgrid">
            <div><label>Staff (earner)</label>
              <input type="text" name="staff" required list="staffnames" />
              <datalist id="staffnames">{staffNames.map((n) => <option value={n} />)}</datalist>
            </div>
            <div><label>Allocation</label><input type="text" name="allocation" required placeholder="e.g. SAP Analyst - Bonus" /></div>
            <div><label>Date (dd/mm/yyyy)</label><input type="text" name="deal_date" placeholder="dd/mm/yyyy" inputmode="numeric" /></div>
            <div><label>Quote #</label><input type="text" name="quote_no" placeholder="e.g. QU-0012" /></div>
            <div><label>Invoice #</label><input type="text" name="invoice_no" placeholder="e.g. INV-00055" /></div>
            <div><label>Client</label><input type="text" name="client" placeholder="e.g. Illovo" /></div>
            <div><label>PO #</label><input type="text" name="po_number" placeholder="e.g. 4500302389" /></div>
            <div><label>Invoice nett (R) — comm base</label><input type="text" inputmode="decimal" name="invoice_nett" placeholder="e.g. 7 245.00" /></div>
            <div><label>Commission %</label><input type="text" inputmode="decimal" name="comm_pct" placeholder="e.g. 10" /></div>
            <div><label>Commission amount (R)</label><input type="text" inputmode="decimal" name="comm_amount" placeholder="blank = % × nett" /></div>
            <div><label>Stage</label>
              <select name="stage">{COMM_STAGES.map((s) => <option value={s}>{STAGE_LABEL[s]}</option>)}</select>
            </div>
            <div><button class="btn btn-primary" type="submit">Add deal</button></div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

const DealLedger: FC<{ deal: Commission; lines: CommissionLine[] }> = ({ deal, lines }) => {
  const invoiced = lines.reduce((s, l) => s + l.invoice, 0);
  const paid = lines.reduce((s, l) => s + l.payment, 0);
  return (
    <div>
      <div class="row spread" style="margin-bottom:10px">
        <strong>{deal.allocation} — ledger</strong>
        <span class="muted" style="font-size:12px">invoiced {formatZAR(invoiced)} · paid {formatZAR(paid)} · outstanding {formatZAR(invoiced - paid)}</span>
      </div>
      <table style="border-collapse:collapse;font-size:13px;width:100%">
        <thead>
          <tr>
            {["Date", "Reference", "Transaction Type", "Allocation", "PO", "Description", "Payments", "Invoices", ""].map((h) => (
              <th style={`text-align:${h === "Payments" || h === "Invoices" ? "right" : "left"};padding:4px 12px 4px 0;color:var(--muted)`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr>
              <td style="padding:3px 12px 3px 0">{l.tx_date ? formatDMY(l.tx_date) : "—"}</td>
              <td style="padding:3px 12px 3px 0" class="muted">{l.reference || "—"}</td>
              <td style="padding:3px 12px 3px 0">{l.tx_type || "—"}</td>
              <td style="padding:3px 12px 3px 0" class="muted">{l.allocation || "—"}</td>
              <td style="padding:3px 12px 3px 0" class="muted">{l.po_number || "—"}</td>
              <td style="padding:3px 12px 3px 0">{l.description || "—"}</td>
              <td style="padding:3px 12px 3px 0;text-align:right;font-variant-numeric:tabular-nums">{l.payment ? formatZAR(l.payment) : ""}</td>
              <td style="padding:3px 12px 3px 0;text-align:right;font-variant-numeric:tabular-nums">{l.invoice ? formatZAR(l.invoice) : ""}</td>
              <td style="padding:3px 0">
                <form method="post" action="/app/accounts/deals/line/delete" style="margin:0">
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="deal" value={deal.id} />
                  <button class="btn btn-sm btn-danger" type="submit">✕</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form method="post" action="/app/accounts/deals/line/add" class="formgrid" style="margin-top:14px">
        <input type="hidden" name="deal" value={deal.id} />
        <div><label>Date (dd/mm/yyyy)</label><input type="text" name="tx_date" placeholder="dd/mm/yyyy" inputmode="numeric" /></div>
        <div><label>Reference</label><input type="text" name="reference" /></div>
        <div><label>Transaction type</label>
          <select name="tx_type">{TX_TYPES.map((t) => <option value={t}>{t}</option>)}</select>
        </div>
        <div><label>Allocation</label><input type="text" name="allocation" value={deal.allocation} /></div>
        <div><label>PO</label><input type="text" name="po_number" value={deal.po_number ?? ""} /></div>
        <div class="full"><label>Description</label><input type="text" name="description" placeholder="e.g. INV-00055 - EO INV 3733" /></div>
        <div><label>Payment (R)</label><input type="text" inputmode="decimal" name="payment" /></div>
        <div><label>Invoice (R)</label><input type="text" inputmode="decimal" name="invoice" /></div>
        <div><button class="btn btn-primary" type="submit">Add line</button></div>
      </form>
    </div>
  );
};
