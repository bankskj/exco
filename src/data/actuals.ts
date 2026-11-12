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
    "INSERT OR REPLACE INTO xero_txns (id, kind, txn_date, due_date, paid_on, payments, contact, reference, sub_total, total, amount_due, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
  );
  // D1 batch limit safety: chunks of 50 statements.
  for (let i = 0; i < txns.length; i += 50) {
    await db.batch(txns.slice(i, i + 50).map((t) => stmt.bind(t.id, t.kind, t.date, t.dueDate, t.paidOn, t.payments.length ? JSON.stringify(t.payments) : null, t.contact, t.reference, t.subTotal, t.total, t.amountDue, t.status)));
  }
}

export async function listXeroTxns(db: D1Database): Promise<ActualTxn[]> {
  const { results } = await db
    .prepare("SELECT id, kind, txn_date, contact, reference, sub_total, total, amount_due, status FROM xero_txns ORDER BY txn_date DESC, contact")
    .all<ActualTxn>();
  return results ?? [];
}

export type OpenSale = { id: string; contact: string; reference: string | null; txn_date: string; due_date: string | null; sub_total: number; total: number; amount_due: number };

/** Unpaid approved sales invoices — money customers already owe us. */
export async function listOpenSales(db: D1Database): Promise<OpenSale[]> {
  const { results } = await db
    .prepare("SELECT id, contact, reference, txn_date, due_date, sub_total, total, amount_due FROM xero_txns WHERE kind = 'sale' AND status = 'AUTHORISED' AND amount_due > 0 ORDER BY COALESCE(due_date, txn_date)")
    .all<OpenSale>();
  return results ?? [];
}

/**
 * Open invoices by expected payment month, excl VAT (the outstanding share of
 * the invoice's ex-VAT value). Overdue — or missing a due date — lands in the
 * current month: it is owed now.
 */
export function openSalesByMonth(rows: OpenSale[], currentMonth: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const due = (r.due_date ?? r.txn_date).slice(0, 7);
    const month = due < currentMonth ? currentMonth : due;
    const excl = r.total ? r.amount_due * (r.sub_total / r.total) : r.amount_due;
    out.set(month, (out.get(month) ?? 0) + excl);
  }
  return out;
}

/**
 * Cash received on sales invoices in `month` (excl VAT): dated payments when
 * Xero returned them, else the paid amount of invoices fully paid that month.
 * Counts the part of a not-yet-closed month that has already happened.
 */
export async function salesReceivedInMonth(db: D1Database, month: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT sub_total, total, amount_due, paid_on, payments FROM xero_txns WHERE kind = 'sale' AND status IN ('AUTHORISED','PAID') AND (paid_on LIKE ? OR payments LIKE ?)")
    .bind(`${month}%`, `%"${month}-%`)
    .all<{ sub_total: number; total: number; amount_due: number; paid_on: string | null; payments: string | null }>();
  let sum = 0;
  for (const r of results ?? []) {
    const exclRatio = r.total ? r.sub_total / r.total : 1;
    let paid = 0;
    const list: { date: string; amount: number }[] = r.payments ? (() => { try { return JSON.parse(r.payments!); } catch { return []; } })() : [];
    if (list.length) paid = list.filter((p) => p.date.startsWith(month)).reduce((t, p) => t + p.amount, 0);
    else if (r.paid_on?.startsWith(month)) paid = r.total - r.amount_due;
    sum += paid * exclRatio;
  }
  return sum;
}

export type SaleForMatch = { contact: string; reference: string | null; txn_date: string; due_date: string | null; status: string; amount_due: number };

/** Approved sales invoices (open or paid) with their due dates. */
export async function listSalesForMatching(db: D1Database): Promise<SaleForMatch[]> {
  const { results } = await db
    .prepare("SELECT contact, reference, txn_date, due_date, status, amount_due FROM xero_txns WHERE kind = 'sale' AND status IN ('AUTHORISED','PAID')")
    .all<SaleForMatch>();
  return results ?? [];
}

/**
 * The customer key of a manual forecast row: the text before " - "
 * ("Illovo - AMS" → "illovo"). Null when too short or generic to match safely.
 */
export function rowCustomerKey(name: string): string | null {
  const key = name.split(" - ")[0].trim().toLowerCase();
  if (key.length < 4 || /^(other|income|misc|sundry|general|interest)\b/.test(key)) return null;
  return key;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Manual income rows replaced by real invoices: for each row whose customer
 * key starts a Xero contact name, the months where that customer has an
 * invoice landing (open → its due month, overdue → current month; paid → its
 * due month). The typed value is ignored there — the invoice counts instead.
 * Returns rowId → month → invoice reference.
 */
export function invoiceReplacements(
  rows: { id: string; name: string; values: Map<string, number> }[],
  sales: SaleForMatch[],
  currentMonth: string,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const key = rowCustomerKey(row.name);
    if (!key || row.values.size === 0) continue;
    const re = new RegExp(`^${escRe(key)}(\\b|$)`, "i");
    for (const s of sales) {
      if (!re.test(s.contact.trim())) continue;
      const due = (s.due_date ?? s.txn_date).slice(0, 7);
      const month = s.status === "AUTHORISED" && s.amount_due > 0 && due < currentMonth ? currentMonth : due;
      if (!row.values.has(month)) continue;
      if (!out.has(row.id)) out.set(row.id, new Map());
      out.get(row.id)!.set(month, s.reference ?? "invoice");
    }
  }
  return out;
}

export type VendorSpendTotal = { contact: string; excl: number; incl: number; vat: number };

/** Spend per vendor (bills + spend money) in a window — VAT = incl − excl. */
export async function vendorSpendTotals(db: D1Database, start: string | null, end: string | null): Promise<Map<string, VendorSpendTotal>> {
  const where = ["kind IN ('bill','spend')"];
  const binds: string[] = [];
  if (start) {
    where.push("txn_date >= ?");
    binds.push(start);
  }
  if (end) {
    where.push("txn_date <= ?");
    binds.push(end);
  }
  const { results } = await db
    .prepare(`SELECT contact, SUM(sub_total) AS excl, SUM(total) AS incl FROM xero_txns WHERE ${where.join(" AND ")} GROUP BY contact`)
    .bind(...binds)
    .all<{ contact: string; excl: number; incl: number }>();
  const map = new Map<string, VendorSpendTotal>();
  for (const r of results ?? []) {
    map.set(r.contact.trim().toLowerCase(), { contact: r.contact, excl: r.excl, incl: r.incl, vat: r.incl - r.excl });
  }
  return map;
}
