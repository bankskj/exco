// E8 — per-document line reconcile (docs/E8_Xero_Sync_Line_Reconcile_Spec.md).
//
// When a Xero document is edited, its LineItemIDs can be reissued: the sync's
// source_ref upsert then INSERTS the new lines while the old ones stay behind,
// double-counting the document. On every sync we therefore diff each fetched
// document's current rows against the refs actually written, carry manual
// data (cost splits, revenue project overrides) onto matching replacement
// lines, and delete the stale rows — never touching closed periods.

export type LedgerTable = "revenue_lines" | "cost_lines";

export type LedgerRow = {
  id: string;
  sourceRef: string | null;
  docId: string;
  period: string;
  glCode: string | null;
  amountC: number;
  /** revenue: manual project override; cost: whether manual splits exist. */
  projectId: string | null;
  hasSplits: boolean;
};

export type OrphanEntry = {
  table: LedgerTable;
  docId: string;
  period: string;
  glCode: string | null;
  amountC: number;
  lost: "splits" | "project override";
};

/**
 * Which current rows are stale: their document was fetched this sync but the
 * row's source_ref was not (re)written. Covers reissued LineItemIDs, removed
 * lines, dropped balance-sheet RECEIVE lines, and rows whose replacement was
 * skipped because its new period is closed (the skip keeps it out of `kept`).
 */
export function staleRows(current: LedgerRow[], kept: Map<string, Set<string>>): LedgerRow[] {
  return current.filter((r) => {
    const refs = kept.get(r.docId);
    if (!refs) return false; // document not part of this sync
    return r.sourceRef === null || !refs.has(r.sourceRef);
  });
}

/**
 * Replacement matching (spec 2d): for each stale row that carries manual data,
 * find the ONE kept row in the same document with the same gl_code and
 * amount_c. Ambiguous or missing matches return no entry — the caller logs
 * them as orphans instead of guessing.
 */
export function matchReplacements(
  stale: LedgerRow[],
  keptRowsByDoc: Map<string, LedgerRow[]>,
): Map<string, LedgerRow> {
  const out = new Map<string, LedgerRow>();
  for (const s of stale) {
    if (!s.hasSplits && s.projectId === null) continue; // nothing to carry
    const candidates = (keptRowsByDoc.get(s.docId) ?? []).filter(
      (k) => k.glCode === s.glCode && k.amountC === s.amountC && k.id !== s.id,
    );
    if (candidates.length === 1) out.set(s.id, candidates[0]);
  }
  return out;
}

export type ReconcileResult = {
  removed: number;
  removedCentsByMonth: Map<string, number>;
  carried: number;
  orphans: OrphanEntry[];
  closedSkipped: Map<string, number>; // closed period -> stale rows left in place
};

const CHUNK = 80; // D1 allows 100 bound parameters; stay well under

/**
 * Reconcile one ledger table against this sync's fetched documents.
 * `seenDocIds` — every document the fetch returned (even ones whose lines were
 * all dropped); `kept` — per doc, the source_refs actually written to THIS
 * table. In full-resync mode (`allFetchedDocIds` given), open-period rows of
 * documents the fetch didn't return at all are stale too (deleted in Xero
 * without ever reporting DELETED).
 */
export async function reconcileTable(
  db: D1Database,
  table: LedgerTable,
  seenDocIds: Set<string>,
  kept: Map<string, Set<string>>,
  closed: Set<string>,
  allFetchedDocIds: Set<string> | null = null,
): Promise<ReconcileResult> {
  const res: ReconcileResult = { removed: 0, removedCentsByMonth: new Map(), carried: 0, orphans: [], closedSkipped: new Map() };
  const isCost = table === "cost_lines";

  // Full mode: documents in the DB that the full fetch never returned.
  let ghostDocIds: string[] = [];
  if (allFetchedDocIds) {
    const { results } = await db
      .prepare(`SELECT DISTINCT xero_doc_id AS d FROM ${table} WHERE source = 'xero' AND xero_doc_id IS NOT NULL`)
      .all<{ d: string }>();
    ghostDocIds = (results ?? []).map((r) => r.d).filter((d) => !allFetchedDocIds.has(d) && !seenDocIds.has(d));
  }

  const docIds = [...new Set([...seenDocIds, ...ghostDocIds])];
  const selectCols = isCost
    ? "id, source_ref, xero_doc_id, period, gl_code, amount_c, NULL AS project_id"
    : "id, source_ref, xero_doc_id, period, gl_code, amount_c, project_id";

  for (let i = 0; i < docIds.length; i += CHUNK) {
    const chunk = docIds.slice(i, i + CHUNK);
    const marks = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT ${selectCols} FROM ${table} WHERE source = 'xero' AND xero_doc_id IN (${marks})`)
      .bind(...chunk)
      .all<any>();
    const rows: LedgerRow[] = (results ?? []).map((r) => ({
      id: String(r.id),
      sourceRef: r.source_ref ?? null,
      docId: String(r.xero_doc_id),
      period: String(r.period),
      glCode: r.gl_code ?? null,
      amountC: Number(r.amount_c),
      projectId: r.project_id ?? null,
      hasSplits: false,
    }));
    if (isCost && rows.length) {
      for (let j = 0; j < rows.length; j += CHUNK) {
        const ids = rows.slice(j, j + CHUNK).map((r) => r.id);
        const m2 = ids.map(() => "?").join(",");
        const { results: sp } = await db
          .prepare(`SELECT DISTINCT cost_line_id AS c FROM cost_splits WHERE cost_line_id IN (${m2})`)
          .bind(...ids)
          .all<{ c: string }>();
        const withSplits = new Set((sp ?? []).map((r) => String(r.c)));
        for (const r of rows) if (withSplits.has(r.id)) r.hasSplits = true;
      }
    }

    // Ghost docs: every open-period row is stale (no kept set exists for them).
    const ghostSet = new Set(ghostDocIds);
    const stale = [
      ...staleRows(rows.filter((r) => !ghostSet.has(r.docId)), kept),
      ...rows.filter((r) => ghostSet.has(r.docId)),
    ];
    if (!stale.length) continue;

    const keptRowsByDoc = new Map<string, LedgerRow[]>();
    for (const r of rows) {
      if (kept.get(r.docId)?.has(r.sourceRef ?? "")) {
        const list = keptRowsByDoc.get(r.docId) ?? [];
        list.push(r);
        keptRowsByDoc.set(r.docId, list);
      }
    }
    const repl = matchReplacements(stale, keptRowsByDoc);

    const stmts: D1PreparedStatement[] = [];
    for (const s of stale) {
      if (closed.has(s.period)) {
        res.closedSkipped.set(s.period, (res.closedSkipped.get(s.period) ?? 0) + 1);
        continue;
      }
      const target = repl.get(s.id);
      if (s.hasSplits) {
        if (target && !target.hasSplits) {
          stmts.push(db.prepare("UPDATE cost_splits SET cost_line_id = ? WHERE cost_line_id = ?").bind(target.id, s.id));
          target.hasSplits = true;
          res.carried++;
        } else {
          stmts.push(db.prepare("DELETE FROM cost_splits WHERE cost_line_id = ?").bind(s.id));
          res.orphans.push({ table, docId: s.docId, period: s.period, glCode: s.glCode, amountC: s.amountC, lost: "splits" });
        }
      }
      if (!isCost && s.projectId !== null) {
        if (target && target.projectId === null) {
          stmts.push(db.prepare(`UPDATE ${table} SET project_id = ? WHERE id = ? AND project_id IS NULL`).bind(s.projectId, target.id));
          target.projectId = s.projectId;
          res.carried++;
        } else {
          res.orphans.push({ table, docId: s.docId, period: s.period, glCode: s.glCode, amountC: s.amountC, lost: "project override" });
        }
      }
      stmts.push(db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(s.id));
      res.removed++;
      res.removedCentsByMonth.set(s.period, (res.removedCentsByMonth.get(s.period) ?? 0) + s.amountC);
    }
    for (let j = 0; j < stmts.length; j += 40) await db.batch(stmts.slice(j, j + 40));
  }
  return res;
}
