import { uuid } from "./db";
import type { XeroRepeatingBill } from "../lib/xero";

export type RecurringExpense = {
  id: string;
  name: string;
  vendor: string | null;
  category: string | null;
  amount: number;
  frequency: string;
  interval_months: number;
  next_date: string | null;
  active: number;
  notes: string | null;
  source: "manual" | "xero";
  xero_id: string | null;
  currency: string;
};

export const FREQUENCIES: { key: string; label: string; months: number }[] = [
  { key: "weekly", label: "Weekly", months: 12 / 52 },
  { key: "monthly", label: "Monthly", months: 1 },
  { key: "quarterly", label: "Quarterly", months: 3 },
  { key: "biannual", label: "Every 6 months", months: 6 },
  { key: "annual", label: "Annual", months: 12 },
];

export const monthlyEquivalent = (e: { amount: number; interval_months: number }): number =>
  e.interval_months > 0 ? e.amount / e.interval_months : e.amount;

export async function listExpenses(db: D1Database): Promise<RecurringExpense[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, vendor, category, amount, frequency, interval_months, next_date, active, notes, source, xero_id, currency " +
        "FROM recurring_expenses ORDER BY active DESC, (amount / interval_months) DESC",
    )
    .all<RecurringExpense>();
  return results ?? [];
}

export async function createExpense(
  db: D1Database,
  e: {
    name: string;
    vendor?: string | null;
    category?: string | null;
    amount: number;
    frequency: string;
    interval_months: number;
    next_date?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  const id = uuid();
  await db
    .prepare(
      "INSERT INTO recurring_expenses (id, name, vendor, category, amount, frequency, interval_months, next_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, e.name, e.vendor ?? null, e.category ?? null, e.amount, e.frequency, e.interval_months, e.next_date ?? null, e.notes ?? null)
    .run();
  return id;
}

export async function toggleExpense(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE recurring_expenses SET active = 1 - active, updated_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function deleteExpense(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM recurring_expenses WHERE id = ?").bind(id).run();
}

/** Upsert Xero repeating bills by xero_id. Returns [inserted, updated]. */
export async function upsertXeroExpenses(db: D1Database, bills: XeroRepeatingBill[]): Promise<[number, number]> {
  let ins = 0;
  let upd = 0;
  for (const b of bills) {
    const existing = await db
      .prepare("SELECT id FROM recurring_expenses WHERE xero_id = ?")
      .bind(b.xero_id)
      .first<{ id: string }>();
    if (existing) {
      await db
        .prepare(
          "UPDATE recurring_expenses SET name=?, vendor=?, amount=?, frequency=?, interval_months=?, next_date=?, currency=?, updated_at=datetime('now') WHERE id=?",
        )
        .bind(b.name, b.vendor, b.amount, b.frequency, b.interval_months, b.next_date, b.currency, existing.id)
        .run();
      upd++;
    } else {
      await db
        .prepare(
          "INSERT INTO recurring_expenses (id, name, vendor, amount, frequency, interval_months, next_date, source, xero_id, currency) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'xero', ?, ?)",
        )
        .bind(uuid(), b.name, b.vendor, b.amount, b.frequency, b.interval_months, b.next_date, b.xero_id, b.currency)
        .run();
      ins++;
    }
  }
  return [ins, upd];
}
