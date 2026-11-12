// Xero repeating-invoice schedules (sales + bills), replaced on every refresh.

import type { XeroRepeatingSchedule } from "../lib/xero";

export async function replaceRepeatingSchedules(db: D1Database, rows: XeroRepeatingSchedule[]): Promise<void> {
  const stmts = [db.prepare("DELETE FROM xero_repeating")];
  for (const r of rows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO xero_repeating (xero_id, type, status, contact, reference, sub_total, total, currency, unit, period, next_date, end_date, due_day, due_type, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .bind(r.xero_id, r.type, r.status, r.contact, r.reference, r.sub_total, r.total, r.currency, r.unit, r.period, r.next_date, r.end_date, r.due_day, r.due_type),
    );
  }
  await db.batch(stmts); // one transaction: never a half-replaced table
}

export async function listRepeatingSchedules(db: D1Database): Promise<XeroRepeatingSchedule[]> {
  const { results } = await db
    .prepare("SELECT xero_id, type, status, contact, reference, sub_total, total, currency, unit, period, next_date, end_date, due_day, due_type FROM xero_repeating ORDER BY type, contact")
    .all<XeroRepeatingSchedule>();
  return results ?? [];
}
