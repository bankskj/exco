// Client-billing health — the FY27 audit's checks made permanent. Runs live
// on the Data Quality screen so coding drift in Xero and mapping gaps in the
// module surface immediately instead of distorting client reports.

import type { Check } from "../lib/quality";
import { firstMatchingRule } from "../lib/billing_rules";
import { formatZAR } from "../lib/money";
import { label, fiscalYearOf, rangeInclusive } from "../lib/period";
import { listRules } from "./billing";

const R = (cents: number) => formatZAR(Math.round(cents / 100));
const GROUP = "Client billing";

export async function buildBillingHealth(db: D1Database): Promise<Check[]> {
  const checks: Check[] = [];
  const q = async (sql: string, ...binds: unknown[]): Promise<any[]> =>
    ((await db.prepare(sql).bind(...binds).all()).results ?? []) as any[];
  const nowMonth = new Date().toISOString().slice(0, 7);
  const fyStart = `${fiscalYearOf(nowMonth) - 1}-03`;
  const months = rangeInclusive(fyStart < "2026-03" ? "2026-03" : fyStart, nowMonth);
  const marks = months.map(() => "?").join(",");

  // 1 — Xero P&L tie-out per month (documents vs the accrual P&L; balance
  // sheet excluded on both sides). A gap means manual journals or a sync hole.
  const tie = await q(
    `SELECT a.month,
       ROUND(a.income_accr * 100) - (SELECT COALESCE(SUM(r.amount_c), 0) FROM revenue_lines r JOIN gl_categories g ON g.code = r.gl_code WHERE r.period = a.month AND g.kind = 'revenue') AS inc_diff_c,
       ROUND((a.staff_accr + a.dev_accr + a.other_accr) * 100) - (SELECT COALESCE(SUM(l.amount_c), 0) FROM cost_lines l JOIN gl_categories g ON g.code = l.gl_code WHERE l.period = a.month AND g.report_group != 'Balance sheet') AS cost_diff_c
     FROM cf_actuals a WHERE a.month IN (${marks}) ORDER BY a.month`,
    ...months,
  );
  const badTie = tie.filter((t) => Math.abs(Number(t.inc_diff_c)) > 100_000 || Math.abs(Number(t.cost_diff_c)) > 100_000);
  checks.push(
    badTie.length === 0
      ? { group: GROUP, name: "Xero P&L tie-out", status: "ok", detail: `Documents match the Xero P&L within R 1 000 in all ${tie.length} synced month(s).` }
      : {
          group: GROUP,
          name: "Xero P&L tie-out",
          status: "warn",
          detail:
            badTie
              .map((t) => `${label(String(t.month))}: cost ${R(-Number(t.cost_diff_c))}${Math.abs(Number(t.inc_diff_c)) > 100_000 ? `, income ${R(-Number(t.inc_diff_c))}` : ""} off the P&L`)
              .join("; ") + " — documents and the synced Xero P&L disagree; re-run a sync (the P&L is fetched per month since the day-31 truncation fix) and re-check.",
        },
  );

  // 2 — Payroll estimates standing in for unmatched payments.
  const est = await q(
    `SELECT e.name, COUNT(*) AS m, ROUND(SUM(p.gross) * 100) AS c FROM payroll_entries p JOIN employees e ON e.id = p.employee_id
     WHERE p.period IN (${marks}) AND p.gross > 0
       AND NOT EXISTS (SELECT 1 FROM cost_lines l WHERE l.employee_id = p.employee_id AND l.period = p.period AND l.doc_kind != 'refund')
     GROUP BY e.name ORDER BY c DESC`,
    ...months,
  );
  const estTotal = est.reduce((s, r) => s + Number(r.c), 0);
  checks.push(
    est.length === 0
      ? { group: GROUP, name: "Payroll estimates", status: "ok", detail: "Every payroll month is backed by a matched payment." }
      : { group: GROUP, name: "Payroll estimates", status: "warn", detail: `${est.reduce((s, r) => s + Number(r.m), 0)} staff-month(s), ${R(estTotal)} estimated: ${est.slice(0, 6).map((r) => `${r.name} (${r.m})`).join(", ")}${est.length > 6 ? "…" : ""} — add aliases or accept as genuine gaps.` },
  );

  // 3 — Register vs actual pay, per person (gap > R 10 000 FY-to-date).
  const gaps = await q(
    `SELECT e.name, ROUND(SUM(p.gross - p.paye) * 100) AS nett_c,
       (SELECT COALESCE(SUM(l.amount_c), 0) FROM cost_lines l WHERE l.employee_id = e.id AND l.period IN (${marks}) AND l.doc_kind != 'refund') AS paid_c
     FROM payroll_entries p JOIN employees e ON e.id = p.employee_id WHERE p.period IN (${marks})
     GROUP BY e.id HAVING ABS(paid_c - nett_c) > 1000000 ORDER BY ABS(paid_c - nett_c) DESC`,
    ...months,
    ...months,
  );
  checks.push(
    gaps.length === 0
      ? { group: GROUP, name: "Register vs payments", status: "ok", detail: "Every register nett is within R 10 000 of actual payments." }
      : { group: GROUP, name: "Register vs payments", status: "warn", detail: gaps.slice(0, 5).map((g) => `${g.name} ${R(Number(g.paid_c) - Number(g.nett_c))}`).join(", ") + " — unpaid salary (loan account?) or register months missing." },
  );

  // 4 — Active staff without any payee alias (their pay can only estimate).
  const noAlias = await q(
    "SELECT e.name FROM employees e WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM staff_payees s WHERE s.employee_id = e.id) ORDER BY e.name",
  );
  checks.push(
    noAlias.length === 0
      ? { group: GROUP, name: "Payee aliases", status: "ok", detail: "Every active staff member has at least one alias." }
      : { group: GROUP, name: "Payee aliases", status: "warn", detail: `${noAlias.length} active staff without an alias: ${noAlias.map((r) => r.name).join(", ")}.` },
  );

  // 5 — Payroll captured after a leaver's inactive date (phantom estimates).
  const leaver = await q(
    "SELECT e.name, COUNT(*) AS m FROM payroll_entries p JOIN employees e ON e.id = p.employee_id WHERE e.status = 'inactive' AND e.inactive_date IS NOT NULL AND p.period > substr(e.inactive_date, 1, 7) AND p.gross > 0 GROUP BY e.name",
  );
  checks.push(
    leaver.length === 0
      ? { group: GROUP, name: "Leaver payroll", status: "ok", detail: "No payroll captured past anyone's leaving date." }
      : { group: GROUP, name: "Leaver payroll", status: "warn", detail: leaver.map((r) => `${r.name} (${r.m} month(s) past leaving)`).join(", ") + " — clear the register rows or the engine keeps estimating them." },
  );

  // 6 — Revenue contacts defaulting to General Sales.
  const unmapped = await q("SELECT COUNT(DISTINCT contact_name) AS n, COALESCE(SUM(amount_c), 0) AS c FROM revenue_lines WHERE client_id IS NULL");
  checks.push(
    Number(unmapped[0]?.n ?? 0) === 0
      ? { group: GROUP, name: "Contact mapping", status: "ok", detail: "Every revenue contact is explicitly mapped." }
      : { group: GROUP, name: "Contact mapping", status: "warn", detail: `${unmapped[0].n} contact(s), ${R(Number(unmapped[0].c))} defaulting to General Sales — map or accept them on the Revenue page.` },
  );

  // 7 — Direct cost with no owner: no split, no matching rule, no staff match.
  const rules = await listRules(db);
  const directLines = await q(
    `SELECT l.id, l.supplier, l.description, l.gl_code, l.txn_date, l.amount_c FROM cost_lines l JOIN gl_categories g ON g.code = l.gl_code
     WHERE g.treatment = 'direct' AND l.employee_id IS NULL AND l.period IN (${marks})
       AND NOT EXISTS (SELECT 1 FROM cost_splits s WHERE s.cost_line_id = l.id)`,
    ...months,
  );
  const unassigned = directLines.filter(
    (l) => !firstMatchingRule(rules, { supplier: l.supplier ?? null, description: l.description ?? null, glCode: l.gl_code ?? null, txnDate: String(l.txn_date) }),
  );
  const unassignedC = unassigned.reduce((s, l) => s + Number(l.amount_c), 0);
  checks.push(
    unassigned.length === 0
      ? { group: GROUP, name: "Direct cost assignment", status: "ok", detail: "Every direct cost line has a split, a rule or a staff match." }
      : { group: GROUP, name: "Direct cost assignment", status: "warn", detail: `${unassigned.length} line(s), ${R(unassignedC)} sitting in General Sales — assign or add vendor rules in the cost inbox.` },
  );

  // 8 — Conversion-era accounts taking new transactions.
  const convo = await q(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount_c), 0) AS c FROM cost_lines WHERE gl_code IN ('TEMP/ACC', '806', '-6', '17015970') AND txn_date >= date('now', '-45 day')",
  );
  checks.push(
    Number(convo[0]?.n ?? 0) === 0
      ? { group: GROUP, name: "Conversion accounts", status: "ok", detail: "No new activity on conversion-era accounts." }
      : { group: GROUP, name: "Conversion accounts", status: "fail", detail: `${convo[0].n} new line(s), ${R(Number(convo[0].c))} on conversion accounts in the last 45 days — these must be re-coded in Xero.` },
  );

  // 9 — Doc reconcile (E8): what the last sync removed, and lost overrides.
  const lastRec = await db.prepare("SELECT value FROM app_meta WHERE key = 'billing_stale_removed_last'").first<{ value: string }>();
  const orphRaw = await db.prepare("SELECT value FROM app_meta WHERE key = 'billing_orphan_overrides'").first<{ value: string }>();
  let orphCount = 0;
  try { orphCount = orphRaw ? JSON.parse(orphRaw.value).length : 0; } catch { orphCount = 0; }
  if (lastRec) {
    try {
      const rec = JSON.parse(lastRec.value) as { at: string; rows: number; centsByMonth: Record<string, number>; carried: number; orphans: number };
      const cents = Object.values(rec.centsByMonth ?? {}).reduce((a, b) => a + b, 0);
      checks.push({
        group: GROUP,
        name: "Doc reconcile (E8)",
        status: orphCount > 0 ? "warn" : "ok",
        detail: `Last sync removed ${rec.rows} stale line(s) (${R(cents)}), carried ${rec.carried} manual allocation(s).${orphCount ? ` ${orphCount} orphaned override(s) need redoing — see billing_orphan_overrides.` : ""}`,
      });
    } catch { /* unreadable meta — skip */ }
  } else {
    checks.push({ group: GROUP, name: "Doc reconcile (E8)", status: "warn", detail: "No reconcile has run yet — run a sync (or the full resync below)." });
  }

  // 10 — Month-close progress: elapsed FY months should end up locked.
  const closed = await q(`SELECT COUNT(*) AS n FROM billing_periods WHERE status = 'closed' AND period IN (${marks})`, ...months);
  const elapsed = months.length - 1; // current month stays open
  const nClosed = Number(closed[0]?.n ?? 0);
  checks.push(
    nClosed >= elapsed
      ? { group: GROUP, name: "Month close", status: "ok", detail: `All ${elapsed} elapsed month(s) are closed and snapshotted.` }
      : { group: GROUP, name: "Month close", status: elapsed - nClosed >= 3 ? "warn" : "ok", detail: `${nClosed} of ${elapsed} elapsed month(s) closed — close in order on the Month-end page to lock snapshots against journal drift.` },
  );

  return checks;
}
