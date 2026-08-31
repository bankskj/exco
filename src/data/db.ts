export function uuid(): string {
  return crypto.randomUUID();
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function getAllMeta(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM app_meta").all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of results ?? []) out[r.key] = r.value;
  return out;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(key, value)
    .run();
}
