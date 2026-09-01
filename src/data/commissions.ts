import { uuid } from "./db";

export const COMM_STAGES = ["quote", "po", "invoice", "paid"] as const;
export type CommStage = (typeof COMM_STAGES)[number];
export const STAGE_LABEL: Record<CommStage, string> = { quote: "Quote", po: "PO", invoice: "Invoice", paid: "Paid" };

export const TX_TYPES = ["Quote", "Purchase Order", "Supplier Invoice", "Customer Invoice", "Payment", "Credit", "Other"];

export type Commission = {
  id: string;
  staff: string;
  allocation: string;
  client: string | null;
  po_number: string | null;
  comm_pct: number | null;
  stage: CommStage;
  notes: string | null;
};

export type CommissionLine = {
  id: string;
  commission_id: string;
  tx_date: string | null;
  reference: string | null;
  tx_type: string | null;
  allocation: string | null;
  po_number: string | null;
  description: string | null;
  payment: number;
  invoice: number;
};

export async function listCommissions(db: D1Database): Promise<Commission[]> {
  const { results } = await db
    .prepare("SELECT id, staff, allocation, client, po_number, comm_pct, stage, notes FROM commissions ORDER BY created_at DESC")
    .all<Commission>();
  return results ?? [];
}

export async function createCommission(db: D1Database, c: Partial<Commission> & { staff: string; allocation: string }): Promise<string> {
  const id = uuid();
  await db
    .prepare("INSERT INTO commissions (id, staff, allocation, client, po_number, comm_pct, stage, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, c.staff, c.allocation, c.client ?? null, c.po_number ?? null, c.comm_pct ?? null, c.stage ?? "quote", c.notes ?? null)
    .run();
  return id;
}

export async function setCommissionStage(db: D1Database, id: string, stage: string): Promise<void> {
  await db.prepare("UPDATE commissions SET stage=?, updated_at=datetime('now') WHERE id=?").bind(stage, id).run();
}

export async function deleteCommission(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM commission_lines WHERE commission_id=?").bind(id).run();
  await db.prepare("DELETE FROM commissions WHERE id=?").bind(id).run();
}

export async function listAllLines(db: D1Database): Promise<CommissionLine[]> {
  const { results } = await db
    .prepare("SELECT id, commission_id, tx_date, reference, tx_type, allocation, po_number, description, payment, invoice FROM commission_lines ORDER BY tx_date DESC, created_at DESC")
    .all<CommissionLine>();
  return results ?? [];
}

export async function addLine(db: D1Database, l: Partial<CommissionLine> & { commission_id: string }): Promise<string> {
  const id = uuid();
  await db
    .prepare(
      "INSERT INTO commission_lines (id, commission_id, tx_date, reference, tx_type, allocation, po_number, description, payment, invoice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, l.commission_id, l.tx_date ?? null, l.reference ?? null, l.tx_type ?? null, l.allocation ?? null, l.po_number ?? null, l.description ?? null, l.payment ?? 0, l.invoice ?? 0)
    .run();
  return id;
}

export async function deleteLine(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM commission_lines WHERE id=?").bind(id).run();
}
