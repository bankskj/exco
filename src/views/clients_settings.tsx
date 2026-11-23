import type { FC } from "hono/jsx";
import { Layout, Info } from "./layout";
import type { Treatment, OverheadBasis } from "../lib/billing_types";
import { formatZAR } from "../lib/money";
import { label } from "../lib/period";

/** Cents → whole-rand display. */
const R = (c: number) => formatZAR(Math.round(c / 100));

export type SettingsProject = {
  id: string;
  name: string;
  isDefault: boolean;
  billingType: "fixed" | "retainer" | "time" | "recurring";
  contractValueC: number | null;
  status: "open" | "closed";
};

export type SettingsClient = {
  id: string;
  name: string;
  shortName: string | null;
  isGeneral: boolean;
  active: boolean;
  sortOrder: number;
  projects: SettingsProject[];
  contacts: { id: string; contactName: string }[];
};

export type SettingsCategory = {
  code: string;
  name: string;
  kind: "revenue" | "cost";
  reportGroup: string;
  treatment: Treatment;
  active: boolean;
};

export type SettingsStaff = {
  employeeId: string;
  name: string;
  defaultTarget: "general" | "overhead";
  loadingPct: number;
  payees: { id: string; matchText: string; matchMode: "exact" | "contains" }[];
};

export type SettingsTab = "clients" | "contacts" | "accounts" | "staff" | "overhead";

export type ClientsSettingsPageProps = {
  /** The active tab (?s=). */
  tab: SettingsTab;
  clients: SettingsClient[];
  categories: SettingsCategory[];
  staff: SettingsStaff[];
  basisPeriod: string;
  basis: OverheadBasis;
  fixedShares: { clientId: string; pct: number }[];
  saved: boolean;
  error: string | null;
};

const BILLING_TYPES: SettingsProject["billingType"][] = ["fixed", "retainer", "time", "recurring"];

const REVENUE_TREATMENTS: Treatment[] = ["revenue", "excluded"];
const COST_TREATMENTS: Treatment[] = ["people", "direct", "overhead", "excluded"];

/**
 * Clients settings — the module's master data: clients & projects, contact
 * mappings, GL category treatments, staff defaults & payee aliases, and the
 * overhead recovery basis. Each row saves via its own small form (multi-cell
 * inputs reference their form by id).
 */
export const ClientsSettingsPage: FC<ClientsSettingsPageProps> = ({
  tab,
  clients,
  categories,
  staff,
  basisPeriod,
  basis,
  fixedShares,
  saved,
  error,
}) => {
  const revenueCats = categories.filter((c) => c.kind === "revenue");
  const costCats = categories.filter((c) => c.kind === "cost");
  const shareOf = (clientId: string): number => fixedShares.find((s) => s.clientId === clientId)?.pct ?? 0;
  const fixedTotal = clients.reduce((s, c) => s + shareOf(c.id), 0);

  return (
    <Layout title="Clients settings" authed section="clients" wide>
      <div class="container" style="max-width:1320px">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Clients — settings</h1>
            <p class="muted" style="margin-top:0">
              The master data that rarely changes. Set it once; day-to-day work happens on the other pages.
            </p>
          </div>
          <a class="btn btn-sm" style="margin-top:16px" href="/app/clients">← Clients</a>
        </div>

        <div class="card section-block" style="padding:16px 20px">
          <div class="row" style="gap:40px;flex-wrap:wrap;align-items:flex-start">
            <div style="min-width:280px">
              <strong style="font-size:13px">On this page (one-time setup)</strong>
              <p style="margin:6px 0 0;font-size:13px;line-height:2">
                <a href="?s=clients">1 · Clients &amp; projects</a> — the 12 report rows<br />
                <a href="?s=contacts">2 · Contact mappings</a> — Xero contact → client<br />
                <a href="?s=accounts">3 · Account treatments</a> — people / direct / overhead / excluded<br />
                <a href="?s=staff">4 · Staff</a> — payee aliases, default target, loading %<br />
                <a href="?s=overhead">5 · Overhead recovery basis</a>
              </p>
            </div>
            <div style="min-width:280px">
              <strong style="font-size:13px">Done elsewhere (day to day)</strong>
              <p style="margin:6px 0 0;font-size:13px;line-height:2" class="muted">
                Assign, split or exclude cost lines → <a href="/app/costs">Cost inbox</a><br />
                Recurring supplier splits → <a href="/app/costs/rules">Cost rules</a><br />
                Map revenue contacts, project overrides → <a href="/app/revenue">Revenue lines</a><br />
                Staff share % per month → <a href="/app/allocations">Allocations</a><br />
                Add or remove staff → <a href="/app/payroll">People · Payroll register</a>
              </p>
            </div>
          </div>
        </div>

        <div class="segmented section-block" style="flex-wrap:wrap">
          {([
            ["clients", "1 · Clients & projects"],
            ["contacts", "2 · Contacts"],
            ["accounts", "3 · Accounts"],
            ["staff", "4 · Staff"],
            ["overhead", "5 · Overhead"],
          ] as [SettingsTab, string][]).map(([key, lbl]) => (
            <a href={`?s=${key}`} class={tab === key ? "seg active" : "seg"}>{lbl}</a>
          ))}
        </div>

        {error ? (
          <div class="callout section-block" style="border-left-color:var(--danger)">
            <strong class="neg">Not saved:</strong> {error}
          </div>
        ) : null}
        {saved ? <p style="margin:14px 0 0"><span class="badge income">✓ Saved</span></p> : null}

        {/* 1 — Clients & projects ------------------------------------------- */}
        <div class="section-block" id="clients" style={tab === "clients" ? "" : "display:none"}>
          <h2>1 · Clients &amp; projects <span class="badge recurring" style="vertical-align:middle">report rows</span></h2>
          <p class="muted" style="font-size:13px;margin-top:4px">
            Each client has one <strong>default project</strong> — the landing spot for all its revenue and cost.
            Nothing needs configuring here unless you want to <strong>split a client into work streams</strong>{" "}
            (a second project) or record a contract value that shows on the project page.
          </p>
          <div class="tablewrap" style="max-width:860px;margin-top:12px">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Client</th>
                  <th style="text-align:left">Projects</th>
                  <th style="text-align:left"></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const extras = c.projects.filter((p) => !p.isDefault);
                  return (
                    <tr style={!c.active ? "opacity:.5" : ""}>
                      <td style="text-align:left;vertical-align:top">
                        <strong>{c.name}</strong>
                        {c.shortName ? <span class="muted"> · {c.shortName}</span> : null}
                        {c.isGeneral ? <span class="badge manual" style="margin-left:8px">catch-all</span> : null}
                      </td>
                      <td style="text-align:left;vertical-align:top">
                        <div class="muted" style="font-size:13px">default project{extras.length ? ` + ${extras.length} split(s)` : " only"}</div>
                        {extras.map((p) => (
                          <div style="font-size:13px;margin-top:2px">
                            {p.name} <span class="muted">· {p.billingType}{p.contractValueC != null ? ` · ${formatZAR(Math.round(p.contractValueC / 100))}` : ""}</span>
                            {p.status === "closed" ? <span class="badge actual" style="margin-left:6px">closed</span> : null}
                          </div>
                        ))}
                      </td>
                      <td style="text-align:left;vertical-align:top">
                        <details>
                          <summary style="cursor:pointer;font-size:13px;color:var(--accent)">Edit / split…</summary>
                          <div style="margin-top:10px">
                            {c.projects.map((p) => {
                              const fid = `proj-${p.id}`;
                              return (
                                <div class="row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
                                  <form id={fid} method="post" action="/app/clients/settings/project" style="display:none"></form>
                                  <input type="hidden" name="id" value={p.id} form={fid} />
                                  <input type="text" name="name" value={p.name} form={fid} title="Project name" style="width:200px;padding:5px 8px;font-size:12px" />
                                  <select name="billing_type" form={fid} title="Billing type" style="width:auto;padding:5px 8px;font-size:12px">
                                    {BILLING_TYPES.map((bt) => <option value={bt} selected={p.billingType === bt}>{bt}</option>)}
                                  </select>
                                  <input
                                    type="text"
                                    name="contract_value"
                                    inputmode="decimal"
                                    value={p.contractValueC != null ? String(Math.round(p.contractValueC / 100)) : ""}
                                    form={fid}
                                    placeholder="Contract R"
                                    title="Contract value (optional, shows on the project page)"
                                    style="width:110px;padding:5px 8px;font-size:12px;text-align:right"
                                  />
                                  {p.isDefault ? <span class="badge recurring">default</span> : null}
                                  <button class="btn btn-sm" type="submit" form={fid}>Save</button>
                                  {!p.isDefault && p.status === "open" ? (
                                    <form
                                      method="post"
                                      action="/app/clients/settings/project/close"
                                      style="margin:0"
                                      onsubmit="return confirm('Close this project? Closed projects stop appearing in allocation and assignment pickers.')"
                                    >
                                      <input type="hidden" name="id" value={p.id} />
                                      <button class="btn btn-sm btn-danger" type="submit">Close</button>
                                    </form>
                                  ) : null}
                                </div>
                              );
                            })}
                            <form method="post" action="/app/clients/settings/project" class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
                              <input type="hidden" name="client" value={c.id} />
                              <input type="text" name="name" required placeholder="New split, e.g. N8 dev" style="width:200px;padding:5px 8px;font-size:12px" />
                              <select name="billing_type" style="width:auto;padding:5px 8px;font-size:12px">
                                {BILLING_TYPES.map((bt) => <option value={bt}>{bt}</option>)}
                              </select>
                              <button class="btn btn-sm" type="submit">+ Split into new project</button>
                            </form>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <form method="post" action="/app/clients/settings/client" class="row" style="gap:8px;margin-top:14px">
            <input type="text" name="name" required placeholder="New reporting client" style="width:240px;padding:6px 8px;font-size:13px" />
            <input type="text" name="short_name" placeholder="Short name" style="width:140px;padding:6px 8px;font-size:13px" />
            <button class="btn btn-sm btn-primary" type="submit">+ Add client</button>
          </form>
        </div>

        {/* 2 — Contact mappings --------------------------------------------- */}
        <div class="section-block" id="contacts" style={tab === "contacts" ? "" : "display:none"}>
          <h2>2 · Contact mappings <span class="badge income" style="vertical-align:middle">revenue → client</span></h2>
          <p class="muted" style="font-size:13px;margin-top:4px">
            Xero contact → client. Unmapped contacts' revenue lands in General Sales (the{" "}
            <a href="/app/revenue">Revenue lines</a> page lists them).
          </p>
          <div class="tablewrap" style="max-width:720px">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Contact</th>
                  <th style="text-align:left">Client</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.flatMap((c) =>
                  c.contacts.map((ct) => (
                    <tr>
                      <td style="text-align:left">{ct.contactName}</td>
                      <td style="text-align:left">{c.name}</td>
                      <td style="text-align:left">
                        <form method="post" action="/app/clients/settings/contact/delete" style="margin:0">
                          <input type="hidden" name="id" value={ct.id} />
                          <button class="btn btn-sm btn-danger" type="submit">✕</button>
                        </form>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <form method="post" action="/app/clients/settings/contact" class="row" style="gap:8px;margin-top:10px">
            <input type="text" name="contact_name" required placeholder="Contact name (as in Xero)" style="width:260px;padding:6px 8px;font-size:13px" />
            <select name="client" style="width:auto;min-width:180px;padding:6px 8px;font-size:13px">
              {clients.map((c) => <option value={c.id}>{c.name}</option>)}
            </select>
            <button class="btn btn-sm" type="submit">+ Add mapping</button>
          </form>
        </div>

        {/* 3 — Categories ---------------------------------------------------- */}
        <div class="section-block" id="accounts" style={tab === "accounts" ? "" : "display:none"}>
          <h2>3 · Account treatments <span class="badge cost" style="vertical-align:middle">cost behaviour</span></h2>
          <p class="muted" style="font-size:13px;margin-top:4px">
            How each GL account is treated.{" "}
            <Info text="Revenue accounts are revenue or excluded. Cost accounts are people (staff cost), direct (client-assignable), overhead (shared pool) or excluded (e.g. tax, depreciation)." />
          </p>
          {[
            { title: "Revenue accounts", cats: revenueCats, treatments: REVENUE_TREATMENTS },
            { title: "Cost accounts", cats: costCats, treatments: COST_TREATMENTS },
          ].map((grp) => (
            <div class="tablewrap" style="max-width:860px;margin-top:12px">
              <table class="grid">
                <thead>
                  <tr>
                    <th style="text-align:left">{grp.title}</th>
                    <th style="text-align:left">Name</th>
                    <th style="text-align:left">Report group</th>
                    <th style="text-align:left">Treatment</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {grp.cats.map((cat) => {
                    const fid = `cat-${cat.code}`;
                    return (
                      <tr style={cat.active ? "" : "opacity:.5"}>
                        <td style="text-align:left">
                          <form id={fid} method="post" action="/app/clients/settings/category" style="display:none"></form>
                          <input type="hidden" name="code" value={cat.code} form={fid} />
                          {cat.code}
                        </td>
                        <td style="text-align:left" class="muted">{cat.name}</td>
                        <td style="text-align:left">
                          <input type="text" name="report_group" value={cat.reportGroup} form={fid} style="width:180px;padding:6px 8px;font-size:13px" />
                        </td>
                        <td style="text-align:left">
                          <select name="treatment" form={fid} style="width:auto;padding:6px 8px;font-size:13px">
                            {grp.treatments.map((t) => <option value={t} selected={cat.treatment === t}>{t}</option>)}
                          </select>
                        </td>
                        <td style="text-align:left">
                          <button class="btn btn-sm" type="submit" form={fid}>Save</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* 4 — Staff ---------------------------------------------------------- */}
        <div class="section-block" id="staff" style={tab === "staff" ? "" : "display:none"}>
          <h2>4 · Staff — payee aliases &amp; defaults <span class="badge estimate" style="vertical-align:middle">people cost</span></h2>
          <p class="muted" style="font-size:13px;margin-top:4px">
            Staff come from the <a href="/app/payroll">Payroll register</a> — add or remove people there. Here you
            align them to the billing engine: a <strong>payee alias</strong> is the text that identifies the person
            on a Xero payment (e.g. “UNATHI JAMES ELULA ONLINE”) — without one, their payments sit in the{" "}
            <a href="/app/costs?tab=unmatched">Unmatched staff</a> queue. <strong>Default target</strong> takes
            whatever share % doesn't allocate to a client (general = General Sales; overhead = the shared pool —
            use overhead for admin staff and directors). <strong>Loading %</strong> grosses up payroll-estimate
            months. The monthly client split itself lives in the <a href="/app/allocations">Allocations grid</a>.
          </p>
          <div class="tablewrap" style="max-width:1000px">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Staff member</th>
                  <th style="text-align:left">Default target</th>
                  <th>Loading %</th>
                  <th style="text-align:left">Payee aliases</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const fid = `staff-${s.employeeId}`;
                  return (
                    <tr>
                      <td style="text-align:left">
                        <form id={fid} method="post" action="/app/clients/settings/staff" style="display:none"></form>
                        <input type="hidden" name="employee" value={s.employeeId} form={fid} />
                        <strong>{s.name}</strong>
                      </td>
                      <td style="text-align:left">
                        <select name="default_target" form={fid} style="width:auto;padding:6px 8px;font-size:13px">
                          <option value="general" selected={s.defaultTarget === "general"}>general</option>
                          <option value="overhead" selected={s.defaultTarget === "overhead"}>overhead</option>
                        </select>
                      </td>
                      <td class="num">
                        <input name="loading_pct" value={String(s.loadingPct)} inputmode="decimal" size={5} form={fid} autocomplete="off" />
                      </td>
                      <td style="text-align:left">
                        {s.payees.length === 0 ? <span class="muted" style="font-size:12px">—</span> : null}
                        {s.payees.map((p) => (
                          <form method="post" action="/app/clients/settings/payee/delete" style="display:inline-block;margin:0 6px 4px 0">
                            <input type="hidden" name="id" value={p.id} />
                            <span class="badge actual" title={p.matchMode}>
                              {p.matchText}
                              <button
                                type="submit"
                                style="background:none;border:0;color:var(--danger);cursor:pointer;padding:0 0 0 6px;font-size:11px"
                                title="Delete alias"
                              >
                                ✕
                              </button>
                            </span>
                          </form>
                        ))}
                      </td>
                      <td style="text-align:left">
                        <button class="btn btn-sm" type="submit" form={fid}>Save</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <form method="post" action="/app/clients/settings/payee" class="row" style="gap:8px;margin-top:10px">
            <select name="employee" style="width:auto;min-width:180px;padding:6px 8px;font-size:13px">
              {staff.map((s) => <option value={s.employeeId}>{s.name}</option>)}
            </select>
            <input type="text" name="match_text" required placeholder="Payee match text" style="width:220px;padding:6px 8px;font-size:13px" />
            <select name="match_mode" style="width:auto;padding:6px 8px;font-size:13px">
              <option value="exact">exact</option>
              <option value="contains">contains</option>
            </select>
            <button class="btn btn-sm" type="submit">+ Add alias</button>
          </form>
        </div>

        {/* 5 — Overhead basis -------------------------------------------------- */}
        <div class="section-block" id="overhead" style={tab === "overhead" ? "" : "display:none"}>
          <h2>5 · Overhead recovery basis <span class="badge manual" style="vertical-align:middle">pool recovery</span></h2>
          <p class="muted" style="font-size:13px;margin-top:4px">
            How the shared pool is spread across clients from <strong>{label(basisPeriod)}</strong> onward.{" "}
            <Info text="Revenue: in proportion to each client's revenue. Direct cost: in proportion to people + direct cost. Fixed: the percentages below, which must total exactly 100." />
          </p>
          <form method="post" action="/app/clients/settings/basis" class="card" style="max-width:720px;margin-top:10px">
            <div class="formgrid">
              <div>
                <label>Effective from (month)</label>
                <input type="month" name="period" value={basisPeriod} style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:#0c0f14;color:var(--text);font-size:14px" />
              </div>
              <div>
                <label>Basis</label>
                <select name="basis">
                  <option value="revenue" selected={basis === "revenue"}>Revenue share</option>
                  <option value="direct_cost" selected={basis === "direct_cost"}>Direct-cost share</option>
                  <option value="fixed" selected={basis === "fixed"}>Fixed percentages</option>
                </select>
              </div>
            </div>
            {basis === "fixed" ? (
              <div style="margin-top:14px">
                <strong style="font-size:13px">Fixed shares</strong>{" "}
                <span class={`muted ${Math.abs(fixedTotal - 100) > 0.001 ? "neg" : ""}`} style="font-size:12px">
                  — currently total {fixedTotal}% (must total 100%)
                </span>
                <table style="border-collapse:collapse;font-size:13px;margin-top:6px">
                  <tbody>
                    {clients.map((c) => (
                      <tr>
                        <td style="padding:3px 14px 3px 0">{c.name}</td>
                        <td style="padding:3px 0">
                          <input
                            name={`share::${c.id}`}
                            value={shareOf(c.id) ? String(shareOf(c.id)) : ""}
                            size={5}
                            inputmode="decimal"
                            autocomplete="off"
                            style="width:80px;padding:5px 7px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);text-align:right"
                          />
                          <span class="muted" style="font-size:12px"> %</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="muted" style="font-size:12px;margin:12px 0 0">
                Switch the basis to <strong>Fixed percentages</strong> and save to capture per-client shares.
              </p>
            )}
            <div class="toolbar" style="margin-bottom:0">
              <button class="btn btn-primary" type="submit">Save basis</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
};
