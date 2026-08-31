import { uuid } from "./db";

export type HrEmployee = {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  team: string | null;
  manager: string | null;
  employee_no: string | null;
  start_date: string | null;
  end_date: string | null;
};

export const NOTE_KINDS = ["note", "achievement", "verbal_warning", "written_warning", "change", "contract"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const KIND_LABEL: Record<NoteKind, string> = {
  note: "Note",
  achievement: "Achievement",
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  change: "Change",
  contract: "Contract",
};

export type HrNote = {
  id: string;
  employee_id: string;
  kind: NoteKind;
  title: string;
  body: string | null;
  note_date: string | null;
  created_at: string;
};

export type HrDocument = {
  id: string;
  r2_key: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  ref_id: string | null; // note id
};

export async function listHrEmployees(db: D1Database): Promise<HrEmployee[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, email, position, team, manager, employee_no, start_date, end_date FROM hr_employees ORDER BY (end_date IS NOT NULL), name",
    )
    .all<HrEmployee>();
  return results ?? [];
}

export async function getHrEmployee(db: D1Database, id: string): Promise<HrEmployee | null> {
  return db
    .prepare("SELECT id, name, email, position, team, manager, employee_no, start_date, end_date FROM hr_employees WHERE id = ?")
    .bind(id)
    .first<HrEmployee>();
}

export async function createHrEmployee(db: D1Database, e: Partial<HrEmployee> & { name: string }): Promise<string> {
  const id = uuid();
  await db
    .prepare(
      "INSERT INTO hr_employees (id, name, email, position, team, manager, employee_no, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, e.name, e.email ?? null, e.position ?? null, e.team ?? null, e.manager ?? null, e.employee_no ?? null, e.start_date ?? null, e.end_date ?? null)
    .run();
  return id;
}

export async function updateHrEmployee(db: D1Database, id: string, e: Partial<HrEmployee> & { name: string }): Promise<void> {
  await db
    .prepare(
      "UPDATE hr_employees SET name=?, email=?, position=?, team=?, manager=?, employee_no=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE id=?",
    )
    .bind(e.name, e.email ?? null, e.position ?? null, e.team ?? null, e.manager ?? null, e.employee_no ?? null, e.start_date ?? null, e.end_date ?? null, id)
    .run();
}

export async function listNotes(db: D1Database, employeeId: string): Promise<HrNote[]> {
  const { results } = await db
    .prepare(
      "SELECT id, employee_id, kind, title, body, note_date, created_at FROM hr_notes WHERE employee_id = ? ORDER BY COALESCE(note_date, substr(created_at,1,10)) DESC, created_at DESC",
    )
    .bind(employeeId)
    .all<HrNote>();
  return results ?? [];
}

/** Warning counts per employee (for the register's flags column). */
export async function warningCounts(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db
    .prepare("SELECT employee_id, COUNT(*) AS n FROM hr_notes WHERE kind IN ('verbal_warning','written_warning') GROUP BY employee_id")
    .all<{ employee_id: string; n: number }>();
  return new Map((results ?? []).map((r) => [r.employee_id, r.n]));
}

export async function createNote(
  db: D1Database,
  n: { employee_id: string; kind: string; title: string; body?: string | null; note_date?: string | null },
): Promise<string> {
  const id = uuid();
  await db
    .prepare("INSERT INTO hr_notes (id, employee_id, kind, title, body, note_date) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, n.employee_id, n.kind, n.title, n.body ?? null, n.note_date ?? null)
    .run();
  return id;
}

export async function getNote(db: D1Database, id: string): Promise<HrNote | null> {
  return db
    .prepare("SELECT id, employee_id, kind, title, body, note_date, created_at FROM hr_notes WHERE id = ?")
    .bind(id)
    .first<HrNote>();
}

export async function deleteNote(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM hr_notes WHERE id = ?").bind(id).run();
}

// ---- documents (R2-backed attachments) -----------------------------------

export async function registerDocument(
  db: D1Database,
  d: { r2_key: string; filename: string; content_type?: string | null; size_bytes?: number | null; ref_id: string },
): Promise<string> {
  const id = uuid();
  await db
    .prepare("INSERT INTO documents (id, r2_key, filename, content_type, size_bytes, section, ref_id) VALUES (?, ?, ?, ?, ?, 'hr', ?)")
    .bind(id, d.r2_key, d.filename, d.content_type ?? null, d.size_bytes ?? null, d.ref_id)
    .run();
  return id;
}

export async function getDocument(db: D1Database, id: string): Promise<HrDocument | null> {
  return db
    .prepare("SELECT id, r2_key, filename, content_type, size_bytes, ref_id FROM documents WHERE id = ? AND section = 'hr'")
    .bind(id)
    .first<HrDocument>();
}

/** Attachments for a set of notes, keyed by note id. */
export async function documentsForNotes(db: D1Database, noteIds: string[]): Promise<Map<string, HrDocument[]>> {
  const out = new Map<string, HrDocument[]>();
  if (noteIds.length === 0) return out;
  const marks = noteIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id, r2_key, filename, content_type, size_bytes, ref_id FROM documents WHERE section = 'hr' AND ref_id IN (${marks})`)
    .bind(...noteIds)
    .all<HrDocument>();
  for (const d of results ?? []) {
    const key = d.ref_id ?? "";
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(d);
  }
  return out;
}

export async function deleteDocumentsForNote(db: D1Database, bucket: R2Bucket, noteId: string): Promise<void> {
  const { results } = await db
    .prepare("SELECT id, r2_key FROM documents WHERE section = 'hr' AND ref_id = ?")
    .bind(noteId)
    .all<{ id: string; r2_key: string }>();
  for (const d of results ?? []) {
    await bucket.delete(d.r2_key);
    await db.prepare("DELETE FROM documents WHERE id = ?").bind(d.id).run();
  }
}
