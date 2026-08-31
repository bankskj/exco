import { uuid, getAllMeta, setMeta } from "./db";
import type { CFCategory, CFEntry, CFSettings } from "../lib/forecast";

export async function listCategories(db: D1Database): Promise<CFCategory[]> {
  const { results } = await db
    .prepare("SELECT id, name, kind, grp, is_recurring, sort_order FROM cf_categories WHERE active = 1 ORDER BY sort_order, name")
    .all<CFCategory>();
  return results ?? [];
}

export async function getCategory(db: D1Database, id: string): Promise<CFCategory | null> {
  return db
    .prepare("SELECT id, name, kind, grp, is_recurring, sort_order FROM cf_categories WHERE id = ?")
    .bind(id)
    .first<CFCategory>();
}

export async function createCategory(
  db: D1Database,
  c: { name: string; kind: string; grp?: string | null; is_recurring?: boolean },
): Promise<string> {
  const id = uuid();
  const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM cf_categories").first<{ n: number }>();
  await db
    .prepare("INSERT INTO cf_categories (id, name, kind, grp, is_recurring, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, c.name, c.kind, c.grp ?? null, c.is_recurring ? 1 : 0, order?.n ?? 0)
    .run();
  return id;
}

export async function updateCategory(
  db: D1Database,
  id: string,
  c: { name: string; kind: string; grp?: string | null; is_recurring?: boolean },
): Promise<void> {
  await db
    .prepare("UPDATE cf_categories SET name = ?, kind = ?, grp = ?, is_recurring = ? WHERE id = ?")
    .bind(c.name, c.kind, c.grp ?? null, c.is_recurring ? 1 : 0, id)
    .run();
}

export async function deleteCategory(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM cf_categories WHERE id = ?").bind(id).run();
}

export async function listEntries(db: D1Database): Promise<CFEntry[]> {
  const { results } = await db
    .prepare("SELECT category_id, period, amount, status FROM cf_entries")
    .all<CFEntry>();
  return results ?? [];
}

export async function upsertEntry(
  db: D1Database,
  categoryId: string,
  period: string,
  amount: number | null,
  status: "actual" | "forecast",
  note?: string | null,
): Promise<void> {
  if (amount == null) {
    await db.prepare("DELETE FROM cf_entries WHERE category_id = ? AND period = ?").bind(categoryId, period).run();
    return;
  }
  await db
    .prepare(
      "INSERT INTO cf_entries (id, category_id, period, amount, status, note, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, datetime('now')) " +
        "ON CONFLICT(category_id, period) DO UPDATE SET amount = excluded.amount, status = excluded.status, note = excluded.note, updated_at = datetime('now')",
    )
    .bind(uuid(), categoryId, period, amount, status, note ?? null)
    .run();
}

const num = (v: string | undefined, d: number) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export async function getSettings(db: D1Database): Promise<CFSettings> {
  const m = await getAllMeta(db);
  return {
    opening_balance: num(m.cf_opening_balance, 0),
    opening_period: m.cf_opening_period || "2025-03",
    actuals_through: m.cf_actuals_through || m.cf_opening_period || "2025-03",
    horizon_months: num(m.cf_horizon_months, 12),
    best_income_pct: num(m.cf_best_income_pct, 10),
    best_cost_pct: num(m.cf_best_cost_pct, 5),
    worst_income_pct: num(m.cf_worst_income_pct, 15),
    worst_cost_pct: num(m.cf_worst_cost_pct, 10),
  };
}

export async function saveSettings(db: D1Database, s: CFSettings): Promise<void> {
  const pairs: [string, string][] = [
    ["cf_opening_balance", String(s.opening_balance)],
    ["cf_opening_period", s.opening_period],
    ["cf_actuals_through", s.actuals_through],
    ["cf_horizon_months", String(s.horizon_months)],
    ["cf_best_income_pct", String(s.best_income_pct)],
    ["cf_best_cost_pct", String(s.best_cost_pct)],
    ["cf_worst_income_pct", String(s.worst_income_pct)],
    ["cf_worst_cost_pct", String(s.worst_cost_pct)],
  ];
  for (const [k, v] of pairs) await setMeta(db, k, v);
}

// ---- P&L-derived monthly actuals (populated by the Xero sync) --------------

export type CfActual = { month: string; income: number; staff: number; dev: number; other: number };

export async function upsertCfActuals(db: D1Database, rows: CfActual[]): Promise<void> {
  const stmt = db.prepare(
    "INSERT INTO cf_actuals (month, income, staff, dev, other, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(month) DO UPDATE SET income=excluded.income, staff=excluded.staff, dev=excluded.dev, other=excluded.other, updated_at=datetime('now')",
  );
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50).map((r) => stmt.bind(r.month, r.income, r.staff, r.dev, r.other));
    if (chunk.length) await db.batch(chunk);
  }
}

export async function listCfActuals(db: D1Database): Promise<Map<string, CfActual>> {
  const { results } = await db.prepare("SELECT month, income, staff, dev, other FROM cf_actuals").all<CfActual>();
  return new Map((results ?? []).map((r) => [r.month, r]));
}
