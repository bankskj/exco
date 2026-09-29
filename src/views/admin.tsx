import type { FC } from "hono/jsx";
import { Layout, AsAt } from "./layout";
import type { XeroState } from "../lib/xero";
import type { Check } from "../lib/quality";
import { XeroCard } from "./expenses";

export const AdminTabs: FC<{ active: "xero" | "quality" }> = ({ active }) => (
  <div class="segmented" style="margin:14px 0 4px">
    <a href="/app/admin" class={active === "xero" ? "seg active" : "seg"}>Xero integration</a>
    <a href="/app/admin/quality" class={active === "quality" ? "seg active" : "seg"}>Data quality</a>
  </div>
);

export const AdminPage: FC<{ xero: XeroState; msg?: string; lastSyncLabel: string | null }> = ({ xero, msg, lastSyncLabel }) => (
  <Layout title="Admin" authed section="admin" wide>
    <div class="container">
      <h1 style="margin-top:12px">Administration</h1>
      <p class="muted" style="margin-top:0">
        Configuration and model controls — kept apart from management reporting.
      </p>
      <AsAt lastSync={lastSyncLabel} />

      <AdminTabs active="xero" />

      {msg ? <div class="callout section-block">{msg}</div> : null}

      <XeroCard xero={xero} />

      <div class="grid section-block" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
        <a class="card" href="/app/admin/vendors" style="color:var(--text);display:block">
          <h3>Vendor rules</h3>
          <p class="muted" style="font-size:13px;margin:0">
            Review detected vendors: track or exclude each one from recurring-cost detection, and inspect their bill
            history.
          </p>
        </a>
        <a class="card" href="/app/finance/forecast?t=assumptions" style="color:var(--text);display:block">
          <h3>Forecast assumptions</h3>
          <p class="muted" style="font-size:13px;margin:0">
            Books-complete boundary, the bank-statement anchor, facility limit, horizon and scenario percentages —
            on the Forecast page under Assumptions.
          </p>
        </a>
        <a class="card" href="/app/admin/quality" style="color:var(--text);display:block">
          <h3>Data quality</h3>
          <p class="muted" style="font-size:13px;margin:0">
            Live reconciliation checks: P&amp;L coverage, cash roll-forward, recurring-cost hygiene, people
            reconciliation, pipeline consistency.
          </p>
        </a>
      </div>
    </div>
  </Layout>
);

const ICON: Record<Check["status"], string> = { ok: "✓", warn: "⚠", fail: "✕" };
const TONE: Record<Check["status"], string> = { ok: "pos", warn: "warn", fail: "neg" };

export const DataQualityPage: FC<{ checks: Check[]; lastSyncLabel: string | null }> = ({ checks, lastSyncLabel }) => {
  const groups = [...new Set(checks.map((c) => c.group))];
  const bad = checks.filter((c) => c.status !== "ok").length;
  return (
    <Layout title="Data quality" authed section="admin" wide>
      <div class="container">
        <h1 style="margin-top:12px">Data quality</h1>
        <p class="muted" style="margin-top:0">
          Reconciliation checks run live on every load — problems surface here instead of reaching management as
          inconsistent totals. {bad ? <strong class="warn">{bad} item(s) need attention.</strong> : <strong class="pos">All checks pass.</strong>}
        </p>
        <AsAt lastSync={lastSyncLabel} />

        <AdminTabs active="quality" />

        {groups.map((g) => (
          <div class="card section-block">
            <h3>{g}</h3>
            <table style="border-collapse:collapse;font-size:13px;width:100%">
              <tbody>
                {checks.filter((c) => c.group === g).map((c) => (
                  <tr>
                    <td style={`padding:6px 12px 6px 0;width:24px;font-weight:700`} class={TONE[c.status]}>{ICON[c.status]}</td>
                    <td style="padding:6px 16px 6px 0;white-space:nowrap;font-weight:600">{c.name}</td>
                    <td style="padding:6px 0" class="muted">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Layout>
  );
};
