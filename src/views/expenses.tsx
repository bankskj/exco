import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { type RecurringExpense, FREQUENCIES, monthlyEquivalent } from "../data/expenses";
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

export const ExpensesPage: FC<{
  expenses: RecurringExpense[];
  xero: XeroState;
  msg?: string;
}> = ({ expenses, xero, msg }) => {
  const active = expenses.filter((e) => e.active);
  const monthlyTotal = active.reduce((s, e) => s + monthlyEquivalent(e), 0);
  const fromXero = active.filter((e) => e.source === "xero").length;

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
            <p class="muted" style="margin-top:0">Standing costs — captured here or synced from Xero repeating bills.</p>
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

        <div class="grid section-block" style="grid-template-columns:1.5fr 1fr;gap:18px">
          <div>
            <div class="tablewrap">
              <table class="grid">
                <thead>
                  <tr><th>Expense</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Frequency</th><th>Monthly equiv</th><th>Next</th><th>Source</th><th></th></tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr style={e.active ? "" : "opacity:.45"}>
                      <td>{e.name}</td>
                      <td class="muted">{e.vendor || "—"}</td>
                      <td class="muted">{e.category || "—"}</td>
                      <td class="num">{formatZAR(e.amount)}{e.currency !== "ZAR" ? <span class="muted"> {e.currency}</span> : null}</td>
                      <td>{e.frequency}</td>
                      <td class="num">{formatZAR(monthlyEquivalent(e))}</td>
                      <td>{e.next_date ? formatDMY(e.next_date) : "—"}</td>
                      <td>{e.source === "xero" ? <span class="badge recurring">xero</span> : <span class="badge actual">manual</span>}</td>
                      <td>
                        <div class="row" style="gap:6px">
                          <form method="post" action="/app/expenses/toggle" style="margin:0">
                            <input type="hidden" name="id" value={e.id} />
                            <button class="btn btn-sm" type="submit">{e.active ? "Pause" : "Resume"}</button>
                          </form>
                          <form method="post" action="/app/expenses/delete" style="margin:0"
                            onsubmit="return confirm('Delete this expense?')">
                            <input type="hidden" name="id" value={e.id} />
                            <button class="btn btn-sm btn-danger" type="submit">✕</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr class="total">
                    <td>Total (active)</td><td></td><td></td><td></td><td></td>
                    <td class="num">{formatZAR(monthlyTotal)}</td><td></td><td></td><td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="card section-block">
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
          <form method="post" action="/app/expenses/sync" style="margin:0">
            <button class="btn btn-sm btn-primary" type="submit">Sync repeating bills</button>
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
          In the Xero developer portal, the app's redirect URI must include: <code>https://exco.elula.workers.dev/app/xero/callback</code>
        </p>
      </div>
    ) : !xero.connected ? (
      <p class="muted" style="margin:12px 0 0">
        Credentials are set. Click <strong>Connect Xero</strong>, sign in, and pick the organisation — then Sync pulls
        all authorised repeating bills (ACCPAY) in as expenses.
      </p>
    ) : (
      <p class="muted" style="margin:12px 0 0">
        Sync upserts by Xero ID: amounts, schedules and next dates refresh; rows you've paused stay paused. Manual
        expenses are never touched.
      </p>
    )}
  </div>
);
