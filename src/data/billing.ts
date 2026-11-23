// D1 data layer for the Client Billing & Cost Allocation module.
// Loads PeriodInput for the allocation engine, runs the Xero line-level sync,
// and owns every billing mutation (all audited into billing_audit).
// Money is INTEGER CENTS throughout; periods are 'YYYY-MM'.

import type {
  BillingClient,
  BillingProject,
  CostLine,
  CostRule,
  CostSplit,
  GlCategory,
  OverheadBasis,
  OverheadFixedShare,
  PeriodInput,
  PeriodResult,
  ProjectBudget,
  RevenueLine,
  StaffAllocation,
  StaffMember,
  TargetKind,
  Treatment,
} from "../lib/billing_types";
import { fetchBillingDocs, fetchChartOfAccounts } from "../lib/xero";
import type { XeroBillingRevenueRow } from "../lib/xero";
import { applyRuleSplits, firstMatchingRule } from "../lib/billing_rules";
import type { MatchableLine, SplitPiece } from "../lib/billing_rules";
import { getMeta, setMeta } from "./db";

export class BillingError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

const FIRST_PERIOD = "2026-03";
const BATCH = 40;

const uuid = (): string => crypto.randomUUID();

/** Run prepared statements in chunked db.batch calls (≤40 per transaction). */
async function runBatches(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  const out: D1Result[] = [];
  for (let i = 0; i < stmts.length; i += BATCH) out.push(...(await db.batch(stmts.slice(i, i + BATCH))));
  return out;
}

/** Audit INSERT as a prepared statement so it can join the batch it describes. */
function auditStmt(db: D1Database, actor: string, entity: string, entityId: string | null, action: string, before: unknown, after: unknown): D1PreparedStatement {
  return db
    .prepare("INSERT INTO billing_audit (id, actor, entity, entity_id, action, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(uuid(), actor, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
}

async function closedPeriodSet(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT period FROM billing_periods WHERE status = 'closed'").all<{ period: string }>();
  return new Set((results ?? []).map((r) => r.period));
}

/** Inclusive 'YYYY-MM' range (bounded for safety). */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  while (out.length < 600) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (p > to) break;
    out.push(p);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Period control
// ---------------------------------------------------------------------------

export type BillingPeriod = {
  period: string;
  overheadBasis: OverheadBasis;
  status: "open" | "closed";
  closedAt: string | null;
  notes: string | null;
};

const mapPeriod = (r: any): BillingPeriod => ({
  period: String(r.period),
  overheadBasis: r.overhead_basis as OverheadBasis,
  status: r.status as "open" | "closed",
  closedAt: r.closed_at ?? null,
  notes: r.notes ?? null,
});

/** billing_periods rows from 2026-03 through `throughPeriod` (open, basis revenue). */
export async function ensurePeriods(db: D1Database, throughPeriod: string): Promise<void> {
  const stmts = monthRange(FIRST_PERIOD, throughPeriod).map((p) => db.prepare("INSERT OR IGNORE INTO billing_periods (period) VALUES (?)").bind(p));
  await runBatches(db, stmts);
}

export async function getBillingPeriod(db: D1Database, period: string): Promise<BillingPeriod | null> {
  const r = await db.prepare("SELECT period, overhead_basis, status, closed_at, notes FROM billing_periods WHERE period = ?").bind(period).first<any>();
  return r ? mapPeriod(r) : null;
}

export async function listBillingPeriods(db: D1Database): Promise<BillingPeriod[]> {
  const { results } = await db.prepare("SELECT period, overhead_basis, status, closed_at, notes FROM billing_periods ORDER BY period").all<any>();
  return (results ?? []).map(mapPeriod);
}

/** Throws 409 when the period is closed. A missing row counts as open. */
export async function assertPeriodOpen(db: D1Database, period: string): Promise<void> {
  const r = await db.prepare("SELECT status FROM billing_periods WHERE period = ?").bind(period).first<{ status: string }>();
  if (r?.status === "closed") throw new BillingError(`Period ${period} is closed`, 409);
}

export async function setOverheadBasis(db: D1Database, period: string, basis: OverheadBasis, actor: string): Promise<void> {
  await assertPeriodOpen(db, period);
  const before = await getBillingPeriod(db, period);
  await db.batch([
    db.prepare("INSERT INTO billing_periods (period, overhead_basis) VALUES (?, ?) ON CONFLICT(period) DO UPDATE SET overhead_basis = excluded.overhead_basis").bind(period, basis),
    auditStmt(db, actor, "billing_period", period, "set_basis", before ? { overheadBasis: before.overheadBasis } : null, { overheadBasis: basis }),
  ]);
}

/** Freeze the engine result and close the period (caller runs the checklist). */
export async function closePeriod(db: D1Database, period: string, resultJson: string, actor: string): Promise<void> {
  await assertPeriodOpen(db, period);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO period_snapshots (period, result_json, created_at) VALUES (?, ?, datetime('now'))").bind(period, resultJson),
    db.prepare("INSERT INTO billing_periods (period, status, closed_at) VALUES (?, 'closed', datetime('now')) ON CONFLICT(period) DO UPDATE SET status = 'closed', closed_at = datetime('now')").bind(period),
    auditStmt(db, actor, "billing_period", period, "close", { status: "open" }, { status: "closed" }),
  ]);
}

export async function reopenPeriod(db: D1Database, period: string, actor: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM period_snapshots WHERE period = ?").bind(period),
    db.prepare("UPDATE billing_periods SET status = 'open', closed_at = NULL WHERE period = ?").bind(period),
    auditStmt(db, actor, "billing_period", period, "reopen", { status: "closed" }, { status: "open" }),
  ]);
}

export async function getSnapshot(db: D1Database, period: string): Promise<PeriodResult | null> {
  const r = await db.prepare("SELECT result_json FROM period_snapshots WHERE period = ?").bind(period).first<{ result_json: string }>();
  if (!r) return null;
  return JSON.parse(r.result_json) as PeriodResult;
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case D1 rows -> shared camelCase types)
// ---------------------------------------------------------------------------

const mapClient = (r: any): BillingClient => ({
  id: String(r.id),
  name: String(r.name),
  shortName: r.short_name ?? null,
  isGeneral: !!r.is_general,
  sortOrder: Number(r.sort_order ?? 0),
  active: !!r.active,
});

const mapProject = (r: any): BillingProject => ({
  id: String(r.id),
  clientId: String(r.client_id),
  name: String(r.name),
  code: r.code ?? null,
  isDefault: !!r.is_default,
  billingType: r.billing_type as BillingProject["billingType"],
  contractValueC: r.contract_value_c ?? null,
  startPeriod: r.start_period ?? null,
  endPeriod: r.end_period ?? null,
  status: r.status as BillingProject["status"],
});

const mapCategory = (r: any): GlCategory => ({
  code: String(r.code),
  name: String(r.name ?? ""),
  kind: r.kind as GlCategory["kind"],
  reportGroup: String(r.report_group),
  treatment: r.treatment as Treatment,
  sortOrder: Number(r.sort_order ?? 0),
});

const mapRevenueLine = (r: any): RevenueLine => ({
  id: String(r.id),
  period: String(r.period),
  txnDate: String(r.txn_date),
  source: r.source as RevenueLine["source"],
  docNumber: r.doc_number ?? null,
  docType: r.doc_type ?? null,
  contactName: r.contact_name ?? null,
  clientId: r.client_id ?? null,
  projectId: r.project_id ?? null,
  glCode: r.gl_code ?? null,
  description: r.description ?? null,
  amountC: Number(r.amount_c),
});

const mapCostLine = (r: any): CostLine => ({
  id: String(r.id),
  period: String(r.period),
  txnDate: String(r.txn_date),
  source: r.source as CostLine["source"],
  docKind: r.doc_kind ?? null,
  supplier: r.supplier ?? null,
  reference: r.reference ?? null,
  description: r.description ?? null,
  glCode: r.gl_code ?? null,
  employeeId: r.employee_id ?? null,
  amountC: Number(r.amount_c),
});

const mapRule = (r: any, splits: any[]): CostRule => ({
  id: String(r.id),
  name: String(r.name),
  priority: Number(r.priority ?? 100),
  supplierMatch: r.supplier_match ?? null,
  descriptionMatch: r.description_match ?? null,
  glCode: r.gl_code ?? null,
  mode: r.mode as CostRule["mode"],
  effectiveFrom: r.effective_from ?? null,
  effectiveTo: r.effective_to ?? null,
  active: !!r.active,
  splits: splits.map((s) => ({
    targetKind: s.target_kind as "project" | "overhead",
    projectId: s.project_id ?? null,
    pct: s.pct ?? null,
    fixedC: s.fixed_c ?? null,
    isRemainder: !!s.is_remainder,
  })),
});

// ---------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------

/** Everything the allocation engine needs for one period. */
export async function loadPeriodInput(db: D1Database, period: string): Promise<PeriodInput> {
  return (await loadPeriodInputs(db, [period])).get(period)!;
}

/**
 * Batched engine input for a window of months: each table is read ONCE with
 * `period IN (...)` and sliced per month, so a 12-month tracker costs the same
 * ~11 D1 round-trips as a single month instead of 11 x 12.
 */
export async function loadPeriodInputs(db: D1Database, periods: string[]): Promise<Map<string, PeriodInput>> {
  const out = new Map<string, PeriodInput>();
  if (periods.length === 0) return out;
  const sorted = [...new Set(periods)].sort();
  const maxPeriod = sorted[sorted.length - 1];
  const marks = sorted.map(() => "?").join(",");
  const q = async (sql: string, ...binds: unknown[]): Promise<any[]> => ((await db.prepare(sql).bind(...binds).all()).results ?? []) as any[];

  const [periodRows, clientRows, projectRows, categoryRows, revenueRows, costRows, splitRows2, ruleRows, splitRows, allocationRows, budgetRows, shareRows, staffRows, payrollRows] = await Promise.all([
    q(`SELECT period, overhead_basis FROM billing_periods WHERE period IN (${marks})`, ...sorted),
    q("SELECT id, name, short_name, is_general, sort_order, active FROM clients WHERE active = 1 ORDER BY sort_order, name"),
    q("SELECT id, client_id, name, code, is_default, billing_type, contract_value_c, start_period, end_period, status FROM projects ORDER BY name"),
    q("SELECT code, name, kind, report_group, treatment, sort_order FROM gl_categories WHERE active = 1 ORDER BY sort_order, code"),
    q(`SELECT id, period, txn_date, source, doc_number, doc_type, contact_name, client_id, project_id, gl_code, description, amount_c FROM revenue_lines WHERE period IN (${marks}) ORDER BY txn_date, id`, ...sorted),
    q(`SELECT id, period, txn_date, source, doc_kind, supplier, reference, description, gl_code, employee_id, amount_c FROM cost_lines WHERE period IN (${marks}) ORDER BY txn_date, id`, ...sorted),
    q(`SELECT l.period, s.cost_line_id, s.target_kind, s.project_id, s.pct FROM cost_splits s JOIN cost_lines l ON l.id = s.cost_line_id WHERE l.period IN (${marks})`, ...sorted),
    q("SELECT id, name, priority, supplier_match, description_match, gl_code, mode, effective_from, effective_to, active FROM cost_rules WHERE active = 1 ORDER BY priority, name"),
    q("SELECT rule_id, target_kind, project_id, pct, fixed_c, is_remainder FROM cost_rule_splits WHERE rule_id IN (SELECT id FROM cost_rules WHERE active = 1) ORDER BY id"),
    q("SELECT employee_id, period, target_kind, project_id, pct FROM staff_allocations WHERE period <= ? ORDER BY period, employee_id", maxPeriod),
    q(`SELECT project_id, period, revenue_c, cost_c FROM project_budgets WHERE period IN (${marks})`, ...sorted),
    q(`SELECT period, client_id, pct FROM overhead_fixed_shares WHERE period IN (${marks})`, ...sorted),
    q("SELECT id, name, default_target, loading_pct FROM employees ORDER BY sort_order, name"),
    q(`SELECT employee_id, period, gross FROM payroll_entries WHERE period IN (${marks})`, ...sorted),
  ]);

  const clients = clientRows.map(mapClient);
  const projects = projectRows.map(mapProject);
  const categories = categoryRows.map(mapCategory);
  const splitsByRule = new Map<string, any[]>();
  for (const s of splitRows) {
    const list = splitsByRule.get(String(s.rule_id)) ?? [];
    list.push(s);
    splitsByRule.set(String(s.rule_id), list);
  }
  const rules = ruleRows.map((r) => mapRule(r, splitsByRule.get(String(r.id)) ?? []));
  const allAllocations: StaffAllocation[] = allocationRows.map((a) => ({
    employeeId: String(a.employee_id),
    period: String(a.period),
    targetKind: a.target_kind as "project" | "overhead",
    projectId: a.project_id ?? null,
    pct: Number(a.pct),
  }));
  const basisOf = new Map(periodRows.map((r) => [String(r.period), r.overhead_basis as OverheadBasis]));
  const byPeriod = <T>(rows: any[], map: (r: any) => T): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(String(r.period)) ?? [];
      list.push(map(r));
      m.set(String(r.period), list);
    }
    return m;
  };
  const revenueBy = byPeriod(revenueRows, mapRevenueLine);
  const costBy = byPeriod(costRows, mapCostLine);
  const splitsBy = byPeriod(splitRows2, (s): CostSplit => ({
    costLineId: String(s.cost_line_id),
    targetKind: s.target_kind as TargetKind,
    projectId: s.project_id ?? null,
    pct: Number(s.pct),
  }));
  const budgetsBy = byPeriod(budgetRows, (b): ProjectBudget => ({
    projectId: String(b.project_id),
    period: String(b.period),
    revenueC: Number(b.revenue_c),
    costC: Number(b.cost_c),
  }));
  const sharesBy = byPeriod(shareRows, (s): OverheadFixedShare => ({ clientId: String(s.client_id), pct: Number(s.pct) }));
  const grossBy = new Map<string, number>();
  for (const p of payrollRows) grossBy.set(`${p.employee_id}|${p.period}`, Math.round(Number(p.gross) * 100));

  for (const period of sorted) {
    out.set(period, {
      period,
      overheadBasis: basisOf.get(period) ?? "revenue",
      fixedShares: sharesBy.get(period) ?? [],
      clients,
      projects,
      categories,
      revenueLines: revenueBy.get(period) ?? [],
      costLines: costBy.get(period) ?? [],
      staff: staffRows.map((r) => ({
        employeeId: String(r.id),
        name: String(r.name),
        defaultTarget: r.default_target as StaffMember["defaultTarget"],
        loadingPct: Number(r.loading_pct ?? 0),
        payrollGrossC: grossBy.get(`${r.id}|${period}`) ?? null,
      })),
      allocations: allAllocations.filter((a) => a.period <= period),
      costSplits: splitsBy.get(period) ?? [],
      rules,
      budgets: budgetsBy.get(period) ?? [],
    });
  }
  return out;
}

/** Frozen snapshots for a window of closed months, one query. */
export async function getSnapshots(db: D1Database, periods: string[]): Promise<Map<string, PeriodResult>> {
  const out = new Map<string, PeriodResult>();
  if (periods.length === 0) return out;
  const marks = periods.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT period, result_json FROM period_snapshots WHERE period IN (${marks})`).bind(...periods).all<{ period: string; result_json: string }>();
  for (const r of results ?? []) out.set(r.period, JSON.parse(r.result_json) as PeriodResult);
  return out;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** gl_categories defaults for a code the chart hasn't been mapped for yet. */
function provisionalCategory(code: string, kind: "revenue" | "cost"): { group: string; treatment: Treatment } {
  if (kind === "revenue") return { group: "Unmapped", treatment: "revenue" };
  if (/^4\d\d$/.test(code)) return { group: "Running costs", treatment: "overhead" };
  return { group: "Unmapped", treatment: "overhead" };
}

/** Case-insensitive staff-payee test against supplier, then reference, then description. */
function payeeHit(matchText: string, matchMode: string, supplier: string | null, reference: string | null, description: string | null): boolean {
  const t = matchText.trim().toLowerCase();
  if (!t) return false;
  for (const field of [supplier, reference, description]) {
    if (!field) continue;
    const v = String(field).toLowerCase();
    if (matchMode === "exact" ? v.trim() === t : v.includes(t)) return true;
  }
  return false;
}

/**
 * Pull revenue/cost lines from Xero into the billing ledgers. Idempotent
 * upserts by source_ref; closed periods are never touched (changes landing
 * there are counted into app_meta 'billing_postclose_warning' instead).
 * Returns a short summary; the caller catches failures and sets billing_sync_error.
 */
export async function syncBillingLedgers(env: { DB: D1Database }, accessToken: string, tenantId: string): Promise<string> {
  const db = env.DB;
  // Captured BEFORE the fetch so edits made during the sync are re-fetched next time.
  const syncStartedAt = new Date().toISOString();
  await ensurePeriods(db, syncStartedAt.slice(0, 7));

  const last = await getMeta(db, "billing_last_sync");
  let sinceISO = `${FIRST_PERIOD}-01`;
  let modifiedSince: string | null = null;
  if (last) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 2); // first day of (current month − 2)
    sinceISO = d.toISOString().slice(0, 10);
    modifiedSince = last;
  }

  // Chart of accounts: refresh names of mapped codes (treatment/group kept),
  // and keep a code -> account map for naming unknown codes.
  const accounts = await fetchChartOfAccounts(accessToken, tenantId);
  const acctByCode = new Map(accounts.map((a) => [a.code, a]));
  const glRows = ((await db.prepare("SELECT code, kind FROM gl_categories").all()).results ?? []) as any[];
  const glKind = new Map<string, string>(glRows.map((r) => [String(r.code), String(r.kind)]));
  await runBatches(db, accounts.filter((a) => glKind.has(a.code)).map((a) => db.prepare("UPDATE gl_categories SET name = ? WHERE code = ?").bind(a.name, a.code)));

  const docs = await fetchBillingDocs(accessToken, tenantId, sinceISO, modifiedSince);

  // Unknown GL codes referenced by rows -> provisional categories.
  const newCats: D1PreparedStatement[] = [];
  const addCat = (code: string, kind: "revenue" | "cost") => {
    if (glKind.has(code)) return;
    glKind.set(code, kind);
    const p = provisionalCategory(code, kind);
    newCats.push(
      db.prepare("INSERT OR IGNORE INTO gl_categories (code, name, kind, report_group, treatment, sort_order) VALUES (?, ?, ?, ?, ?, 900)").bind(code, acctByCode.get(code)?.name ?? "", kind, p.group, p.treatment),
    );
  };
  for (const r of docs.revenue) if (r.glCode) addCat(r.glCode, "revenue");
  for (const r of docs.costs) if (r.glCode) addCat(r.glCode, "cost");
  await runBatches(db, newCats);

  // RECEIVE bank txns: keep only lines coded to revenue accounts.
  const revenueRows = docs.revenue.filter((r) => r.docType !== "RECEIVE" || (r.glCode != null && glKind.get(r.glCode) === "revenue"));

  // Resolution maps.
  const contacts = ((await db.prepare("SELECT client_id, xero_contact_id, contact_name FROM client_contacts").all()).results ?? []) as any[];
  const clientByXeroId = new Map<string, string>();
  const clientByName = new Map<string, string>();
  for (const c of contacts) {
    if (c.xero_contact_id) clientByXeroId.set(String(c.xero_contact_id), String(c.client_id));
    clientByName.set(String(c.contact_name).toLowerCase(), String(c.client_id));
  }
  const resolveClient = (r: XeroBillingRevenueRow): string | null =>
    (r.xeroContactId ? clientByXeroId.get(r.xeroContactId) : undefined) ?? (r.contactName ? clientByName.get(r.contactName.toLowerCase()) : undefined) ?? null;

  const payees = ((await db.prepare("SELECT employee_id, match_text, match_mode FROM staff_payees").all()).results ?? []) as any[];
  const resolveEmployee = (supplier: string | null, reference: string | null, description: string | null): string | null => {
    for (const p of payees) if (payeeHit(String(p.match_text), String(p.match_mode), supplier, reference, description)) return String(p.employee_id);
    return null;
  };

  const closed = await closedPeriodSet(db);
  const closedList = [...closed];
  const closedTouched = new Map<string, number>();
  const bump = (p: string, n = 1) => closedTouched.set(p, (closedTouched.get(p) ?? 0) + n);

  // Upserts. project_id (revenue) is a manual override and is NEVER updated;
  // client_id/employee_id follow the mappings (source of truth) on every sync.
  const revStmt = db.prepare(
    "INSERT INTO revenue_lines (id, period, txn_date, source, source_ref, xero_doc_id, doc_number, doc_type, contact_name, xero_contact_id, client_id, gl_code, description, amount_c, currency, fx_rate, amount_fx_c, status) VALUES (?, ?, ?, 'xero', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(source_ref) DO UPDATE SET period = excluded.period, txn_date = excluded.txn_date, xero_doc_id = excluded.xero_doc_id, doc_number = excluded.doc_number, doc_type = excluded.doc_type, contact_name = excluded.contact_name, xero_contact_id = excluded.xero_contact_id, client_id = excluded.client_id, gl_code = excluded.gl_code, description = excluded.description, amount_c = excluded.amount_c, currency = excluded.currency, fx_rate = excluded.fx_rate, amount_fx_c = excluded.amount_fx_c, status = excluded.status, updated_at = datetime('now')",
  );
  const costStmt = db.prepare(
    "INSERT INTO cost_lines (id, period, txn_date, source, source_ref, xero_doc_id, doc_kind, supplier, reference, description, gl_code, employee_id, amount_c, currency, fx_rate, amount_fx_c) VALUES (?, ?, ?, 'xero', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(source_ref) DO UPDATE SET period = excluded.period, txn_date = excluded.txn_date, xero_doc_id = excluded.xero_doc_id, doc_kind = excluded.doc_kind, supplier = excluded.supplier, reference = excluded.reference, description = excluded.description, gl_code = excluded.gl_code, employee_id = excluded.employee_id, amount_c = excluded.amount_c, currency = excluded.currency, fx_rate = excluded.fx_rate, amount_fx_c = excluded.amount_fx_c, updated_at = datetime('now')",
  );

  const upserts: D1PreparedStatement[] = [];
  let revCount = 0;
  let costCount = 0;
  for (const r of revenueRows) {
    const period = r.txnDate.slice(0, 7);
    if (closed.has(period)) {
      bump(period);
      continue;
    }
    upserts.push(revStmt.bind(uuid(), period, r.txnDate, r.sourceRef, r.xeroDocId, r.docNumber, r.docType, r.contactName, r.xeroContactId, resolveClient(r), r.glCode, r.description, r.amountC, r.currency, r.fxRate, r.amountFxC, r.status));
    revCount++;
  }
  for (const r of docs.costs) {
    const period = r.txnDate.slice(0, 7);
    if (closed.has(period)) {
      bump(period);
      continue;
    }
    upserts.push(costStmt.bind(uuid(), period, r.txnDate, r.sourceRef, r.xeroDocId, r.docKind, r.supplier, r.reference, r.description, r.glCode, resolveEmployee(r.supplier, r.reference, r.description), r.amountC, r.currency, r.fxRate, r.amountFxC));
    costCount++;
  }
  await runBatches(db, upserts);

  // Removals (voided/deleted docs): never inside closed periods — those are
  // counted into the post-close warning instead.
  let removedCount = 0;
  if (docs.removedDocIds.length) {
    if (closedList.length) {
      const cm = closedList.map(() => "?").join(",");
      for (let i = 0; i < docs.removedDocIds.length; i += BATCH) {
        const ids = docs.removedDocIds.slice(i, i + BATCH);
        const marks = ids.map(() => "?").join(",");
        for (const table of ["revenue_lines", "cost_lines"]) {
          const rows = ((await db.prepare(`SELECT period, COUNT(*) AS n FROM ${table} WHERE source = 'xero' AND xero_doc_id IN (${marks}) AND period IN (${cm}) GROUP BY period`).bind(...ids, ...closedList).all()).results ?? []) as any[];
          for (const row of rows) bump(String(row.period), Number(row.n));
        }
      }
    }
    const notClosed = closedList.length ? ` AND period NOT IN (${closedList.map(() => "?").join(",")})` : "";
    const dels: D1PreparedStatement[] = [];
    for (const docId of docs.removedDocIds) {
      dels.push(db.prepare(`DELETE FROM revenue_lines WHERE xero_doc_id = ? AND source = 'xero'${notClosed}`).bind(docId, ...closedList));
      dels.push(db.prepare(`DELETE FROM cost_lines WHERE xero_doc_id = ? AND source = 'xero'${notClosed}`).bind(docId, ...closedList));
    }
    const results = await runBatches(db, dels);
    removedCount = results.reduce((s, r) => s + Number(r.meta?.changes ?? 0), 0);
  }

  if (closedTouched.size) {
    const prev = (await getMeta(db, "billing_postclose_warning")) ?? "";
    const lines = [...closedTouched.entries()].sort().map(([p, n]) => `${n} Xero change(s) in closed ${p} since close — snapshot unchanged`);
    await setMeta(db, "billing_postclose_warning", (prev ? prev + "\n" : "") + lines.join("\n"));
  }

  await setMeta(db, "billing_last_sync", syncStartedAt);
  await setMeta(db, "billing_sync_error", "");
  return `billing: ${revCount} revenue line(s), ${costCount} cost line(s) upserted, ${removedCount} removed`;
}

// ---------------------------------------------------------------------------
// Mapping actions (audited; re-resolve open periods only)
// ---------------------------------------------------------------------------

/** Map a Xero contact name to a client and re-point its open-period revenue lines. */
export async function mapContact(db: D1Database, clientId: string, contactName: string, actor: string): Promise<void> {
  const closedList = [...(await closedPeriodSet(db))];
  const notClosed = closedList.length ? ` AND period NOT IN (${closedList.map(() => "?").join(",")})` : "";
  await db.batch([
    db.prepare("INSERT INTO client_contacts (id, client_id, contact_name) VALUES (?, ?, ?) ON CONFLICT(contact_name) DO UPDATE SET client_id = excluded.client_id").bind(uuid(), clientId, contactName),
    db.prepare(`UPDATE revenue_lines SET client_id = ?, updated_at = datetime('now') WHERE contact_name = ? COLLATE NOCASE${notClosed}`).bind(clientId, contactName, ...closedList),
    auditStmt(db, actor, "client_contact", contactName, "map", null, { clientId, contactName }),
  ]);
}

export async function deleteContactMapping(db: D1Database, id: string, actor: string): Promise<void> {
  const before = await db.prepare("SELECT id, client_id, xero_contact_id, contact_name FROM client_contacts WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Contact mapping not found", 404);
  await db.batch([
    db.prepare("DELETE FROM client_contacts WHERE id = ?").bind(id),
    auditStmt(db, actor, "client_contact", id, "delete", before, null),
  ]);
}

/** Add a payee alias and re-resolve unmatched open-period cost lines. Returns the lines matched. */
export async function addStaffPayee(db: D1Database, employeeId: string, matchText: string, matchMode: "exact" | "contains", actor: string): Promise<number> {
  const id = uuid();
  await db.batch([
    db.prepare("INSERT INTO staff_payees (id, employee_id, match_text, match_mode) VALUES (?, ?, ?, ?) ON CONFLICT(match_text) DO UPDATE SET employee_id = excluded.employee_id, match_mode = excluded.match_mode").bind(id, employeeId, matchText, matchMode),
    auditStmt(db, actor, "staff_payee", id, "add", null, { employeeId, matchText, matchMode }),
  ]);
  const closedList = [...(await closedPeriodSet(db))];
  const notClosed = closedList.length ? ` AND period NOT IN (${closedList.map(() => "?").join(",")})` : "";
  const rows = ((await db.prepare(`SELECT id, supplier, reference, description FROM cost_lines WHERE employee_id IS NULL${notClosed}`).bind(...closedList).all()).results ?? []) as any[];
  const hits = rows.filter((r) => payeeHit(matchText, matchMode, r.supplier ?? null, r.reference ?? null, r.description ?? null));
  await runBatches(db, hits.map((r) => db.prepare("UPDATE cost_lines SET employee_id = ?, updated_at = datetime('now') WHERE id = ?").bind(employeeId, r.id)));
  return hits.length;
}

export async function deleteStaffPayee(db: D1Database, id: string, actor: string): Promise<void> {
  const before = await db.prepare("SELECT id, employee_id, match_text, match_mode FROM staff_payees WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Staff payee not found", 404);
  await db.batch([
    db.prepare("DELETE FROM staff_payees WHERE id = ?").bind(id),
    auditStmt(db, actor, "staff_payee", id, "delete", before, null),
  ]);
}

export type StaffPayeeRow = { id: string; employeeId: string; employeeName: string; matchText: string; matchMode: "exact" | "contains" };

export async function listStaffPayees(db: D1Database): Promise<StaffPayeeRow[]> {
  const { results } = await db
    .prepare("SELECT p.id, p.employee_id, e.name AS employee_name, p.match_text, p.match_mode FROM staff_payees p JOIN employees e ON e.id = p.employee_id ORDER BY e.name, p.match_text")
    .all<any>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    matchText: String(r.match_text),
    matchMode: r.match_mode as "exact" | "contains",
  }));
}

export async function setEmployeeBillingSettings(db: D1Database, employeeId: string, defaultTarget: "general" | "overhead", loadingPct: number, actor: string): Promise<void> {
  const before = await db.prepare("SELECT default_target, loading_pct FROM employees WHERE id = ?").bind(employeeId).first<any>();
  if (!before) throw new BillingError("Employee not found", 404);
  await db.batch([
    db.prepare("UPDATE employees SET default_target = ?, loading_pct = ?, updated_at = datetime('now') WHERE id = ?").bind(defaultTarget, loadingPct, employeeId),
    auditStmt(db, actor, "employee_billing", employeeId, "settings", { defaultTarget: before.default_target, loadingPct: before.loading_pct }, { defaultTarget, loadingPct }),
  ]);
}

// ---------------------------------------------------------------------------
// Clients / projects / categories settings
// ---------------------------------------------------------------------------

export async function listClients(db: D1Database): Promise<BillingClient[]> {
  const { results } = await db.prepare("SELECT id, name, short_name, is_general, sort_order, active FROM clients ORDER BY sort_order, name").all<any>();
  return (results ?? []).map(mapClient);
}

/** Create a client with its default project (one batch). */
export async function createClient(db: D1Database, name: string, shortName: string | null, actor: string): Promise<BillingClient> {
  const id = uuid();
  const next = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM clients WHERE is_general = 0").first<{ s: number }>();
  const sortOrder = Number(next?.s ?? 1);
  await db.batch([
    db.prepare("INSERT INTO clients (id, name, short_name, is_general, sort_order, active) VALUES (?, ?, ?, 0, ?, 1)").bind(id, name, shortName, sortOrder),
    db.prepare("INSERT INTO projects (id, client_id, name, is_default) VALUES (?, ?, ?, 1)").bind(uuid(), id, name),
    auditStmt(db, actor, "client", id, "create", null, { name, shortName }),
  ]);
  return { id, name, shortName, isGeneral: false, sortOrder, active: true };
}

export async function renameClient(db: D1Database, id: string, name: string, shortName: string | null, actor: string): Promise<void> {
  const before = await db.prepare("SELECT name, short_name FROM clients WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Client not found", 404);
  await db.batch([
    db.prepare("UPDATE clients SET name = ?, short_name = ? WHERE id = ?").bind(name, shortName, id),
    auditStmt(db, actor, "client", id, "rename", { name: before.name, shortName: before.short_name }, { name, shortName }),
  ]);
}

export async function setClientActive(db: D1Database, id: string, active: boolean, actor: string): Promise<void> {
  const before = await db.prepare("SELECT active FROM clients WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Client not found", 404);
  await db.batch([
    db.prepare("UPDATE clients SET active = ? WHERE id = ?").bind(active ? 1 : 0, id),
    auditStmt(db, actor, "client", id, "set_active", { active: !!before.active }, { active }),
  ]);
}

export type ProjectWithClient = BillingProject & { clientName: string };

export async function listBillingProjects(db: D1Database): Promise<ProjectWithClient[]> {
  const { results } = await db
    .prepare(
      "SELECT p.id, p.client_id, p.name, p.code, p.is_default, p.billing_type, p.contract_value_c, p.start_period, p.end_period, p.status, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.sort_order, c.name, p.is_default DESC, p.name",
    )
    .all<any>();
  return (results ?? []).map((r) => ({ ...mapProject(r), clientName: String(r.client_name) }));
}

export async function createProject(db: D1Database, clientId: string, name: string, billingType: BillingProject["billingType"], contractValueC: number | null, actor: string): Promise<string> {
  const id = uuid();
  await db.batch([
    db.prepare("INSERT INTO projects (id, client_id, name, is_default, billing_type, contract_value_c) VALUES (?, ?, ?, 0, ?, ?)").bind(id, clientId, name, billingType, contractValueC),
    auditStmt(db, actor, "project", id, "create", null, { clientId, name, billingType, contractValueC }),
  ]);
  return id;
}

export type ProjectPatch = {
  name?: string;
  code?: string | null;
  billingType?: BillingProject["billingType"];
  contractValueC?: number | null;
  startPeriod?: string | null;
  endPeriod?: string | null;
};

export async function updateProject(db: D1Database, id: string, patch: ProjectPatch, actor: string): Promise<void> {
  const before = await db.prepare("SELECT id, client_id, name, code, is_default, billing_type, contract_value_c, start_period, end_period, status FROM projects WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Project not found", 404);
  const sets: string[] = [];
  const binds: unknown[] = [];
  const field = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(v);
  };
  if (patch.name !== undefined) field("name", patch.name);
  if (patch.code !== undefined) field("code", patch.code);
  if (patch.billingType !== undefined) field("billing_type", patch.billingType);
  if (patch.contractValueC !== undefined) field("contract_value_c", patch.contractValueC);
  if (patch.startPeriod !== undefined) field("start_period", patch.startPeriod);
  if (patch.endPeriod !== undefined) field("end_period", patch.endPeriod);
  if (!sets.length) return;
  await db.batch([
    db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id),
    auditStmt(db, actor, "project", id, "update", mapProject(before), patch),
  ]);
}

export async function closeProject(db: D1Database, id: string, actor: string): Promise<void> {
  const before = await db.prepare("SELECT status FROM projects WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Project not found", 404);
  await db.batch([
    db.prepare("UPDATE projects SET status = 'closed' WHERE id = ?").bind(id),
    auditStmt(db, actor, "project", id, "close", { status: before.status }, { status: "closed" }),
  ]);
}

export type GlCategoryRow = GlCategory & { active: boolean };

export async function listCategories(db: D1Database): Promise<GlCategoryRow[]> {
  const { results } = await db.prepare("SELECT code, name, kind, report_group, treatment, sort_order, active FROM gl_categories ORDER BY sort_order, code").all<any>();
  return (results ?? []).map((r) => ({ ...mapCategory(r), active: !!r.active }));
}

export async function setCategoryTreatment(db: D1Database, code: string, reportGroup: string, treatment: Treatment, actor: string): Promise<void> {
  const before = await db.prepare("SELECT report_group, treatment FROM gl_categories WHERE code = ?").bind(code).first<any>();
  if (!before) throw new BillingError("GL category not found", 404);
  await db.batch([
    db.prepare("UPDATE gl_categories SET report_group = ?, treatment = ? WHERE code = ?").bind(reportGroup, treatment, code),
    auditStmt(db, actor, "gl_category", code, "set_treatment", { reportGroup: before.report_group, treatment: before.treatment }, { reportGroup, treatment }),
  ]);
}

export type ContactMappingRow = { id: string; clientId: string; clientName: string; xeroContactId: string | null; contactName: string };

export async function listContactMappings(db: D1Database): Promise<ContactMappingRow[]> {
  const { results } = await db
    .prepare("SELECT m.id, m.client_id, c.name AS client_name, m.xero_contact_id, m.contact_name FROM client_contacts m JOIN clients c ON c.id = m.client_id ORDER BY c.sort_order, m.contact_name")
    .all<any>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    clientId: String(r.client_id),
    clientName: String(r.client_name),
    xeroContactId: r.xero_contact_id ?? null,
    contactName: String(r.contact_name),
  }));
}

export async function setBudget(db: D1Database, projectId: string, period: string, revenueC: number, costC: number, actor: string): Promise<void> {
  await assertPeriodOpen(db, period);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO project_budgets (project_id, period, revenue_c, cost_c) VALUES (?, ?, ?, ?)").bind(projectId, period, revenueC, costC),
    auditStmt(db, actor, "project_budget", `${projectId}:${period}`, "set", null, { projectId, period, revenueC, costC }),
  ]);
}

export async function listBudgets(db: D1Database, periods: string[]): Promise<ProjectBudget[]> {
  if (!periods.length) return [];
  const marks = periods.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT project_id, period, revenue_c, cost_c FROM project_budgets WHERE period IN (${marks}) ORDER BY period, project_id`).bind(...periods).all<any>();
  return (results ?? []).map((b) => ({ projectId: String(b.project_id), period: String(b.period), revenueC: Number(b.revenue_c), costC: Number(b.cost_c) }));
}

/** Replace the fixed overhead shares for a period (used when basis = fixed). */
export async function setFixedShares(db: D1Database, period: string, shares: { clientId: string; pct: number }[], actor: string): Promise<void> {
  await assertPeriodOpen(db, period);
  await db.batch([
    db.prepare("DELETE FROM overhead_fixed_shares WHERE period = ?").bind(period),
    ...shares.map((s) => db.prepare("INSERT INTO overhead_fixed_shares (period, client_id, pct) VALUES (?, ?, ?)").bind(period, s.clientId, s.pct)),
    auditStmt(db, actor, "overhead_fixed_shares", period, "set", null, { shares }),
  ]);
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

/** All allocation rows with period <= uptoPeriod (grid + engine resolve carry-forward). */
export async function listAllocationRows(db: D1Database, uptoPeriod: string): Promise<StaffAllocation[]> {
  const { results } = await db
    .prepare("SELECT employee_id, period, target_kind, project_id, pct FROM staff_allocations WHERE period <= ? ORDER BY period, employee_id")
    .bind(uptoPeriod)
    .all<any>();
  return (results ?? []).map((a) => ({
    employeeId: String(a.employee_id),
    period: String(a.period),
    targetKind: a.target_kind as "project" | "overhead",
    projectId: a.project_id ?? null,
    pct: Number(a.pct),
  }));
}

export type AllocationInput = { employeeId: string; targetKind: "project" | "overhead"; projectId: string | null; pct: number };

/** Replace the whole month's allocation rows (the grid posts the full month). */
export async function saveAllocations(db: D1Database, period: string, rows: AllocationInput[], actor: string): Promise<void> {
  await assertPeriodOpen(db, period);
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (!(r.pct > 0 && r.pct <= 100)) throw new BillingError(`Allocation pct must be in (0,100] — got ${r.pct}`, 422);
    totals.set(r.employeeId, (totals.get(r.employeeId) ?? 0) + r.pct);
  }
  for (const [employeeId, total] of totals) {
    if (total > 100.001) throw new BillingError(`Allocations for employee ${employeeId} total ${total}% (max 100)`, 422);
  }
  await db.batch([
    db.prepare("DELETE FROM staff_allocations WHERE period = ?").bind(period),
    ...rows.map((r) => db.prepare("INSERT INTO staff_allocations (id, employee_id, period, target_kind, project_id, pct) VALUES (?, ?, ?, ?, ?, ?)").bind(uuid(), r.employeeId, period, r.targetKind, r.projectId, r.pct)),
    auditStmt(db, actor, "staff_allocations", period, "save", null, { rows: rows.length }),
  ]);
}

export async function copyAllocationsForward(db: D1Database, fromPeriod: string, toPeriod: string, actor: string): Promise<void> {
  await assertPeriodOpen(db, toPeriod);
  await db.batch([
    db.prepare("DELETE FROM staff_allocations WHERE period = ?").bind(toPeriod),
    db.prepare("INSERT INTO staff_allocations (id, employee_id, period, target_kind, project_id, pct) SELECT lower(hex(randomblob(16))), employee_id, ?, target_kind, project_id, pct FROM staff_allocations WHERE period = ?").bind(toPeriod, fromPeriod),
    auditStmt(db, actor, "staff_allocations", toPeriod, "copy_forward", null, { fromPeriod, toPeriod }),
  ]);
}

export async function clearAllocations(db: D1Database, period: string, actor: string): Promise<void> {
  await assertPeriodOpen(db, period);
  await db.batch([
    db.prepare("DELETE FROM staff_allocations WHERE period = ?").bind(period),
    auditStmt(db, actor, "staff_allocations", period, "clear", null, null),
  ]);
}

// ---------------------------------------------------------------------------
// Ledger queries for views
// ---------------------------------------------------------------------------

export type RevenueLineView = RevenueLine & {
  sourceRef: string | null;
  xeroDocId: string | null;
  xeroContactId: string | null;
  currency: string;
  fxRate: number | null;
  amountFxC: number | null;
  status: string | null;
  clientName: string | null;
  projectName: string | null;
  unmapped: boolean;
};

export async function listRevenueLinesForPeriods(db: D1Database, periods: string[]): Promise<RevenueLineView[]> {
  if (!periods.length) return [];
  const marks = periods.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT r.*, c.name AS client_name, p.name AS project_name FROM revenue_lines r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN projects p ON p.id = r.project_id WHERE r.period IN (${marks}) ORDER BY r.txn_date, r.id`,
    )
    .bind(...periods)
    .all<any>();
  return (results ?? []).map((r) => ({
    ...mapRevenueLine(r),
    sourceRef: r.source_ref ?? null,
    xeroDocId: r.xero_doc_id ?? null,
    xeroContactId: r.xero_contact_id ?? null,
    currency: String(r.currency ?? "ZAR"),
    fxRate: r.fx_rate ?? null,
    amountFxC: r.amount_fx_c ?? null,
    status: r.status ?? null,
    clientName: r.client_name ?? null,
    projectName: r.project_name ?? null,
    unmapped: r.client_id == null,
  }));
}

export type CostLineView = CostLine & {
  sourceRef: string | null;
  xeroDocId: string | null;
  currency: string;
  fxRate: number | null;
  amountFxC: number | null;
  treatment: Treatment | null;
  reportGroup: string | null;
  employeeName: string | null;
  splits: CostSplit[];
};

export async function listCostLinesForPeriods(db: D1Database, periods: string[]): Promise<CostLineView[]> {
  if (!periods.length) return [];
  const marks = periods.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT l.*, g.treatment, g.report_group, e.name AS employee_name FROM cost_lines l LEFT JOIN gl_categories g ON g.code = l.gl_code LEFT JOIN employees e ON e.id = l.employee_id WHERE l.period IN (${marks}) ORDER BY l.txn_date, l.id`,
    )
    .bind(...periods)
    .all<any>();
  const splitRows = ((await db
    .prepare(`SELECT s.cost_line_id, s.target_kind, s.project_id, s.pct FROM cost_splits s JOIN cost_lines l ON l.id = s.cost_line_id WHERE l.period IN (${marks})`)
    .bind(...periods)
    .all()).results ?? []) as any[];
  const splitsByLine = new Map<string, CostSplit[]>();
  for (const s of splitRows) {
    const key = String(s.cost_line_id);
    const list = splitsByLine.get(key) ?? [];
    list.push({ costLineId: key, targetKind: s.target_kind as TargetKind, projectId: s.project_id ?? null, pct: Number(s.pct) });
    splitsByLine.set(key, list);
  }
  return (results ?? []).map((r) => ({
    ...mapCostLine(r),
    sourceRef: r.source_ref ?? null,
    xeroDocId: r.xero_doc_id ?? null,
    currency: String(r.currency ?? "ZAR"),
    fxRate: r.fx_rate ?? null,
    amountFxC: r.amount_fx_c ?? null,
    treatment: (r.treatment ?? null) as Treatment | null,
    reportGroup: r.report_group ?? null,
    employeeName: r.employee_name ?? null,
    splits: splitsByLine.get(String(r.id)) ?? [],
  }));
}

/** Manually point a revenue line at a project (null = back to client default). */
export async function setRevenueProjectOverride(db: D1Database, lineId: string, projectId: string | null, actor: string): Promise<void> {
  const line = await db.prepare("SELECT id, period, project_id FROM revenue_lines WHERE id = ?").bind(lineId).first<any>();
  if (!line) throw new BillingError("Revenue line not found", 404);
  await assertPeriodOpen(db, String(line.period));
  await db.batch([
    db.prepare("UPDATE revenue_lines SET project_id = ?, updated_at = datetime('now') WHERE id = ?").bind(projectId, lineId),
    auditStmt(db, actor, "revenue_line", lineId, "project_override", { projectId: line.project_id ?? null }, { projectId }),
  ]);
}

export type CostSplitInput = { targetKind: TargetKind; projectId: string | null; pct: number };

/** Replace a cost line's manual splits; empty array clears them. */
export async function setCostSplits(db: D1Database, costLineId: string, splits: CostSplitInput[], actor: string): Promise<void> {
  const line = await db.prepare("SELECT id, period FROM cost_lines WHERE id = ?").bind(costLineId).first<any>();
  if (!line) throw new BillingError("Cost line not found", 404);
  await assertPeriodOpen(db, String(line.period));
  if (splits.length) {
    const sum = splits.reduce((s, x) => s + x.pct, 0);
    if (Math.abs(sum - 100) > 0.01) throw new BillingError(`Split percentages must total 100 — got ${sum}`, 422);
  }
  await db.batch([
    db.prepare("DELETE FROM cost_splits WHERE cost_line_id = ?").bind(costLineId),
    ...splits.map((s) => db.prepare("INSERT INTO cost_splits (id, cost_line_id, target_kind, project_id, pct) VALUES (?, ?, ?, ?, ?)").bind(uuid(), costLineId, s.targetKind, s.projectId, s.pct)),
    auditStmt(db, actor, "cost_splits", costLineId, "set", null, { splits }),
  ]);
}

/** Provisional gl_categories row so manual/CSV lines never break the FK. */
async function ensureGlCode(db: D1Database, code: string | null | undefined, kind: "revenue" | "cost"): Promise<void> {
  if (!code) return;
  const p = provisionalCategory(code, kind);
  await db.prepare("INSERT OR IGNORE INTO gl_categories (code, name, kind, report_group, treatment, sort_order) VALUES (?, '', ?, ?, ?, 900)").bind(code, kind, p.group, p.treatment).run();
}

export type ManualCostLineInput = {
  txnDate: string; // YYYY-MM-DD
  supplier?: string | null;
  reference?: string | null;
  description?: string | null;
  glCode?: string | null;
  amountC: number;
};

export async function addManualCostLine(db: D1Database, input: ManualCostLineInput, actor: string): Promise<string> {
  const period = input.txnDate.slice(0, 7);
  await assertPeriodOpen(db, period);
  await ensureGlCode(db, input.glCode, "cost");
  const id = uuid();
  await db.batch([
    db.prepare("INSERT INTO cost_lines (id, period, txn_date, source, supplier, reference, description, gl_code, amount_c) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?)")
      .bind(id, period, input.txnDate, input.supplier ?? null, input.reference ?? null, input.description ?? null, input.glCode ?? null, input.amountC),
    auditStmt(db, actor, "cost_line", id, "add_manual", null, input),
  ]);
  return id;
}

export type ManualRevenueLineInput = {
  txnDate: string; // YYYY-MM-DD
  contactName?: string | null;
  docNumber?: string | null;
  description?: string | null;
  glCode?: string | null;
  amountC: number;
  clientId?: string | null;
  projectId?: string | null;
};

export async function addManualRevenueLine(db: D1Database, input: ManualRevenueLineInput, actor: string): Promise<string> {
  const period = input.txnDate.slice(0, 7);
  await assertPeriodOpen(db, period);
  await ensureGlCode(db, input.glCode, "revenue");
  const id = uuid();
  await db.batch([
    db.prepare("INSERT INTO revenue_lines (id, period, txn_date, source, doc_number, contact_name, client_id, project_id, gl_code, description, amount_c) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, period, input.txnDate, input.docNumber ?? null, input.contactName ?? null, input.clientId ?? null, input.projectId ?? null, input.glCode ?? null, input.description ?? null, input.amountC),
    auditStmt(db, actor, "revenue_line", id, "add_manual", null, input),
  ]);
  return id;
}

/** Delete a manual/CSV line (Xero lines are owned by the sync → 400). */
export async function deleteLine(db: D1Database, table: "revenue_lines" | "cost_lines", id: string, actor: string): Promise<void> {
  if (table !== "revenue_lines" && table !== "cost_lines") throw new BillingError("Unknown ledger table", 400);
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<any>();
  if (!row) throw new BillingError("Line not found", 404);
  if (row.source !== "manual" && row.source !== "csv") throw new BillingError("Only manual or CSV lines can be deleted", 400);
  await assertPeriodOpen(db, String(row.period));
  await db.batch([
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id),
    auditStmt(db, actor, table === "revenue_lines" ? "revenue_line" : "cost_line", id, "delete", row, null),
  ]);
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/** Minimal CSV parser: comma-separated, double-quoted fields, "" escapes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0].trim() !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0].trim() !== "") rows.push(row);
  return rows;
}

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type CsvImportResult = { inserted: number; skippedClosed: number; errors: string[] };

/**
 * Import ledger lines from CSV. Columns: date, contact|supplier, reference,
 * description, account_code, amount_excl, currency (header row required).
 * source_ref = sha1 of kind|date|party|description|amount, so re-imports
 * never duplicate (INSERT OR IGNORE). Closed-period rows are skipped.
 */
export async function importCsv(db: D1Database, kind: "revenue" | "cost", text: string, actor: string): Promise<CsvImportResult> {
  const rows = parseCsv(text);
  if (rows.length < 2) return { inserted: 0, skippedClosed: 0, errors: rows.length ? ["no data rows"] : ["empty file"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = col("date");
  const iParty = kind === "revenue" ? col("contact", "supplier", "party") : col("supplier", "contact", "party");
  const iRef = col("reference");
  const iDesc = col("description");
  const iGl = col("account_code", "gl_code");
  const iAmt = col("amount_excl", "amount");
  const iCur = col("currency");
  if (iDate < 0 || iAmt < 0) throw new BillingError("CSV needs at least 'date' and 'amount_excl' columns", 400);

  const closed = await closedPeriodSet(db);
  const errors: string[] = [];
  let skippedClosed = 0;
  const stmts: D1PreparedStatement[] = [];
  const glCodes = new Set<string>();
  const cell = (r: string[], i: number): string | null => (i >= 0 ? (r[i] ?? "").trim() || null : null);

  for (let n = 1; n < rows.length; n++) {
    const r = rows[n];
    const date = (r[iDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`row ${n + 1}: bad date '${date}'`);
      continue;
    }
    const amountRaw = (r[iAmt] ?? "").trim();
    const amount = parseFloat(amountRaw.replace(/[,\sR]/g, ""));
    if (!Number.isFinite(amount)) {
      errors.push(`row ${n + 1}: bad amount '${amountRaw}'`);
      continue;
    }
    const period = date.slice(0, 7);
    if (closed.has(period)) {
      skippedClosed++;
      continue;
    }
    const party = cell(r, iParty);
    const reference = cell(r, iRef);
    const description = cell(r, iDesc);
    const glCode = cell(r, iGl);
    const currency = cell(r, iCur) ?? "ZAR";
    if (glCode) glCodes.add(glCode);
    const sourceRef = await sha1Hex(`${kind}|${date}|${party ?? ""}|${description ?? ""}|${amount}`);
    const amountC = Math.round(amount * 100);
    if (kind === "revenue") {
      stmts.push(
        db.prepare("INSERT OR IGNORE INTO revenue_lines (id, period, txn_date, source, source_ref, doc_number, contact_name, gl_code, description, amount_c, currency) VALUES (?, ?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?)")
          .bind(uuid(), period, date, sourceRef, reference, party, glCode, description, amountC, currency),
      );
    } else {
      stmts.push(
        db.prepare("INSERT OR IGNORE INTO cost_lines (id, period, txn_date, source, source_ref, supplier, reference, description, gl_code, amount_c, currency) VALUES (?, ?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?)")
          .bind(uuid(), period, date, sourceRef, party, reference, description, glCode, amountC, currency),
      );
    }
  }

  let inserted = 0;
  if (stmts.length) {
    for (const code of glCodes) await ensureGlCode(db, code, kind);
    // Audit rides in the first chunk with the rows it describes (changes − 1 excludes it).
    const results = await runBatches(db, [auditStmt(db, actor, "csv_import", null, "import", null, { kind, rows: stmts.length }), ...stmts]);
    inserted = results.reduce((s, r) => s + Number(r.meta?.changes ?? 0), 0) - 1;
  }
  return { inserted, skippedClosed, errors };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function listRules(db: D1Database): Promise<CostRule[]> {
  const rules = ((await db.prepare("SELECT id, name, priority, supplier_match, description_match, gl_code, mode, effective_from, effective_to, active FROM cost_rules ORDER BY priority, name").all()).results ?? []) as any[];
  const splits = ((await db.prepare("SELECT rule_id, target_kind, project_id, pct, fixed_c, is_remainder FROM cost_rule_splits ORDER BY id").all()).results ?? []) as any[];
  const byRule = new Map<string, any[]>();
  for (const s of splits) {
    const list = byRule.get(String(s.rule_id)) ?? [];
    list.push(s);
    byRule.set(String(s.rule_id), list);
  }
  return rules.map((r) => mapRule(r, byRule.get(String(r.id)) ?? []));
}

/** Upsert a rule and replace its splits (validated: percent Σ=100, fixed needs a remainder). */
export async function saveRule(db: D1Database, rule: CostRule, actor: string): Promise<string> {
  if (rule.mode === "percent") {
    const sum = rule.splits.reduce((s, x) => s + (x.pct ?? 0), 0);
    if (Math.abs(sum - 100) > 0.001) throw new BillingError(`Percent splits must total 100 — got ${sum}`, 422);
  } else if (!rule.splits.some((s) => s.isRemainder)) {
    throw new BillingError("Fixed-mode rules need at least one remainder split", 422);
  }
  const id = rule.id || uuid();
  const before = await db.prepare("SELECT id, name, priority, supplier_match, description_match, gl_code, mode, effective_from, effective_to, active FROM cost_rules WHERE id = ?").bind(id).first<any>();
  await db.batch([
    db.prepare(
      "INSERT INTO cost_rules (id, name, priority, supplier_match, description_match, gl_code, mode, effective_from, effective_to, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET name = excluded.name, priority = excluded.priority, supplier_match = excluded.supplier_match, description_match = excluded.description_match, gl_code = excluded.gl_code, mode = excluded.mode, effective_from = excluded.effective_from, effective_to = excluded.effective_to, active = excluded.active",
    ).bind(id, rule.name, rule.priority, rule.supplierMatch, rule.descriptionMatch, rule.glCode, rule.mode, rule.effectiveFrom, rule.effectiveTo, rule.active ? 1 : 0),
    db.prepare("DELETE FROM cost_rule_splits WHERE rule_id = ?").bind(id),
    ...rule.splits.map((s) =>
      db.prepare("INSERT INTO cost_rule_splits (id, rule_id, target_kind, project_id, pct, fixed_c, is_remainder) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(uuid(), id, s.targetKind, s.projectId ?? null, s.pct ?? null, s.fixedC ?? null, s.isRemainder ? 1 : 0),
    ),
    auditStmt(db, actor, "cost_rule", id, before ? "update" : "create", before, rule),
  ]);
  return id;
}

export async function deleteRule(db: D1Database, id: string, actor: string): Promise<void> {
  const before = await db.prepare("SELECT id, name, priority, mode FROM cost_rules WHERE id = ?").bind(id).first<any>();
  if (!before) throw new BillingError("Rule not found", 404);
  await db.batch([
    db.prepare("DELETE FROM cost_rules WHERE id = ?").bind(id), // splits cascade
    auditStmt(db, actor, "cost_rule", id, "delete", before, null),
  ]);
}

export type RulePreviewRow = { line: CostLine; pieces: SplitPiece[] };

/** Dry-run a rule against the last `monthsBack` months' cost lines. */
export async function rulePreview(db: D1Database, rule: CostRule, monthsBack = 3): Promise<RulePreviewRow[]> {
  const periods: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < monthsBack; i++) {
    periods.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  const marks = periods.map(() => "?").join(",");
  const rows = ((await db
    .prepare(`SELECT id, period, txn_date, source, doc_kind, supplier, reference, description, gl_code, employee_id, amount_c FROM cost_lines WHERE period IN (${marks}) ORDER BY txn_date, id`)
    .bind(...periods)
    .all()).results ?? []) as any[];
  const out: RulePreviewRow[] = [];
  for (const r of rows) {
    const line = mapCostLine(r);
    const m: MatchableLine = { supplier: line.supplier, description: line.description, glCode: line.glCode, txnDate: line.txnDate };
    if (firstMatchingRule([rule], m)) out.push({ line, pieces: applyRuleSplits(line.amountC, rule) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditRow = {
  id: string;
  at: string;
  actor: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  beforeJson: string | null;
  afterJson: string | null;
};

export async function listAudit(db: D1Database, limit = 100): Promise<AuditRow[]> {
  const { results } = await db.prepare("SELECT id, at, actor, entity, entity_id, action, before_json, after_json FROM billing_audit ORDER BY at DESC, id DESC LIMIT ?").bind(limit).all<any>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    at: String(r.at),
    actor: r.actor ?? null,
    entity: String(r.entity),
    entityId: r.entity_id ?? null,
    action: String(r.action),
    beforeJson: r.before_json ?? null,
    afterJson: r.after_json ?? null,
  }));
}
