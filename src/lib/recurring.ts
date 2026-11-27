// Scheduled recurring invoices: project each Xero repeating template forward
// from its next scheduled date, then place the cash in the month payment is
// due under the template's payment terms.
//
// Only dates from NextScheduledDate onwards are projected, so invoices Xero
// has already raised are never counted twice — those are receivables/payables.
// Templates that only create DRAFT invoices are left out of the forecast.

import type { XeroRepeatingSchedule } from "./xero";

export const RECURRING_HORIZON_MONTHS = 12;

export type ProjectedInvoice = {
  xero_id: string;
  type: "ACCREC" | "ACCPAY";
  contact: string | null;
  reference: string | null;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  amount: number; // excl VAT
  total: number; // incl VAT
};

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;
const parts = (s: string) => s.split("-").map(Number) as [number, number, number];

function addMonthsISO(s: string, n: number, anchorDay: number): string {
  const [y, m] = parts(s);
  const idx = y * 12 + (m - 1) + n;
  return iso(Math.floor(idx / 12), (idx % 12) + 1, anchorDay);
}

function addDaysISO(s: string, n: number): string {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Due date from Xero payment terms; unknown terms fall back to the invoice date. */
export function dueDateFor(invoiceDate: string, dueDay: number | null, dueType: string | null): string {
  if (dueDay == null || !dueType) return invoiceDate;
  const [y, m] = parts(invoiceDate);
  switch (dueType) {
    case "DAYSAFTERBILLDATE":
      return addDaysISO(invoiceDate, dueDay);
    case "DAYSAFTERBILLMONTH":
      return addDaysISO(iso(y, m, 31), dueDay); // after the end of the invoice month
    case "OFCURRENTMONTH": {
      const d = iso(y, m, Math.max(1, dueDay));
      return d < invoiceDate ? invoiceDate : d;
    }
    case "OFFOLLOWINGMONTH":
      return addMonthsISO(iso(y, m, 1), 1, Math.max(1, dueDay));
    default:
      return invoiceDate;
  }
}

/**
 * Every invoice each schedule will raise from its next date up to `horizon`
 * months after today (open-ended schedules are capped there too).
 */
export function projectSchedules(
  schedules: XeroRepeatingSchedule[],
  today: string = new Date().toISOString().slice(0, 10),
  horizonMonths = RECURRING_HORIZON_MONTHS,
): ProjectedInvoice[] {
  const limit = addMonthsISO(today, horizonMonths, parts(today)[2]);
  const out: ProjectedInvoice[] = [];
  for (const s of schedules) {
    if (!s.next_date || s.status === "DRAFT") continue;
    const anchorDay = parts(s.next_date)[2];
    const stop = s.end_date && s.end_date < limit ? s.end_date : limit;
    let date = s.next_date;
    for (let i = 0; i < 1000 && date <= stop; i++) {
      // A stale next date (sync lag) that is already in the past: Xero will
      // have raised it — skip rather than double count.
      if (date >= today) {
        out.push({
          xero_id: s.xero_id,
          type: s.type,
          contact: s.contact,
          reference: s.reference,
          invoiceDate: date,
          dueDate: dueDateFor(date, s.due_day, s.due_type),
          amount: s.sub_total,
          total: s.total,
        });
      }
      date = s.unit === "WEEKLY" ? addDaysISO(s.next_date, 7 * s.period * (i + 1)) : addMonthsISO(s.next_date, s.period * (i + 1), anchorDay);
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/** Monthly run-rate (incl VAT — bank value) of a schedule. */
export function monthlyRate(s: XeroRepeatingSchedule): number {
  const months = s.unit === "WEEKLY" ? (7 * s.period) / 30.436875 : s.period;
  return s.total / months;
}

export type RecurringByMonth = {
  income: Map<string, number>; // approved sales templates, by due month
  bills: Map<string, number>; // committed recurring bills, by due month
  incomeRunRate: number; // monthly equivalent of live sales schedules (incl VAT)
  billRunRate: number;
};

export function groupByDueMonth(projected: ProjectedInvoice[], schedules: XeroRepeatingSchedule[], today: string = new Date().toISOString().slice(0, 10)): RecurringByMonth {
  const r: RecurringByMonth = { income: new Map(), bills: new Map(), incomeRunRate: 0, billRunRate: 0 };
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const p of projected) {
    const month = p.dueDate.slice(0, 7);
    // Bank values: the customer pays (and we pay) the VAT-inclusive total.
    if (p.type === "ACCREC") add(r.income, month, p.total);
    else add(r.bills, month, p.total);
  }
  for (const s of schedules) {
    if (!s.next_date || s.status === "DRAFT" || (s.end_date && s.end_date < today)) continue;
    if (s.type === "ACCREC") r.incomeRunRate += monthlyRate(s);
    else r.billRunRate += monthlyRate(s);
  }
  return r;
}
