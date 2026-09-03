import { uuid } from "./db";

export type EmployeeType = "za" | "international" | "freelancer";
export const EMPLOYEE_TYPES: EmployeeType[] = ["za", "international", "freelancer"];
export const TYPE_LABEL: Record<EmployeeType, string> = {
  za: "ZA (PAYE)",
  international: "International",
  freelancer: "Freelancer",
};
export const hasPaye = (t: string): boolean => t === "za";

export type Employee = {
  id: string;
  name: string;
  mentor: string | null;
  ctc: number | null;
  paye_default: number;
  type: EmployeeType;
  status: "active" | "inactive";
  inactive_date: string | null; // set when status flips to inactive
  sort_order: number;
};

export type PayrollEntry = {
  id: string;
  employee_id: string;
  period: string;
  gross: number;
  paye: number;
};

export async function listEmployees(db: D1Database): Promise<Employee[]> {
  const { results } = await db
    .prepare("SELECT id, name, mentor, ctc, paye_default, type, status, inactive_date, sort_order FROM employees ORDER BY sort_order, name")
    .all<Employee>();
  return results ?? [];
}

export async function createEmployee(
  db: D1Database,
  e: { name: string; mentor?: string | null; ctc?: number | null; paye_default?: number; type?: string; status?: string },
): Promise<string> {
  const id = uuid();
  const order = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM employees").first<{ n: number }>();
  const type = e.type ?? "za";
  await db
    .prepare("INSERT INTO employees (id, name, mentor, ctc, paye_default, type, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, e.name, e.mentor ?? null, e.ctc ?? null, hasPaye(type) ? e.paye_default ?? 0 : 0, type, e.status ?? "active", order?.n ?? 0)
    .run();
  return id;
}

export async function updateEmployee(
  db: D1Database,
  id: string,
  e: { name: string; mentor?: string | null; ctc?: number | null; paye_default?: number; type?: string; status?: string; inactive_date?: string | null },
): Promise<void> {
  const type = e.type ?? "za";
  await db
    .prepare("UPDATE employees SET name=?, mentor=?, ctc=?, paye_default=?, type=?, status=?, inactive_date=?, updated_at=datetime('now') WHERE id=?")
    .bind(e.name, e.mentor ?? null, e.ctc ?? null, hasPaye(type) ? e.paye_default ?? 0 : 0, type, e.status ?? "active", e.inactive_date ?? null, id)
    .run();
  if (!hasPaye(type)) {
    // International / freelancer never have PAYE — clear any stored monthly tax.
    await db.prepare("UPDATE payroll_entries SET paye=0 WHERE employee_id=?").bind(id).run();
  }
}

/** Remove captured months after an employee's inactive month. */
export async function pruneEntriesAfter(db: D1Database, employeeId: string, lastMonth: string): Promise<void> {
  await db.prepare("DELETE FROM payroll_entries WHERE employee_id = ? AND period > ?").bind(employeeId, lastMonth).run();
}

/**
 * Fill monthly PAYE from each ZA employee's default, for the given periods —
 * only where the month was paid (gross > 0) and PAYE hasn't been captured yet.
 */
export async function fillPayeFromDefaults(db: D1Database, periods: string[]): Promise<number> {
  if (periods.length === 0) return 0;
  const marks = periods.map(() => "?").join(",");
  const res = await db
    .prepare(
      `UPDATE payroll_entries SET paye = (SELECT paye_default FROM employees e WHERE e.id = employee_id), updated_at = datetime('now')
       WHERE paye = 0 AND gross > 0 AND period IN (${marks})
         AND employee_id IN (SELECT id FROM employees WHERE type = 'za' AND paye_default > 0)`,
    )
    .bind(...periods)
    .run();
  return res.meta.changes ?? 0;
}

/** Change only an employee's type (used by the quick type selector). */
export async function setEmployeeType(db: D1Database, id: string, type: string): Promise<void> {
  await db.prepare("UPDATE employees SET type=?, updated_at=datetime('now') WHERE id=?").bind(type, id).run();
  if (type !== "za") {
    // International / freelancer never have PAYE — clear default and stored tax.
    await db.prepare("UPDATE employees SET paye_default=0 WHERE id=?").bind(id).run();
    await db.prepare("UPDATE payroll_entries SET paye=0 WHERE employee_id=?").bind(id).run();
  }
}

export async function deleteEmployee(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM employees WHERE id = ?").bind(id).run();
}

export async function listPayrollEntries(db: D1Database): Promise<PayrollEntry[]> {
  const { results } = await db
    .prepare("SELECT id, employee_id, period, gross, paye FROM payroll_entries")
    .all<PayrollEntry>();
  return results ?? [];
}

/**
 * Upsert one field (gross or paye) for (employee, period) without clobbering
 * the other field. Passing null clears that field. Rows that end up fully
 * zero are cleaned up by `pruneEmptyEntries`.
 */
export async function upsertPayrollField(
  db: D1Database,
  employeeId: string,
  period: string,
  field: "gross" | "paye",
  value: number | null,
): Promise<void> {
  const v = value ?? 0;
  const other = field === "gross" ? "paye" : "gross";
  await db
    .prepare(
      `INSERT INTO payroll_entries (id, employee_id, period, ${field}, ${other}, updated_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))
       ON CONFLICT(employee_id, period) DO UPDATE SET ${field} = excluded.${field}, updated_at = datetime('now')`,
    )
    .bind(uuid(), employeeId, period, v)
    .run();
}

/** Remove rows where both gross and paye are zero (kept the table tidy). */
export async function pruneEmptyEntries(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM payroll_entries WHERE gross = 0 AND paye = 0").run();
}
