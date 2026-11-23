import type { FC } from "hono/jsx";
import { Layout, Info } from "./layout";
import { label, formatDMYTime } from "../lib/period";

export type CloseCheck = {
  label: string;
  level: "block" | "warn";
  pass: boolean;
  detail: string | null;
  href: string | null;
};

export type CloseAuditRow = {
  at: string;
  actor: string | null;
  entity: string;
  action: string;
  entityId: string | null;
};

export type ClientClosePageProps = {
  period: string;
  months: { period: string; status: "open" | "closed" }[];
  status: "open" | "closed";
  closedAt: string | null;
  checks: CloseCheck[];
  /** All block-level checks pass. */
  canClose: boolean;
  postCloseWarning: string | null;
  /** Last 50 audit entries. */
  audit: CloseAuditRow[];
  error: string | null;
};

/**
 * Month-end close — the pre-close checklist (blocking and warning checks with
 * fix links), the close/reopen actions, and the audit trail for the period.
 */
export const ClientClosePage: FC<ClientClosePageProps> = ({
  period,
  months,
  status,
  closedAt,
  checks,
  canClose,
  postCloseWarning,
  audit,
  error,
}) => {
  const warningsExist = checks.some((c) => c.level === "warn" && !c.pass);
  return (
    <Layout title="Month-end close" authed section="clients" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Month-end close</h1>
            <p class="muted" style="margin-top:0">
              Closing freezes {label(period)}'s client numbers — later syncs and edits can't change a closed month
              without reopening it first.{" "}
              <Info text="Blocking checks (red) must pass before closing. Warnings (amber) can be acknowledged and closed over, and are listed in the audit trail." />
            </p>
          </div>
          <a class="btn btn-sm" style="margin-top:16px" href="/app/clients">← Clients</a>
        </div>

        <div class="segmented section-block" style="flex-wrap:wrap">
          {months.map((m) => (
            <a href={`/app/clients/close?period=${m.period}`} class={m.period === period ? "seg active" : "seg"}>
              {label(m.period)}
              {m.status === "closed" ? <span class="badge income" style="margin-left:6px">closed</span> : null}
            </a>
          ))}
        </div>

        {error ? (
          <div class="callout section-block" style="border-left-color:var(--danger)">
            <strong class="neg">Close failed:</strong> {error}
          </div>
        ) : null}
        {postCloseWarning ? (
          <div class="callout section-block" style="border-left-color:#f6c453">{postCloseWarning}</div>
        ) : null}

        {status === "closed" ? (
          <div class="card section-block">
            <div class="row spread">
              <div>
                <span class="badge income">✓ {label(period)} is closed</span>
                <p class="muted" style="font-size:13px;margin:8px 0 0">
                  Closed {closedAt ? formatDMYTime(closedAt) : "—"}. The period's numbers are frozen.
                </p>
              </div>
              <form
                method="post"
                action="/app/clients/close/reopen"
                style="margin:0"
                onsubmit={`return confirm('Reopen ${label(period)}? Its numbers can change again until it is re-closed, and the reopen is recorded in the audit trail.')`}
              >
                <input type="hidden" name="period" value={period} />
                <button class="btn btn-sm btn-danger" type="submit">Reopen {label(period)}</button>
              </form>
            </div>
          </div>
        ) : (
          <>
            <div class="section-block tablewrap">
              <table class="grid">
                <thead>
                  <tr>
                    <th style="text-align:left;width:40px"></th>
                    <th style="text-align:left">Check</th>
                    <th style="text-align:left">Level</th>
                    <th style="text-align:left">Detail</th>
                    <th style="text-align:left"></th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((c) => (
                    <tr>
                      <td style="text-align:left">
                        {c.pass ? <span class="pos">✓</span> : <span class={c.level === "block" ? "neg" : "warn"}>✗</span>}
                      </td>
                      <td style="text-align:left">{c.label}</td>
                      <td style="text-align:left">
                        {c.pass ? (
                          <span class="muted" style="font-size:12px">—</span>
                        ) : c.level === "block" ? (
                          <span class="badge cost">blocks close</span>
                        ) : (
                          <span class="badge estimate">warning</span>
                        )}
                      </td>
                      <td style="text-align:left" class="muted">{c.detail ?? "—"}</td>
                      <td style="text-align:left">{c.href && !c.pass ? <a href={c.href}>Fix →</a> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form method="post" action="/app/clients/close/run" class="card section-block" style="max-width:640px">
              <input type="hidden" name="period" value={period} />
              <h3>Close {label(period)}</h3>
              {warningsExist ? (
                <label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text)">
                  <input type="checkbox" name="ack" value="1" required style="width:auto" />
                  I acknowledge the warnings above and want to close anyway.
                </label>
              ) : null}
              <div class="toolbar" style="margin-bottom:0">
                <button class="btn btn-primary" type="submit" disabled={!canClose}>
                  Close {label(period)}
                </button>
                {!canClose ? (
                  <span class="muted" style="font-size:12px">Resolve the blocking checks first.</span>
                ) : null}
              </div>
            </form>
          </>
        )}

        <div class="section-block">
          <h2>Audit trail</h2>
          <p class="muted" style="font-size:13px;margin-top:4px">Last 50 changes touching this module.</p>
          <div class="tablewrap" style="max-width:860px">
            <table class="grid" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px">
              <thead>
                <tr>
                  <th style="text-align:left">When</th>
                  <th style="text-align:left">Actor</th>
                  <th style="text-align:left">Entity</th>
                  <th style="text-align:left">Action</th>
                  <th style="text-align:left">Id</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 ? (
                  <tr><td colspan={5} style="text-align:left" class="muted">No audit entries yet.</td></tr>
                ) : null}
                {audit.map((a) => (
                  <tr>
                    <td style="text-align:left" class="muted">{formatDMYTime(a.at)}</td>
                    <td style="text-align:left">{a.actor ?? "—"}</td>
                    <td style="text-align:left">{a.entity}</td>
                    <td style="text-align:left">{a.action}</td>
                    <td style="text-align:left" class="muted">{a.entityId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
};
