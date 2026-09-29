import type { XeroProject, XeroProjectTask } from "../lib/xero";

export type ProjectSnapshot = { project_id: string; month: string; charge: number; invoiced: number };

export async function replaceProjects(db: D1Database, projects: XeroProject[]): Promise<void> {
  await db.prepare("DELETE FROM xero_projects").run();
  const stmt = db.prepare(
    "INSERT INTO xero_projects (id, name, status, currency, estimate, minutes_logged, task_amount, expense_amount, invoiced, to_be_invoiced, deposit, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
  );
  for (let i = 0; i < projects.length; i += 40) {
    const chunk = projects.slice(i, i + 40).map((p) =>
      stmt.bind(p.id, p.name, p.status, p.currency, p.estimate, p.minutes_logged, p.task_amount, p.expense_amount, p.invoiced, p.to_be_invoiced, p.deposit),
    );
    if (chunk.length) await db.batch(chunk);
  }
}

export async function replaceProjectTasks(db: D1Database, tasks: XeroProjectTask[]): Promise<void> {
  await db.prepare("DELETE FROM xero_project_tasks").run();
  const stmt = db.prepare(
    "INSERT INTO xero_project_tasks (id, project_id, name, charge_type, rate, minutes, amount, amount_invoiced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (let i = 0; i < tasks.length; i += 40) {
    const chunk = tasks.slice(i, i + 40).map((t) => stmt.bind(t.id, t.project_id, t.name, t.charge_type, t.rate, t.minutes, t.amount, t.amount_invoiced));
    if (chunk.length) await db.batch(chunk);
  }
}

/** Record this month's cumulative totals — deltas between months build the monthly view. */
export async function upsertProjectSnapshots(db: D1Database, projects: XeroProject[], month: string): Promise<void> {
  const stmt = db.prepare(
    "INSERT INTO xero_project_snapshots (project_id, month, charge, invoiced) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(project_id, month) DO UPDATE SET charge=excluded.charge, invoiced=excluded.invoiced",
  );
  for (let i = 0; i < projects.length; i += 40) {
    const chunk = projects.slice(i, i + 40).map((p) => stmt.bind(p.id, month, p.task_amount + p.expense_amount, p.invoiced));
    if (chunk.length) await db.batch(chunk);
  }
}

export async function listProjects(db: D1Database): Promise<XeroProject[]> {
  const { results } = await db
    .prepare("SELECT id, name, status, currency, estimate, minutes_logged, task_amount, expense_amount, invoiced, to_be_invoiced, deposit FROM xero_projects ORDER BY (status != 'INPROGRESS'), name")
    .all<XeroProject>();
  return results ?? [];
}

export async function listProjectTasks(db: D1Database, projectId: string): Promise<XeroProjectTask[]> {
  const { results } = await db
    .prepare("SELECT id, project_id, name, charge_type, rate, minutes, amount, amount_invoiced FROM xero_project_tasks WHERE project_id = ? ORDER BY amount DESC")
    .bind(projectId)
    .all<XeroProjectTask>();
  return results ?? [];
}

export async function listProjectSnapshots(db: D1Database, projectId: string): Promise<ProjectSnapshot[]> {
  const { results } = await db
    .prepare("SELECT project_id, month, charge, invoiced FROM xero_project_snapshots WHERE project_id = ? ORDER BY month")
    .bind(projectId)
    .all<ProjectSnapshot>();
  return results ?? [];
}

export async function listTasksForProjects(db: D1Database, ids: string[]): Promise<XeroProjectTask[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id, project_id, name, charge_type, rate, minutes, amount, amount_invoiced FROM xero_project_tasks WHERE project_id IN (${marks}) ORDER BY amount DESC`)
    .bind(...ids)
    .all<XeroProjectTask>();
  return results ?? [];
}

/** Snapshots summed across a set of projects (a same-name group), by month. */
export async function listSnapshotsForProjects(db: D1Database, ids: string[]): Promise<ProjectSnapshot[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT 'group' AS project_id, month, SUM(charge) AS charge, SUM(invoiced) AS invoiced FROM xero_project_snapshots WHERE project_id IN (${marks}) GROUP BY month ORDER BY month`)
    .bind(...ids)
    .all<ProjectSnapshot>();
  return results ?? [];
}
