import type { FC } from "hono/jsx";
import { Layout, Info } from "./layout";
import { formatZAR } from "../lib/money";
import { formatDMY } from "../lib/period";
import { BillingPeriodTabs, type BillingPeriodKey } from "./clients";

/** Cents → whole-rand display. */
const R = (c: number) => formatZAR(Math.round(c / 100));

export type RevenueLineRow = {
  id: string;
  txnDate: string;
  docNumber: string | null;
  docType: string | null;
  contactName: string | null;
  clientName: string | null;
  projectName: string | null;
  isDefaultProject: boolean;
  reportGroup: string;
  amountC: number;
  source: string;
};

export type RevenueLinesPageProps = {
  periodKey: BillingPeriodKey;
  periodLabel: string;
  /** Contacts with no client mapping (their revenue landed in General Sales). */
  unmapped: { contactName: string; amountC: number; lineCount: number }[];
  lines: RevenueLineRow[];
  clients: { id: string; name: string }[];
  projects: { id: string; label: string; clientId: string }[];
  totalC: number;
  /** Line id whose project-override row is open (?open=). */
  openLine: string | null;
};

/**
 * Revenue lines — every revenue line in the period with its resolved client
 * and project, an unmapped-contacts queue at the top, and a per-line project
 * override.
 */
export const RevenueLinesPage: FC<RevenueLinesPageProps> = ({
  periodKey,
  periodLabel,
  unmapped,
  lines,
  clients,
  projects,
  totalC,
  openLine,
}) => {
  const base = `/app/revenue?p=${periodKey}`;
  return (
    <Layout title="Revenue lines" authed section="clients" wide>
      <div class="container" style="max-width:1320px">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Revenue lines</h1>
            <p class="muted" style="margin-top:0">
              Every invoice/credit-note line in {periodLabel} and the client it resolves to.{" "}
              <Info text="A line's client comes from the contact mapping; its project is the client's default unless overridden per line. Unmapped contacts land in General Sales until mapped." />
            </p>
          </div>
          <a class="btn btn-sm" style="margin-top:16px" href="/app/clients">← Clients</a>
        </div>

        <div class="section-block">
          <BillingPeriodTabs active={periodKey} base="/app/revenue" />
        </div>

        {unmapped.length > 0 ? (
          <div class="card section-block" style="border-color:rgba(255,107,107,.4)">
            <h3>Unmapped contacts — {unmapped.length}</h3>
            <p class="muted" style="font-size:12px;margin:0 0 10px">
              Revenue from these contacts is sitting in General Sales. Map each to a client and it moves on the next recompute.
            </p>
            <table style="border-collapse:collapse;font-size:13px;width:100%">
              <tbody>
                {unmapped.map((u) => (
                  <tr>
                    <td style="padding:5px 16px 5px 0"><strong>{u.contactName}</strong></td>
                    <td style="padding:5px 16px 5px 0;text-align:right;font-variant-numeric:tabular-nums" class={u.amountC < 0 ? "neg" : ""}>
                      {R(u.amountC)}
                    </td>
                    <td style="padding:5px 16px 5px 0" class="muted">{u.lineCount} line(s)</td>
                    <td style="padding:5px 0">
                      <form method="post" action="/app/revenue/map-contact" class="row" style="gap:8px;margin:0">
                        <input type="hidden" name="contact" value={u.contactName} />
                        <input type="hidden" name="p" value={periodKey} />
                        <select name="client" style="width:auto;min-width:180px;padding:5px 8px;font-size:13px">
                          {clients.map((c) => <option value={c.id}>{c.name}</option>)}
                        </select>
                        <button class="btn btn-sm btn-primary" type="submit">Map</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div class="section-block tablewrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="text-align:left">Date</th>
                <th style="text-align:left">Doc</th>
                <th style="text-align:left">Contact</th>
                <th style="text-align:left">Client</th>
                <th style="text-align:left">Project</th>
                <th style="text-align:left">Group</th>
                <th>Amount</th>
                <th style="text-align:left">Source</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colspan={8} style="text-align:left" class="muted">No revenue lines in {periodLabel}.</td></tr>
              ) : null}
              {lines.map((l) => {
                const isOpen = openLine === l.id;
                return (
                  <>
                    <tr style={isOpen ? "background:rgba(79,140,255,.08)" : ""}>
                      <td style="text-align:left">{formatDMY(l.txnDate)}</td>
                      <td style="text-align:left">
                        {l.docNumber ?? "—"}
                        {l.docType ? <span class="cellhint"> {l.docType.toLowerCase()}</span> : null}
                      </td>
                      <td style="text-align:left">{l.contactName ?? <span class="muted">—</span>}</td>
                      <td style="text-align:left">{l.clientName ?? <span class="badge cost">unmapped</span>}</td>
                      <td style="text-align:left">
                        <a href={isOpen ? base : `${base}&open=${encodeURIComponent(l.id)}`}>
                          {l.projectName ?? "—"} <span class="muted" style="font-size:10px">{isOpen ? "▲" : "▼"}</span>
                        </a>
                        {l.isDefaultProject ? <span class="cellhint"> default</span> : null}
                      </td>
                      <td style="text-align:left" class="muted">{l.reportGroup}</td>
                      <td class={`num ${l.amountC < 0 ? "neg" : ""}`}>{R(l.amountC)}</td>
                      <td style="text-align:left">
                        {l.source === "csv" ? (
                          <span class="badge manual">csv</span>
                        ) : l.source === "manual" ? (
                          <span class="badge manual">manual</span>
                        ) : (
                          <span class="badge recurring">{l.source}</span>
                        )}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colspan={8} style="text-align:left;background:#0c0f14;padding:14px 18px">
                          <form method="post" action="/app/revenue/project-override" class="row" style="gap:10px;margin:0">
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="p" value={periodKey} />
                            <strong style="font-size:13px">Project override</strong>
                            <select name="project" style="width:auto;min-width:220px;padding:6px 8px;font-size:13px">
                              <option value="" selected={l.isDefaultProject}>(client default)</option>
                              {projects.map((p) => <option value={p.id}>{p.label}</option>)}
                            </select>
                            <button class="btn btn-sm btn-primary" type="submit">Save</button>
                            <span class="muted" style="font-size:12px">
                              Blank puts the line back on the client's default project.
                            </span>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
              <tr class="total">
                <td style="text-align:left">Total ({lines.length} lines)</td>
                <td></td><td></td><td></td><td></td><td></td>
                <td class={`num ${totalC < 0 ? "neg" : ""}`}>{R(totalC)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card section-block" style="max-width:560px">
          <h3>Import revenue lines (CSV)</h3>
          <form method="post" action="/app/revenue/import" enctype="multipart/form-data" class="row" style="gap:10px">
            <input type="file" name="file" accept=".csv" required style="width:260px;font-size:12px;color:var(--muted)" />
            <button class="btn btn-sm" type="submit">Import CSV</button>
          </form>
          <p class="muted" style="font-size:12px;margin:8px 0 0">
            Columns: date, doc number, contact, account code, description, amount (credit notes negative).
          </p>
        </div>
      </div>
    </Layout>
  );
};
