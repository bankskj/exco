import type { FC } from "hono/jsx";
import { Layout, Info } from "./layout";
import { formatZAR } from "../lib/money";
import { formatDMY } from "../lib/period";
import { BillingPeriodTabs, type BillingPeriodKey } from "./clients";

/** Cents → whole-rand display (cents only appear in drill-downs). */
const R = (c: number) => formatZAR(Math.round(c / 100));

// ---------------------------------------------------------------------------
// Cost inbox
// ---------------------------------------------------------------------------

export type CostInboxTab = "unassigned" | "unmatched" | "byrule" | "assigned" | "overhead" | "excluded";

const INBOX_TABS: { key: CostInboxTab; label: string }[] = [
  { key: "unassigned", label: "Unassigned" },
  { key: "unmatched", label: "Unmatched staff" },
  { key: "byrule", label: "By rule" },
  { key: "assigned", label: "Assigned" },
  { key: "overhead", label: "Overhead" },
  { key: "excluded", label: "Excluded" },
];

export type CostInboxLine = {
  id: string;
  txnDate: string;
  supplier: string | null;
  description: string | null;
  glCode: string | null;
  reportGroup: string;
  treatment: string;
  amountC: number;
  docKind: string | null;
  /** Human-readable current target, e.g. "ABF Sugar — default", "Rule: Hetzner split". */
  target: string;
  employeeName: string | null;
  hasSplits: boolean;
  ruleName: string | null;
};

export type CostInboxPageProps = {
  periodKey: BillingPeriodKey;
  periodLabel: string;
  tab: CostInboxTab;
  counts: Record<CostInboxTab, number>;
  lines: CostInboxLine[];
  /** Assignable targets (grouped labels incl client names). */
  projects: { id: string; label: string }[];
  staffOptions: { id: string; name: string }[];
  /** Line id whose inline editor row is open (?split= / ?map=). */
  openSplit: string | null;
};

const TargetSelect: FC<{ name: string; projects: { id: string; label: string }[]; allowEmpty?: boolean }> = ({
  name,
  projects,
  allowEmpty,
}) => {
  const clients = projects.filter((p) => !p.id.startsWith("staff:"));
  const staff = projects.filter((p) => p.id.startsWith("staff:"));
  return (
    <select name={name} style="width:auto;min-width:200px;padding:6px 8px;font-size:13px">
      {allowEmpty ? <option value="">—</option> : null}
      <optgroup label="Clients & projects">
        {clients.map((p) => <option value={p.id}>{p.label}</option>)}
      </optgroup>
      <optgroup label="Pool / excluded">
        <option value="overhead">Shared Overhead</option>
        <option value="excluded">Excluded</option>
      </optgroup>
      <optgroup label="Staff — follows their share %">
        {staff.map((p) => <option value={p.id}>{p.label.replace(/^Staff: /, "")}</option>)}
      </optgroup>
    </select>
  );
};

/**
 * Cost inbox — every cost line in the period, split into queues (tabs). Row
 * actions open a server-rendered inline editor row (?split={id}) holding the
 * assign / split / map-payee forms; a bulk bar assigns many lines at once via
 * the form="bulkform" attribute trick.
 */
export const CostInboxPage: FC<CostInboxPageProps> = ({
  periodKey,
  periodLabel,
  tab,
  counts,
  lines,
  projects,
  staffOptions,
  openSplit,
}) => {
  const base = `/app/costs?p=${periodKey}&tab=${tab}`;
  const total = lines.reduce((s, l) => s + l.amountC, 0);
  return (
    <Layout title="Cost inbox" authed section="clients" wide>
      <div class="container" style="max-width:1320px">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Cost inbox</h1>
            <p class="muted" style="margin-top:0">
              Every cost line and where it lands. Work the <strong>Unassigned</strong> and{" "}
              <strong>Unmatched staff</strong> queues down to zero before closing the month.{" "}
              <Info text="Unassigned direct costs fall to General Sales until you assign them to a project, the overhead pool, or exclude them. Save as rule to auto-assign the same supplier next month." />
            </p>
          </div>
          <a class="btn btn-sm" style="margin-top:16px" href="/app/costs/rules">Rules →</a>
        </div>

        <div class="row section-block" style="gap:10px;align-items:center">
          <div class="segmented">
            {INBOX_TABS.map((t) => (
              <a href={`/app/costs?p=${periodKey}&tab=${t.key}`} class={tab === t.key ? "seg active" : "seg"}>
                {t.label} <span class="muted" style="font-size:11px">({counts[t.key]})</span>
              </a>
            ))}
          </div>
          <BillingPeriodTabs active={periodKey} base="/app/costs" extraQS={`tab=${tab}`} />
        </div>

        {/* The bulk bar is its own form; row checkboxes reference it via form="bulkform". */}
        <form id="bulkform" method="post" action="/app/costs/assign" class="row section-block" style="gap:10px">
          <input type="hidden" name="p" value={periodKey} />
          <input type="hidden" name="tab" value={tab} />
          <span class="muted" style="font-size:13px">Apply to ticked lines:</span>
          <TargetSelect name="target" projects={projects} />
          <button class="btn btn-sm" type="submit">Assign selected</button>
        </form>

        <div class="section-block tablewrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="text-align:left;width:28px"></th>
                <th style="text-align:left">Date</th>
                <th style="text-align:left">Supplier</th>
                <th style="text-align:left">Description</th>
                <th style="text-align:left">Account</th>
                <th>Amount</th>
                <th style="text-align:left">Current target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colspan={8} style="text-align:left" class="muted">Nothing in this queue for {periodLabel}.</td>
                </tr>
              ) : null}
              {lines.map((l) => {
                const isOpen = openSplit === l.id;
                const desc = l.description ?? "";
                const toggleHref = isOpen ? base : `${base}&split=${encodeURIComponent(l.id)}`;
                return (
                  <>
                    <tr style={isOpen ? "background:rgba(79,140,255,.08)" : ""}>
                      <td style="text-align:left">
                        <input type="checkbox" name="ids" value={l.id} form="bulkform" />
                      </td>
                      <td style="text-align:left">{formatDMY(l.txnDate)}</td>
                      <td style="text-align:left">
                        {l.supplier ?? <span class="muted">—</span>}
                        {l.employeeName ? <div class="cellhint">staff: {l.employeeName}</div> : null}
                      </td>
                      <td style="text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis" title={desc}>
                        {desc.length > 48 ? `${desc.slice(0, 48)}…` : desc || <span class="muted">—</span>}
                      </td>
                      <td style="text-align:left">
                        {l.glCode ?? "—"} <span class="muted" style="font-size:11px">{l.reportGroup}</span>
                      </td>
                      <td class={`num ${l.amountC < 0 ? "neg" : ""}`}>{R(l.amountC)}</td>
                      <td style="text-align:left">
                        {l.target}
                        {l.ruleName ? <span class="badge recurring" style="margin-left:6px">{l.ruleName}</span> : null}
                        {l.hasSplits ? <span class="badge manual" style="margin-left:6px">split</span> : null}
                      </td>
                      <td style="text-align:left">
                        <a href={toggleHref} class="btn btn-sm">
                          {tab === "unmatched" ? "Map payee" : "Assign / split"} {isOpen ? "▲" : "▼"}
                        </a>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colspan={8} style="text-align:left;background:#0c0f14;padding:16px 20px">
                          {tab === "unmatched" ? (
                            <form method="post" action="/app/costs/map-payee" class="row" style="gap:10px">
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="p" value={periodKey} />
                              <input type="hidden" name="tab" value={tab} />
                              <select name="employee" style="width:auto;min-width:180px;padding:6px 8px;font-size:13px">
                                {staffOptions.map((s) => <option value={s.id}>{s.name}</option>)}
                              </select>
                              <input
                                type="text"
                                name="match_text"
                                value={l.supplier ?? ""}
                                style="width:220px;padding:6px 8px;font-size:13px"
                                placeholder="payee match text"
                              />
                              <select name="match_mode" style="width:auto;padding:6px 8px;font-size:13px">
                                <option value="word">whole word</option>
                                <option value="exact">exact</option>
                                <option value="contains">contains</option>
                              </select>
                              <button class="btn btn-sm btn-primary" type="submit">Map payee</button>
                            </form>
                          ) : (
                            <div>
                              <form method="post" action="/app/costs/assign" class="row" style="gap:10px;margin-bottom:14px">
                                <input type="hidden" name="ids" value={l.id} />
                                <input type="hidden" name="p" value={periodKey} />
                                <input type="hidden" name="tab" value={tab} />
                                <strong style="font-size:13px">Assign whole line</strong>
                                <TargetSelect name="target" projects={projects} />
                                <label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-size:13px">
                                  <input type="checkbox" name="save_rule" value="1" style="width:auto" /> Save as rule for{" "}
                                  {l.supplier ?? "this supplier"}
                                </label>
                                <button class="btn btn-sm btn-primary" type="submit">Assign</button>
                              </form>
                              <form method="post" action="/app/costs/split">
                                <input type="hidden" name="id" value={l.id} />
                                <input type="hidden" name="p" value={periodKey} />
                                <input type="hidden" name="tab" value={tab} />
                                <strong style="font-size:13px">…or split it ({R(l.amountC)})</strong>
                                {/* 12 legs = one per client; empty rows are ignored on save. */}
                                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:4px 28px;margin-top:6px;max-width:760px">
                                  {Array.from({ length: 12 }, (_, i) => (
                                    <div class="row" style="gap:8px;align-items:center">
                                      <TargetSelect name={`split_target_${i}`} projects={projects} allowEmpty />
                                      <input
                                        name={`split_pct_${i}`}
                                        size={4}
                                        inputmode="decimal"
                                        autocomplete="off"
                                        placeholder="%"
                                        style="width:70px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);text-align:right"
                                      />
                                      <span class="muted" style="font-size:12px">%</span>
                                    </div>
                                  ))}
                                </div>
                                <div class="row" style="gap:12px;align-items:center;margin-top:8px">
                                  <button class="btn btn-sm" type="submit">Save split</button>
                                  <label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-size:13px">
                                    <input type="checkbox" name="save_rule" value="1" style="width:auto" /> Save as rule for{" "}
                                    {l.supplier ?? "this supplier"}
                                  </label>
                                  <span class="muted" style="font-size:12px">Percentages must total 100; leave unused lines blank. Staff legs follow that person's share %.</span>
                                </div>
                              </form>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
              {lines.length ? (
                <tr class="total">
                  <td></td>
                  <td style="text-align:left">Total ({lines.length} lines)</td>
                  <td></td><td></td><td></td>
                  <td class={`num ${total < 0 ? "neg" : ""}`}>{R(total)}</td>
                  <td></td><td></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div class="card section-block" style="max-width:560px">
          <h3>Import cost lines (CSV)</h3>
          <form method="post" action="/app/costs/import" enctype="multipart/form-data" class="row" style="gap:10px">
            <input type="file" name="file" accept=".csv" required style="width:260px;font-size:12px;color:var(--muted)" />
            <button class="btn btn-sm" type="submit">Import CSV</button>
          </form>
          <p class="muted" style="font-size:12px;margin:8px 0 0">
            Columns: date, supplier, description, account code, amount. Imported lines join this inbox as source “csv”.
          </p>
        </div>
      </div>
    </Layout>
  );
};

// ---------------------------------------------------------------------------
// Cost rules
// ---------------------------------------------------------------------------

export type CostRuleSplitSummary = {
  label: string;
  pct: number | null;
  fixedC: number | null;
  isRemainder: boolean;
};

export type CostRuleListRow = {
  id: string;
  name: string;
  priority: number;
  supplierMatch: string | null;
  descriptionMatch: string | null;
  glCode: string | null;
  mode: "percent" | "fixed";
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  splits: CostRuleSplitSummary[];
};

export type CostRuleEditing = {
  id: string;
  name: string;
  priority: number;
  supplierMatch: string | null;
  descriptionMatch: string | null;
  glCode: string | null;
  mode: "percent" | "fixed";
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** projectId null + employeeId null = Shared Overhead; employeeId set = a staff leg. */
  splits: { projectId: string | null; employeeId: string | null; pct: number | null; fixedC: number | null; isRemainder: boolean }[];
};

export type CostRulePreviewRow = {
  txnDate: string;
  supplier: string | null;
  description: string | null;
  amountC: number;
  pieces: { label: string; amountC: number }[];
};

export type CostRulesPageProps = {
  rules: CostRuleListRow[];
  editing: CostRuleEditing | null;
  projects: { id: string; label: string }[];
  /** Matching lines over the last 3 months and how each would split. */
  preview: CostRulePreviewRow[] | null;
  error: string | null;
};

const splitSummary = (s: CostRuleSplitSummary): string =>
  `${s.label}: ${s.isRemainder ? "remainder" : s.pct != null ? `${s.pct}%` : s.fixedC != null ? R(s.fixedC) : "—"}`;

/**
 * Cost rules — recurring auto-assignment rules (supplier/description/account
 * match → percent or fixed splits), with an inline editor and a dry-run
 * preview over the last three months.
 */
export const CostRulesPage: FC<CostRulesPageProps> = ({ rules, editing, projects, preview, error }) => (
  <Layout title="Cost rules" authed section="clients" wide>
    <div class="container" style="max-width:1320px">
      <div class="row spread">
        <div>
          <h1 style="margin-top:12px">Cost rules</h1>
          <p class="muted" style="margin-top:0">
            Rules assign matching cost lines automatically, in priority order (lowest number wins).{" "}
            <Info text="A line matches when every given condition holds: supplier contains, description contains, account code equals. Percent rules split by %, fixed rules take fixed rand amounts with one remainder leg." />
          </p>
        </div>
        <div class="row" style="gap:8px;margin-top:16px">
          <a class="btn btn-sm" href="/app/costs">← Cost inbox</a>
          <a class="btn btn-sm btn-primary" href="/app/costs/rules?edit=new">+ New rule</a>
        </div>
      </div>

      {error ? (
        <div class="callout section-block" style="border-left-color:var(--danger)">
          <strong class="neg">Not saved:</strong> {error}
        </div>
      ) : null}

      <div class="section-block tablewrap">
        <table class="grid">
          <thead>
            <tr>
              <th>Priority</th>
              <th style="text-align:left">Rule</th>
              <th style="text-align:left">Match</th>
              <th style="text-align:left">Mode</th>
              <th style="text-align:left">Splits</th>
              <th style="text-align:left">Effective</th>
              <th style="text-align:left">Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr><td colspan={8} style="text-align:left" class="muted">No rules yet — assign a line in the inbox with “Save as rule”, or create one here.</td></tr>
            ) : null}
            {rules.map((r) => (
              <tr style={r.active ? "" : "opacity:.5"}>
                <td class="num">{r.priority}</td>
                <td style="text-align:left"><strong>{r.name}</strong></td>
                <td style="text-align:left" class="muted">
                  {[
                    r.supplierMatch ? `supplier ~ “${r.supplierMatch}”` : null,
                    r.descriptionMatch ? `desc ~ “${r.descriptionMatch}”` : null,
                    r.glCode ? `account ${r.glCode}` : null,
                  ]
                    .filter((x): x is string => x != null)
                    .join(" · ") || "—"}
                </td>
                <td style="text-align:left">
                  <span class={`badge ${r.mode === "percent" ? "recurring" : "manual"}`}>{r.mode}</span>
                </td>
                <td style="text-align:left" class="muted">{r.splits.map(splitSummary).join(" · ")}</td>
                <td style="text-align:left" class="muted">
                  {r.effectiveFrom || r.effectiveTo
                    ? `${r.effectiveFrom ? formatDMY(r.effectiveFrom) : "…"} – ${r.effectiveTo ? formatDMY(r.effectiveTo) : "…"}`
                    : "always"}
                </td>
                <td style="text-align:left">
                  <form method="post" action="/app/costs/rule/toggle" style="margin:0">
                    <input type="hidden" name="id" value={r.id} />
                    <button class="btn btn-sm" type="submit">{r.active ? "Disable" : "Enable"}</button>
                  </form>
                </td>
                <td style="text-align:left">
                  <div class="row" style="gap:6px;justify-content:flex-end">
                    <a class="btn btn-sm" href={`/app/costs/rules?edit=${encodeURIComponent(r.id)}`}>Edit</a>
                    <form
                      method="post"
                      action="/app/costs/rule/delete"
                      style="margin:0"
                      onsubmit="return confirm('Delete this rule? Lines it assigned keep their current target until the month is recomputed.')"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <button class="btn btn-sm btn-danger" type="submit">✕</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div class="card section-block">
          <h3>{editing.id ? "Edit rule" : "New rule"}</h3>
          <form method="post" action="/app/costs/rule">
            {editing.id ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div class="formgrid">
              <div><label>Name</label><input type="text" name="name" value={editing.name} required /></div>
              <div><label>Priority</label><input type="number" name="priority" value={String(editing.priority)} /></div>
              <div><label>Supplier contains</label><input type="text" name="supplier_match" value={editing.supplierMatch ?? ""} /></div>
              <div><label>Description contains</label><input type="text" name="description_match" value={editing.descriptionMatch ?? ""} /></div>
              <div>
                <label>Account code</label>
                <input type="text" name="gl_code" value={editing.glCode ?? ""} />
                {editing.glCode ? (
                  <p class="muted" style="font-size:11px;margin:4px 0 0">
                    ⚠ Only matches this supplier's lines on account {editing.glCode} — clear it to catch every account
                    (keep it for generic payees like “Bank Transaction”).
                  </p>
                ) : null}
              </div>
              <div>
                <label>Mode</label>
                <select name="mode">
                  <option value="percent" selected={editing.mode === "percent"}>percent</option>
                  <option value="fixed" selected={editing.mode === "fixed"}>fixed</option>
                </select>
              </div>
              <div><label>Effective from</label><input type="date" name="effective_from" value={editing.effectiveFrom ?? ""} /></div>
              <div><label>Effective to</label><input type="date" name="effective_to" value={editing.effectiveTo ?? ""} /></div>
              <div>
                <label style="display:flex;align-items:center;gap:8px;margin-bottom:0">
                  <input type="checkbox" name="active" value="1" checked={editing.active} style="width:auto" /> Active
                </label>
              </div>
            </div>
            <div style="margin-top:16px">
              <strong style="font-size:13px">Splits</strong>
              <table style="border-collapse:collapse;font-size:13px;margin-top:6px">
                <thead>
                  <tr>
                    <th style="text-align:left;padding:4px 14px 4px 0;color:var(--muted)">Target</th>
                    <th style="text-align:right;padding:4px 14px 4px 0;color:var(--muted)">%</th>
                    <th style="text-align:right;padding:4px 14px 4px 0;color:var(--muted)">Fixed R</th>
                    <th style="text-align:left;padding:4px 0;color:var(--muted)">Remainder</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 12 }, (_, i) => i).map((i) => {
                    const s = editing.splits[i] ?? null;
                    const sel = s ? (s.employeeId ? `staff:${s.employeeId}` : s.projectId ?? "overhead") : "";
                    return (
                      <tr>
                        <td style="padding:3px 14px 3px 0">
                          <select name={`split_target_${i}`} style="width:auto;min-width:200px;padding:6px 8px;font-size:13px">
                            <option value="" selected={sel === ""}>—</option>
                            <optgroup label="Clients & projects">
                              {projects.filter((p) => !p.id.startsWith("staff:")).map((p) => <option value={p.id} selected={sel === p.id}>{p.label}</option>)}
                            </optgroup>
                            <optgroup label="Pool">
                              <option value="overhead" selected={sel === "overhead"}>Shared Overhead</option>
                            </optgroup>
                            <optgroup label="Staff — follows their share %">
                              {projects.filter((p) => p.id.startsWith("staff:")).map((p) => <option value={p.id} selected={sel === p.id}>{p.label.replace(/^Staff: /, "")}</option>)}
                            </optgroup>
                          </select>
                        </td>
                        <td style="padding:3px 14px 3px 0;text-align:right">
                          <input
                            name={`split_pct_${i}`}
                            size={4}
                            inputmode="decimal"
                            autocomplete="off"
                            value={s?.pct != null ? String(s.pct) : ""}
                            style="width:70px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);text-align:right"
                          />
                        </td>
                        <td style="padding:3px 14px 3px 0;text-align:right">
                          <input
                            name={`split_fixed_${i}`}
                            size={8}
                            inputmode="decimal"
                            autocomplete="off"
                            value={s?.fixedC != null ? String(Math.round(s.fixedC / 100)) : ""}
                            style="width:100px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);text-align:right"
                          />
                        </td>
                        <td style="padding:3px 0">
                          <input type="radio" name="remainder" value={String(i)} checked={s?.isRemainder === true} style="width:auto" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p class="muted" style="font-size:12px;margin:8px 0 0">
                Percent mode: percentages must total 100 (or mark one leg as remainder). Fixed mode: rand amounts with
                exactly one remainder leg.
              </p>
            </div>
            <div class="toolbar">
              <button class="btn btn-primary" type="submit">Save rule</button>
              <a class="btn" href="/app/costs/rules">Cancel</a>
            </div>
          </form>
        </div>
      ) : null}

      {preview ? (
        <div class="section-block">
          <h3>Preview — matching lines, last 3 months</h3>
          {preview.length === 0 ? (
            <p class="muted">No cost lines in the last 3 months match this rule.</p>
          ) : (
            <div class="tablewrap">
              <table class="grid">
                <thead>
                  <tr>
                    <th style="text-align:left">Date</th>
                    <th style="text-align:left">Supplier</th>
                    <th style="text-align:left">Description</th>
                    <th>Amount</th>
                    <th style="text-align:left">Would split to</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr>
                      <td style="text-align:left">{formatDMY(p.txnDate)}</td>
                      <td style="text-align:left">{p.supplier ?? "—"}</td>
                      <td style="text-align:left" class="muted">{p.description ?? "—"}</td>
                      <td class={`num ${p.amountC < 0 ? "neg" : ""}`}>{R(p.amountC)}</td>
                      <td style="text-align:left" class="muted">
                        {p.pieces.map((pc) => `${pc.label} ${R(pc.amountC)}`).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  </Layout>
);
