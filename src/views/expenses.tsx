import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { type RecurringExpense, type VendorBill, type BillingPattern, FREQUENCIES, monthlyEquivalent } from "../data/expenses";
import type { XeroState } from "../lib/xero";
import { formatZAR } from "../lib/money";
import { formatDMY } from "../lib/period";
import { hBars } from "../lib/charts";

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const PAGE_SIZE = 20;

type SortKey = "name" | "amount" | "monthly";

export const ExpensesPage: FC<{
  expenses: RecurringExpense[];
  xero: XeroState;
  page: number;
  sort: SortKey;
  dir: "asc" | "desc";
  openId: string | null;
  openBills: VendorBill[];
  patterns: Map<string, BillingPattern>;
  msg?: string;
}> = ({ expenses, xero, page, sort, dir, openId, openBills, patterns, msg }) => {
  const active = expenses.filter((e) => e.active);
  const monthlyTotal = active.reduce((s, e) => s + monthlyEquivalent(e), 0);
  const fromXero = active.filter((e) => e.source === "xero").length;
  const pageCount = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pageCount);
  const rows = expenses.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  // Sortable header link: clicking the active column flips direction; a new column gets its natural default.
  const sortHref = (col: SortKey) => {
    const nextDir = sort === col ? (dir === "asc" ? "desc" : "asc") : col === "name" ? "asc" : "desc";
    return `/app/expenses?sort=${col}&dir=${nextDir}`;
  };
  const arrow = (col: SortKey) => (sort === col ? (dir === "asc" ? " ▲" : " ▼") : "");
  const listQs = `sort=${sort}&dir=${dir}`;
  const vendorKey = (e: RecurringExpense) => (e.xero_id?.startsWith("vendor:") ? e.xero_id.slice(7) : null);
  const rowQs = `page=${p}&${listQs}`;

  const byCategory = (() => {
    const m = new Map<string, number>();
    for (const e of active) m.set(e.category || e.vendor || "Uncategorised", (m.get(e.category || e.vendor || "Uncategorised") ?? 0) + monthlyEquivalent(e));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  })();

  return (
    <Layout title="Recurring expenses" authed section="expenses" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Recurring expenses</h1>
            <p class="muted" style="margin-top:0">Standing costs — captured here or detected from your Xero bills.</p>
          </div>
          <a class="btn btn-sm" href="/app/expenses/export.csv">⬇ Export CSV</a>
        </div>

        {msg ? <div class="callout section-block">{msg}</div> : null}

        <div class="kpis section-block">
          <Kpi label="Monthly total" value={formatZAR(monthlyTotal)} sub={`${active.length} active expenses`} />
          <Kpi label="Annualised" value={formatZAR(monthlyTotal * 12)} />
          <Kpi label="From Xero" value={String(fromXero)} sub={xero.orgName ?? "not connected"} />
          <Kpi label="Last Xero sync" value={xero.lastSync ? formatDMY(xero.lastSync.slice(0, 10)) : "—"} />
        </div>

        <XeroCard xero={xero} />

        <div class="section-block">
          <div class="tablewrap">
            <table class="grid fixed wrap">
              <colgroup>
                <col style="width:24%" />
                <col style="width:12%" />
                <col style="width:11%" />
                <col style="width:15%" />
                <col style="width:11%" />
                <col style="width:9%" />
                <col style="width:7%" />
                <col style="width:11%" />
              </colgroup>
              <thead>
                <tr>
                  <th style="text-align:left"><a href={sortHref("name")} style="color:inherit">Expense{arrow("name")}</a></th>
                  <th>Category</th>
                  <th><a href={sortHref("amount")} style="color:inherit">Amount{arrow("amount")}</a></th>
                  <th>Frequency</th>
                  <th><a href={sortHref("monthly")} style="color:inherit">Monthly equiv{arrow("monthly")}</a></th>
                  <th>Next</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <>
                  <tr style={e.active ? "" : "opacity:.45"}>
                    <td style="text-align:left">
                      {vendorKey(e) ? (
                        <a href={openId === e.id ? `/app/expenses?${rowQs}` : `/app/expenses?${rowQs}&open=${e.id}`}
                          style="color:inherit;font-weight:600">
                          {e.name} <span class="muted" style="font-size:10px">{openId === e.id ? "▲" : "▼"}</span>
                        </a>
                      ) : (
                        e.name
                      )}
                      {e.vendor && e.vendor !== e.name ? <div class="muted" style="font-size:11px">{e.vendor}</div> : null}
                    </td>
                    <td class="muted">{e.category || "—"}</td>
                    <td class="num">{formatZAR(e.amount)}{e.currency !== "ZAR" ? <span class="muted"> {e.currency}</span> : null}</td>
                    <td>
                      <form method="post" action="/app/expenses/frequency" style="margin:0">
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="page" value={String(p)} />
                        <input type="hidden" name="sort" value={sort} />
                        <input type="hidden" name="dir" value={dir} />
                        <select name="frequency" onchange="this.form.submit()"
                          style="width:100%;padding:4px 6px;font-size:12px;background:transparent;border-color:transparent"
                          title={e.frequency + (e.freq_locked ? " · manually set" : "")}>
                          {FREQUENCIES.map((f) => (
                            <option value={f.key} selected={Math.abs(e.interval_months - f.months) < 0.01}>
                              {f.label}{e.freq_locked && Math.abs(e.interval_months - f.months) < 0.01 ? " 🔒" : ""}
                            </option>
                          ))}
                        </select>
                        {e.frequency.includes("detected") ? <div class="cellhint" style="text-align:left;padding-left:6px">{e.frequency.replace(/^[a-z]+ /, "")}</div> : null}
                      </form>
                    </td>
                    <td class="num"><strong>{formatZAR(monthlyEquivalent(e))}</strong></td>
                    <td>{e.next_date ? formatDMY(e.next_date) : (() => { const k = vendorKey(e); const pat = k ? patterns.get(k) : null; return pat ? <span class="muted" style="font-size:12px">{pat.label}</span> : "—"; })()}</td>
                    <td>{e.source === "xero" ? <span class="badge recurring">xero</span> : <span class="badge actual">manual</span>}</td>
                    <td>
                      <div class="row" style="gap:6px;justify-content:flex-end">
                        <form method="post" action="/app/expenses/toggle" style="margin:0">
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="page" value={String(p)} />
                          <input type="hidden" name="sort" value={sort} />
                          <input type="hidden" name="dir" value={dir} />
                          <button class="btn btn-sm" type="submit">{e.active ? "Pause" : "Resume"}</button>
                        </form>
                        <form method="post" action="/app/expenses/delete" style="margin:0"
                          onsubmit="return confirm('Delete this expense?')">
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="page" value={String(p)} />
                          <input type="hidden" name="sort" value={sort} />
                          <input type="hidden" name="dir" value={dir} />
                          <button class="btn btn-sm btn-danger" type="submit">✕</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                  {openId === e.id ? (
                    <tr>
                      <td colspan={8} style="text-align:left;background:#0c0f14;padding:14px 18px">
                        <BillDrawer e={e} bills={openBills} pattern={(() => { const k = vendorKey(e); return k ? patterns.get(k) ?? null : null; })()} />
                      </td>
                    </tr>
                  ) : null}
                  </>
                ))}
                <tr class="total">
                  <td style="text-align:left">Total — all active ({active.length})</td>
                  <td></td><td></td><td></td>
                  <td class="num">{formatZAR(monthlyTotal)}</td>
                  <td></td><td></td><td></td>
                </tr>
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <div class="pager">
              {p > 1 ? <a class="btn btn-sm" href={`/app/expenses?page=${p - 1}&${listQs}`}>← Prev</a> : null}
              <span class="muted">Page {p} of {pageCount} · {expenses.length} expenses</span>
              {p < pageCount ? <a class="btn btn-sm" href={`/app/expenses?page=${p + 1}&${listQs}`}>Next →</a> : null}
            </div>
          ) : null}
        </div>

        <div class="grid section-block" style="grid-template-columns:1.5fr 1fr;gap:18px">
          <div>
            <div class="card">
              <h3>Add expense</h3>
              <form method="post" action="/app/expenses/add" class="formgrid">
                <div><label>Name</label><input type="text" name="name" required placeholder="e.g. Google Workspace" /></div>
                <div><label>Vendor</label><input type="text" name="vendor" /></div>
                <div><label>Category</label><input type="text" name="category" placeholder="Software / Rent / ..." /></div>
                <div><label>Amount (R)</label><input type="text" inputmode="decimal" name="amount" required /></div>
                <div><label>Frequency</label>
                  <select name="frequency">
                    {FREQUENCIES.map((f) => <option value={f.key} selected={f.key === "monthly"}>{f.label}</option>)}
                  </select>
                </div>
                <div><label>Next date</label><input type="date" name="next_date" /></div>
                <div class="full"><label>Notes</label><input type="text" name="notes" /></div>
                <div><button class="btn btn-primary" type="submit">Add expense</button></div>
              </form>
            </div>
          </div>

          <div class="card" style="align-self:start">
            <h3>Monthly cost by category</h3>
            {byCategory.length ? (
              <div dangerouslySetInnerHTML={{ __html: hBars(byCategory, { color: "#ff6b6b" }) }} />
            ) : (
              <p class="muted">No active expenses yet.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

const XeroCard: FC<{ xero: XeroState }> = ({ xero }) => (
  <div class="card section-block">
    <div class="row spread">
      <h3 style="margin:0">Xero</h3>
      {xero.connected ? (
        <div class="row" style="gap:10px">
          <span class="badge income">connected · {xero.orgName ?? "org"}</span>
          <a class="btn btn-sm" href="/app/expenses/vendors">Review vendors</a>
          <form method="post" action="/app/expenses/sync" style="margin:0">
            <button class="btn btn-sm btn-primary" type="submit">Sync from Xero</button>
          </form>
          <form method="post" action="/app/xero/disconnect" style="margin:0"
            onsubmit="return confirm('Disconnect Xero? Synced rows stay; they just stop updating.')">
            <button class="btn btn-sm btn-danger" type="submit">Disconnect</button>
          </form>
        </div>
      ) : xero.configured ? (
        <a class="btn btn-sm btn-primary" href="/app/xero/connect">Connect Xero</a>
      ) : null}
    </div>
    {!xero.configured ? (
      <div style="margin-top:12px">
        <p class="muted" style="margin:0 0 10px">
          Xero credentials aren't set yet. Add them as Worker secrets (they never touch the code or git), then reload:
        </p>
        <pre style="background:#0c0f14;border:1px solid var(--border);border-radius:10px;padding:14px;font-size:13px;overflow-x:auto">npx wrangler secret put XERO_CLIENT_ID
npx wrangler secret put XERO_CLIENT_SECRET</pre>
        <p class="muted" style="font-size:12px;margin:10px 0 0">
          In the Xero developer portal, the app's redirect URI must include (exactly): <code>{xero.callbackUrl}</code>
        </p>
      </div>
    ) : !xero.connected ? (
      <div style="margin-top:12px">
        <p class="muted" style="margin:0 0 10px">
          Credentials are set. Before connecting, make sure this <strong>exact</strong> redirect URI is saved in your
          Xero app (developer.xero.com → My Apps → your app → Configuration → Redirect URIs):
        </p>
        <pre style="background:#0c0f14;border:1px solid var(--border);border-radius:10px;padding:14px;font-size:13px;overflow-x:auto">{xero.callbackUrl}</pre>
        <p class="muted" style="font-size:12px;margin:10px 0 0">
          No trailing slash, https, exact match — Xero rejects anything else with “Invalid redirect_uri”. Then click
          <strong> Connect Xero</strong>, sign in, and pick the organisation; Sync pulls authorised repeating bills in
          as expenses.
        </p>
      </div>
    ) : (
      <p class="muted" style="margin:12px 0 0">
        Sync pulls Xero repeating bills and detects recurring vendors from ordinary bills (3+ of the last 6 months, at
        average monthly spend). Vendors matching payroll names or contractor prefixes are excluded automatically —
        fine-tune everything in <a href="/app/expenses/vendors">Review vendors</a>. Runs automatically on the 1st of
        every month.
      </p>
    )}
  </div>
);

const BillDrawer: FC<{ e: RecurringExpense; bills: VendorBill[]; pattern: BillingPattern | null }> = ({ e, bills, pattern }) => {
  const total = bills.reduce((s, b) => s + b.amount, 0);
  return (
    <div>
      <div class="row spread" style="margin-bottom:10px">
        <strong>{e.name} — bill history (last 6 months)</strong>
        <span class="muted" style="font-size:12px">
          {bills.length} bill(s) · {formatZAR(total)} total
          {pattern ? <> · typically bills <strong>{pattern.label}</strong> (~day {pattern.day})</> : null}
        </span>
      </div>
      {bills.length === 0 ? (
        <p class="muted" style="margin:0">No bill history stored yet — run a Xero sync to populate it.</p>
      ) : (
        <table style="border-collapse:collapse;font-size:13px;min-width:420px">
          <thead>
            <tr>
              <th style="text-align:left;padding:4px 18px 4px 0;color:var(--muted)">Date</th>
              <th style="text-align:left;padding:4px 18px 4px 0;color:var(--muted)">Reference</th>
              <th style="text-align:right;padding:4px 0;color:var(--muted)">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr>
                <td style="padding:4px 18px 4px 0">{formatDMY(b.bill_date)}</td>
                <td style="padding:4px 18px 4px 0" class="muted">{b.reference || "—"}</td>
                <td style="padding:4px 0;text-align:right;font-variant-numeric:tabular-nums">{formatZAR(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
