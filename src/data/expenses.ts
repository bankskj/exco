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
  freq_locked: number;
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
      "SELECT id, name, vendor, category, amount, frequency, interval_months, next_date, active, notes, source, xero_id, currency, freq_locked " +
        "FROM recurring_expenses ORDER BY active DESC, name COLLATE NOCASE ASC",
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

/** Manually set a row's frequency; locks it against sync overwrites. */
export async function setExpenseFrequency(db: D1Database, id: string, frequency: string, intervalMonths: number): Promise<void> {
  await db
    .prepare("UPDATE recurring_expenses SET frequency=?, interval_months=?, freq_locked=1, updated_at=datetime('now') WHERE id=?")
    .bind(frequency, intervalMonths, id)
    .run();
}

export async function toggleExpense(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE recurring_expenses SET active = 1 - active, updated_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function deleteExpense(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM recurring_expenses WHERE id = ?").bind(id).run();
}

// ---- vendor rules ----------------------------------------------------------

export type VendorRule = { vendor_key: string; name: string; rule: "track" | "exclude"; reason: string | null };

export async function listVendorRules(db: D1Database): Promise<Map<string, VendorRule>> {
  const { results } = await db.prepare("SELECT vendor_key, name, rule, reason FROM vendor_rules").all<VendorRule>();
  return new Map((results ?? []).map((r) => [r.vendor_key, r]));
}

export async function setVendorRule(db: D1Database, key: string, name: string, rule: "track" | "exclude", reason: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO vendor_rules (vendor_key, name, rule, reason) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(vendor_key) DO UPDATE SET name = excluded.name, rule = excluded.rule, reason = excluded.reason",
    )
    .bind(key, name, rule, reason)
    .run();
}

export async function clearVendorRule(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM vendor_rules WHERE vendor_key = ?").bind(key).run();
}

/** Remove a synced expense row by its Xero upsert key. */
export async function deleteExpenseByXeroId(db: D1Database, xeroId: string): Promise<void> {
  await db.prepare("DELETE FROM recurring_expenses WHERE xero_id = ?").bind(xeroId).run();
}

// ---- vendor bill history ---------------------------------------------------

export type VendorBill = { vendor_key: string; vendor_name: string; bill_date: string; amount: number; reference: string | null };

/** Replace the stored bill history (called on each sync). */
export async function replaceVendorBills(db: D1Database, bills: (VendorBill & { id?: string })[]): Promise<void> {
  await db.prepare("DELETE FROM vendor_bills").run();
  const stmt = db.prepare("INSERT INTO vendor_bills (id, vendor_key, vendor_name, bill_date, amount, reference) VALUES (?, ?, ?, ?, ?, ?)");
  // batch in chunks to stay well under statement limits
  for (let i = 0; i < bills.length; i += 50) {
    const chunk = bills.slice(i, i + 50).map((b) => stmt.bind(uuid(), b.vendor_key, b.vendor_name, b.bill_date, b.amount, b.reference));
    if (chunk.length) await db.batch(chunk);
  }
}

/** Every stored bill (last sync window), oldest sync range, for the monthly log. */
export async function listAllVendorBills(db: D1Database): Promise<VendorBill[]> {
  const { results } = await db
    .prepare("SELECT vendor_key, vendor_name, bill_date, amount, reference FROM vendor_bills ORDER BY bill_date DESC")
    .all<VendorBill>();
  return results ?? [];
}

export async function listVendorBills(db: D1Database, vendorKey: string): Promise<VendorBill[]> {
  const { results } = await db
    .prepare("SELECT vendor_key, vendor_name, bill_date, amount, reference FROM vendor_bills WHERE vendor_key = ? ORDER BY bill_date DESC")
    .bind(vendorKey)
    .all<VendorBill>();
  return results ?? [];
}

export type BillingPattern = { label: "mid-month" | "month-end"; day: number };

/**
 * Typical billing day per vendor from stored history. Median day-of-month;
 * days 10-20 count as mid-month, anything else as month-end.
 */
export async function billingPatterns(db: D1Database): Promise<Map<string, BillingPattern>> {
  const { results } = await db.prepare("SELECT vendor_key, bill_date FROM vendor_bills").all<{ vendor_key: string; bill_date: string }>();
  const days = new Map<string, number[]>();
  for (const r of results ?? []) {
    const d = Number(r.bill_date.slice(8, 10));
    if (!Number.isFinite(d)) continue;
    if (!days.has(r.vendor_key)) days.set(r.vendor_key, []);
    days.get(r.vendor_key)!.push(d);
  }
  const out = new Map<string, BillingPattern>();
  for (const [key, list] of days) {
    list.sort((a, b) => a - b);
    const day = list[Math.floor(list.length / 2)];
    out.set(key, { label: day >= 10 && day <= 20 ? "mid-month" : "month-end", day });
  }
  return out;
}

/** Upsert Xero repeating bills by xero_id. Returns [inserted, updated]. */
export async function upsertXeroExpenses(db: D1Database, bills: XeroRepeatingBill[]): Promise<[number, number]> {
  let ins = 0;
  let upd = 0;
  for (const b of bills) {
    const existing = await db
      .prepare("SELECT id, freq_locked FROM recurring_expenses WHERE xero_id = ?")
      .bind(b.xero_id)
      .first<{ id: string; freq_locked: number }>();
    if (existing) {
      if (existing.freq_locked) continue; // user set the frequency manually — leave the row alone
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
