import type { XeroTxn } from "../lib/xero";

export type ActualTxn = {
  id: string;
  kind: "sale" | "bill" | "spend";
  txn_date: string;
  contact: string;
  reference: string | null;
  sub_total: number;
  total: number;
  amount_due: number;
  status: string;
};

/** Replace the synced window wholesale — voided/edited docs disappear cleanly. */
export async function replaceXeroTxns(db: D1Database, since: string, txns: XeroTxn[]): Promise<void> {
  await db.prepare("DELETE FROM xero_txns WHERE txn_date >= ?").bind(since).run();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO xero_txns (id, kind, txn_date, contact, reference, sub_total, total, amount_due, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
  );
  // D1 batch limit safety: chunks of 50 statements.
  for (let i = 0; i < txns.length; i += 50) {
    await db.batch(txns.slice(i, i + 50).map((t) => stmt.bind(t.id, t.kind, t.date, t.contact, t.reference, t.subTotal, t.total, t.amountDue, t.status)));
  }
}

export async function listXeroTxns(db: D1Database): Promise<ActualTxn[]> {
  const { results } = await db
    .prepare("SELECT id, kind, txn_date, contact, reference, sub_total, total, amount_due, status FROM xero_txns ORDER BY txn_date DESC, contact")
    .all<ActualTxn>();
  return results ?? [];
}
