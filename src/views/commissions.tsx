import type { FC } from "hono/jsx";
import { Layout, DateField } from "./layout";
import { type Commission, type CommissionLine, COMM_STAGES, STAGE_LABEL, TX_TYPES, commissionOf } from "../data/commissions";
import { formatZAR } from "../lib/money";
import { formatDMY } from "../lib/period";
import { AsAt } from "./layout";
import { commissionState } from "../lib/metrics";

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
  clientFilter: string | null;
  saved?: boolean;
}> = ({ deals, linesByDeal, staffNames, openId, clientFilter, saved }) => {
  const totalsOf = (d: Commission): CommTotals => {
    const lines = linesByDeal.get(d.id) ?? [];
    const invoiced = lines.reduce((s, l) => s + l.invoice, 0);
    const paid = lines.reduce((s, l) => s + l.payment, 0);
    const commEarned = commissionOf(d);
    return { invoiced, paid, commEarned };
  };
  // Deal value: invoice nett where captured, else the ledger's invoiced total.
  const valueOf = (d: Commission): number => d.invoice_nett ?? (linesByDeal.get(d.id) ?? []).reduce((s, l) => s + l.invoice, 0);
  const visibleDeals = clientFilter ? deals.filter((d) => (d.client ?? "") === clientFilter) : deals;
  const all = visibleDeals.map((d) => ({ d, t: totalsOf(d) }));
  const totInvoiced = all.reduce((s, x) => s + x.t.invoiced, 0);
  const totPaid = all.reduce((s, x) => s + x.t.paid, 0);
  const commEarnedTot = all.reduce((s, x) => { const st = commissionState(x.d); return s + (st === "earned" || st === "payable" ? x.t.commEarned ?? 0 : 0); }, 0);
  const commEstTot = all.reduce((s, x) => (commissionState(x.d) === "estimated" ? s + (x.t.commEarned ?? 0) : s), 0);
  const openDeals = visibleDeals.filter((d) => d.stage !== "paid").length;
  const stageStat = (stage: string) => {
    const ds = visibleDeals.filter((d) => d.stage === stage);
    return { n: ds.length, v: ds.reduce((s, d) => s + valueOf(d), 0) };
  };
  const stQuote = stageStat("quote");
  const stPo = stageStat("po");
  const stInvoice = stageStat("invoice");
  const stPaid = stageStat("paid");
  // Client breakdown (always across all deals)
  const byClient = new Map<string, { n: number; v: number }>();
  for (const d of deals) {
    const key = d.client?.trim() || "(no client)";
    const cur = byClient.get(key) ?? { n: 0, v: 0 };
    cur.n++;
    cur.v += valueOf(d);
    byClient.set(key, cur);
  }

  // Per-staff commission summary
  const byStaff = new Map<string, number>();
  for (const { d, t } of all) {
    const st = commissionState(d);
    if (t.commEarned && (st === "earned" || st === "payable")) byStaff.set(d.staff, (byStaff.get(d.staff) ?? 0) + t.commEarned);
  }

  return (
    <Layout title="Deals" authed section="pipeline" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Sales Pipeline</h1>
            <p class="muted" style="margin-top:0">
              What business is coming? Every deal from Quote → PO → Invoice → Paid with a full ledger — commission
              optional per deal. Only deals marked <strong>Fcast ✓</strong> with an expected payment date feed the{" "}
              <a href="/app/finance/forecast">cash forecast</a>.
            </p>
            <AsAt />
          </div>
          <a class="btn btn-sm" href="/app/accounts/deals/export.csv">⬇ Export CSV</a>
        </div>

        {saved ? <div class="callout section-block">✓ Saved.</div> : null}

        <div class="kpis section-block">
          <Kpi label="Potential — quoted" value={formatZAR(stQuote.v)} sub={`${stQuote.n} deal(s) · least certain`} />
          <Kpi label="Committed — PO received" value={formatZAR(stPo.v)} sub={`${stPo.n} deal(s)`} tone="warn" />
          <Kpi label="Billed — invoiced" value={formatZAR(stInvoice.v)} sub={`${stInvoice.n} deal(s) awaiting payment`} />
          <Kpi label="Collected — paid" value={formatZAR(stPaid.v)} sub={`${stPaid.n} deal(s) done`} tone="pos" />
        </div>
        <div class="kpis section-block">
          <Kpi label="Ledger invoiced" value={formatZAR(totInvoiced)} sub={`${formatZAR(totInvoiced - totPaid)} outstanding`} />
          <Kpi label="Ledger paid" value={formatZAR(totPaid)} />
          <Kpi label="Commission owed to staff" value={formatZAR(commEarnedTot)} tone={commEarnedTot > 0 ? "warn" : ""}
            sub={`on invoiced/paid deals · potential ${formatZAR(commEstTot)} on quotes/POs`} />
          <Kpi label="Open deals" value={String(openDeals)} sub={`${visibleDeals.length} shown`} />
        </div>

        <div class="card section-block">
          <div class="row spread">
            <h3 style="margin:0">By client — click to filter</h3>
            {clientFilter ? <a class="btn btn-sm" href="/app/pipeline">✕ Clear filter: {clientFilter}</a> : null}
          </div>
          <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px">
            {[...byClient.entries()].sort((a, b) => b[1].v - a[1].v).map(([name, st]) => (
              <a class={`btn btn-sm${clientFilter === name ? " btn-primary" : ""}`} href={clientFilter === name ? "/app/accounts/deals" : `/app/pipeline?client=${encodeURIComponent(name)}`}>
                {name} · {formatZAR(st.v)} <span class="muted">({st.n})</span>
              </a>
            ))}
          </div>
        </div>

        {byStaff.size > 0 ? (
          <div class="card section-block">
            <h3>Commission owed per staff member — invoiced/paid deals only</h3>
            <div class="row" style="gap:24px;flex-wrap:wrap">
              {[...byStaff.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
                <div><strong>{name}</strong> <span class="warn">{formatZAR(amt)}</span></div>
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
                  <th>Quote #</th><th>PO #</th><th>Invoice #</th><th>Expected pay</th>
                  <th>Stage</th><th>Fcast</th><th>Invoiced</th><th>Paid</th><th>Invoice nett</th><th>Comm %</th><th>Commission</th><th></th>
                </tr>
              </thead>
              <tbody>
                {all.map(({ d, t }) => (
                  <>
                  <tr style={openId === d.id ? "background:rgba(79,140,255,.08)" : ""}>
                    <td style="text-align:left">
                      <a href={openId === d.id ? "/app/accounts/deals" : `/app/pipeline?open=${d.id}`} style="font-weight:600">
                        {d.allocation} <span class="muted" style="font-size:10px">{openId === d.id ? "▲" : "▼"}</span>
                      </a>
                    </td>
                    <td>{d.deal_date ? formatDMY(d.deal_date) : "—"}</td>
                    <td>{d.staff}</td>
                    <td class="muted">{d.client || "—"}</td>
                    <td class="muted">{d.quote_no || "—"}</td>
                    <td class="muted">{d.po_number || "—"}</td>
                    <td class="muted">{d.invoice_no || "—"}</td>
                    <td class="muted">{d.expected_payment ? formatDMY(d.expected_payment) : "—"}</td>
                    <td>
                      <form method="post" action="/app/accounts/deals/stage" style="margin:0">
                        <input type="hidden" name="id" value={d.id} />
                        <select name="stage" onchange="this.form.submit()" style="padding:4px 8px;font-size:12px;width:auto">
                          {COMM_STAGES.map((s) => <option value={s} selected={d.stage === s}>{STAGE_LABEL[s]}</option>)}
                        </select>
                      </form>
                    </td>
                    <td>
                      <form method="post" action="/app/accounts/deals/forecast-flag" style="margin:0">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="include" value={d.include_forecast ? "0" : "1"} />
                        <button class="btn btn-sm" type="submit" title={d.include_forecast ? "Included in the cash forecast — click to exclude" : "Excluded from the cash forecast — click to include"}
                          style={d.include_forecast ? "color:var(--accent-2)" : "opacity:.45"}>{d.include_forecast ? "✓" : "—"}</button>
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
                      {(() => { const st = commissionState(d); return st === "none" ? null :
                        <div class="cellhint">{st === "estimated" ? "potential" : st === "earned" ? "owed — invoiced" : "payable — deal paid"}</div>; })()}
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
                      <td colspan={16} style="text-align:left;background:#0c0f14;padding:14px 18px">
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
            <div><label>Date</label><DateField name="deal_date" /></div>
            <div><label>Expected payment</label><DateField name="expected_payment" /></div>
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

      <form method="post" action="/app/accounts/deals/expected" class="row" style="gap:8px;align-items:center;margin-bottom:12px">
        <input type="hidden" name="id" value={deal.id} />
        <label style="margin:0;font-size:13px">Expected payment</label>
        <div style="width:130px"><DateField name="expected_payment" value={deal.expected_payment ? formatDMY(deal.expected_payment) : ""} /></div>
        <button class="btn btn-sm" type="submit">Save</button>
        <span class="muted" style="font-size:12px">unpaid deals marked Fcast ✓ show as pipeline income on the <a href="/app/finance/forecast?t=monthly">Forecast</a></span>
      </form>

      <details style="margin-bottom:14px">
        <summary style="cursor:pointer;color:var(--accent);font-size:13px">✏️ Edit deal details</summary>
        <form method="post" action="/app/accounts/deals/update" class="formgrid" style="margin-top:12px">
          <input type="hidden" name="id" value={deal.id} />
          <div><label>Allocation</label><input type="text" name="allocation" value={deal.allocation} required style="text-align:left" /></div>
          <div><label>Staff (earner)</label><input type="text" name="staff" value={deal.staff} required style="text-align:left" /></div>
          <div><label>Client</label><input type="text" name="client" value={deal.client ?? ""} style="text-align:left" /></div>
          <div><label>Date</label><DateField name="deal_date" value={deal.deal_date ? formatDMY(deal.deal_date) : ""} /></div>
          <div><label>Expected payment</label><DateField name="expected_payment" value={deal.expected_payment ? formatDMY(deal.expected_payment) : ""} /></div>
          <div><label>Quote #</label><input type="text" name="quote_no" value={deal.quote_no ?? ""} style="text-align:left" /></div>
          <div><label>PO #</label><input type="text" name="po_number" value={deal.po_number ?? ""} style="text-align:left" /></div>
          <div><label>Invoice #</label><input type="text" name="invoice_no" value={deal.invoice_no ?? ""} style="text-align:left" /></div>
          <div><button class="btn btn-primary" type="submit">Save details</button></div>
        </form>
      </details>
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
        <div><label>Date</label><DateField name="tx_date" /></div>
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
