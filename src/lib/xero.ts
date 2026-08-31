// Xero OAuth 2.0 (authorization code + rotating refresh tokens) and the
// Repeating Invoices API. Connection state persists in app_meta.

import { getAllMeta, setMeta } from "../data/db";

const AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const REPEATING_URL = "https://api.xero.com/api.xro/2.0/RepeatingInvoices";

// This Xero app exposes the granular scope set (no accounting.transactions).
// Repeating bills are invoice-family objects → accounting.invoices.read;
// contacts.read for embedded vendor names; settings.read for org info;
// offline_access for refresh tokens.
export const XERO_SCOPES = "offline_access accounting.invoices.read accounting.contacts.read accounting.settings.read";

export type XeroTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
};

export type XeroState = {
  configured: boolean; // client id+secret present
  connected: boolean; // refresh token stored
  orgName: string | null;
  lastSync: string | null;
  callbackUrl: string; // the exact redirect_uri this deployment sends to Xero
};

export function authUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return "Basic " + btoa(`${clientId}:${clientSecret}`);
}

async function tokenRequest(clientId: string, clientSecret: string, form: Record<string, string>): Promise<XeroTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw new Error(`Xero token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as XeroTokens;
}

export function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<XeroTokens> {
  return tokenRequest(clientId, clientSecret, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshTokens(clientId: string, clientSecret: string, refreshToken: string): Promise<XeroTokens> {
  return tokenRequest(clientId, clientSecret, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function persistTokens(db: D1Database, t: XeroTokens): Promise<void> {
  await setMeta(db, "xero_access_token", t.access_token);
  await setMeta(db, "xero_refresh_token", t.refresh_token); // rotates on every refresh — must persist
  await setMeta(db, "xero_access_expires", String(Date.now() + (t.expires_in - 60) * 1000));
}

/** A valid access token, refreshing (and persisting the rotated refresh token) if needed. */
export async function ensureAccessToken(db: D1Database, clientId: string, clientSecret: string): Promise<string | null> {
  const m = await getAllMeta(db);
  if (!m.xero_refresh_token) return null;
  const expires = Number(m.xero_access_expires ?? 0);
  if (m.xero_access_token && Date.now() < expires) return m.xero_access_token;
  const t = await refreshTokens(clientId, clientSecret, m.xero_refresh_token);
  await persistTokens(db, t);
  return t.access_token;
}

export async function fetchConnections(accessToken: string): Promise<{ tenantId: string; tenantName: string }[]> {
  const res = await fetch(CONNECTIONS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Xero connections ${res.status}`);
  const list = (await res.json()) as any[];
  return list.map((c) => ({ tenantId: c.tenantId, tenantName: c.tenantName }));
}

// ---- repeating invoices (bills) -------------------------------------------

export type XeroRepeatingBill = {
  xero_id: string;
  name: string;
  vendor: string | null;
  amount: number;
  frequency: string;
  interval_months: number;
  next_date: string | null;
  currency: string;
};

/** '/Date(1518685950940+0000)/' → 'YYYY-MM-DD' */
function parseXeroDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/\/Date\((\d+)/);
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  return new Date(Number(m[1])).toISOString().slice(0, 10);
}

function scheduleToFrequency(unit: string, period: number): { frequency: string; interval_months: number } {
  if (unit === "WEEKLY") {
    const months = (period * 7) / 30.436875; // average month length
    if (period === 1) return { frequency: "weekly", interval_months: 12 / 52 };
    return { frequency: `every ${period} weeks`, interval_months: months };
  }
  // MONTHLY
  if (period === 1) return { frequency: "monthly", interval_months: 1 };
  if (period === 3) return { frequency: "quarterly", interval_months: 3 };
  if (period === 6) return { frequency: "biannual", interval_months: 6 };
  if (period === 12) return { frequency: "annual", interval_months: 12 };
  return { frequency: `every ${period} months`, interval_months: period };
}

export type VendorSummary = {
  key: string; // Xero ContactID
  name: string;
  months: Record<string, number>; // 'YYYY-MM' -> total billed
  monthCount: number;
  billCount: number;
  total: number;
  avgMonthly: number; // average over months actually billed
  currency: string;
  bills: { date: string; amount: number; reference: string | null }[];
};

/**
 * All ACCPAY bill activity in the last `monthsBack` months, grouped by vendor
 * with per-month totals. The recurring decision (track/exclude/threshold) is
 * made by the caller.
 */
export async function fetchVendorBillSummary(accessToken: string, tenantId: string, monthsBack = 6): Promise<VendorSummary[]> {
  const now = new Date();
  const sinceM = now.getUTCMonth() + 1 - monthsBack;
  const y = sinceM >= 1 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const m = ((sinceM - 1 + 12) % 12) + 1;
  const q = new URLSearchParams({
    where: `Type=="ACCPAY" AND Date >= DateTime(${y},${String(m).padStart(2, "0")},01)`,
  });
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Xero Invoices ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;

  // Ignore mis-captured dates (e.g. a bill typed as year 3107) — anything
  // outside the fetch window up to the end of the current month.
  const sinceMonth = `${y}-${String(m).padStart(2, "0")}`;
  const currentMonth = now.toISOString().slice(0, 7);

  const byVendor = new Map<string, VendorSummary>();
  for (const inv of data.Invoices ?? []) {
    if (inv.Status !== "AUTHORISED" && inv.Status !== "PAID") continue;
    const key = String(inv.Contact?.ContactID ?? inv.Contact?.Name ?? "unknown");
    const month = (parseXeroDate(inv.Date) ?? "").slice(0, 7);
    if (!month) continue;
    if (month < sinceMonth || month > currentMonth) continue;
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        key,
        name: String(inv.Contact?.Name ?? "Unknown vendor"),
        months: {},
        monthCount: 0,
        billCount: 0,
        total: 0,
        avgMonthly: 0,
        currency: String(inv.CurrencyCode ?? "ZAR"),
        bills: [],
      });
    }
    const v = byVendor.get(key)!;
    const amt = Number(inv.Total ?? 0);
    const fullDate = parseXeroDate(inv.Date);
    v.months[month] = (v.months[month] ?? 0) + amt;
    v.total += amt;
    v.billCount++;
    if (fullDate) v.bills.push({ date: fullDate, amount: amt, reference: inv.InvoiceNumber ? String(inv.InvoiceNumber) : inv.Reference ? String(inv.Reference) : null });
  }
  const out = [...byVendor.values()];
  for (const v of out) {
    v.monthCount = Object.keys(v.months).length;
    v.avgMonthly = v.monthCount ? Math.round((v.total / v.monthCount) * 100) / 100 : 0;
  }
  return out.sort((a, b) => b.avgMonthly - a.avgMonthly);
}

/**
 * Convert a vendor summary into the expense-upsert shape, inferring the
 * billing frequency from the pattern:
 *   3+ billed months  → monthly, at average spend per billed month
 *   2 billed months   → interval = the gap between them (quarterly etc.)
 *   1 billed month    → assumed annual (one-off big subs); user can override
 */
export function vendorToBill(v: VendorSummary, monthsBack = 6): XeroRepeatingBill {
  const monthsSorted = Object.keys(v.months).sort();
  let frequency: string;
  let interval_months: number;
  let amount: number;

  if (v.monthCount >= 3) {
    frequency = `monthly (detected, ${v.monthCount}/${monthsBack} mo)`;
    interval_months = 1;
    amount = v.avgMonthly;
  } else if (v.monthCount === 2) {
    const [a, b] = monthsSorted;
    const gap = Math.max(1, (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))));
    interval_months = gap;
    frequency =
      gap === 1 ? `monthly (detected, 2/${monthsBack} mo)`
      : gap === 3 ? "quarterly (detected)"
      : gap === 6 ? "biannual (detected)"
      : `every ${gap} months (detected)`;
    amount = Math.round((v.total / 2) * 100) / 100; // per occurrence
  } else {
    frequency = "annual (detected, 1 bill)";
    interval_months = 12;
    amount = Math.round(v.total * 100) / 100;
  }

  return {
    xero_id: `vendor:${v.key}`,
    name: v.name,
    vendor: v.name,
    amount,
    frequency,
    interval_months,
    next_date: null,
    currency: v.currency,
  };
}

/** Authorised repeating BILLS (Type=ACCPAY) from the connected org. */
export async function fetchRepeatingBills(accessToken: string, tenantId: string): Promise<XeroRepeatingBill[]> {
  const res = await fetch(REPEATING_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Xero RepeatingInvoices ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const out: XeroRepeatingBill[] = [];
  for (const ri of data.RepeatingInvoices ?? []) {
    if (ri.Type !== "ACCPAY") continue; // bills only — expenses, not sales
    if (ri.Status !== "AUTHORISED") continue;
    const sched = ri.Schedule ?? {};
    const { frequency, interval_months } = scheduleToFrequency(String(sched.Unit ?? "MONTHLY"), Number(sched.Period ?? 1));
    const firstLine = (ri.LineItems ?? [])[0];
    out.push({
      xero_id: String(ri.RepeatingInvoiceID),
      name: String(ri.Reference || firstLine?.Description || ri.Contact?.Name || "Repeating bill").slice(0, 120),
      vendor: ri.Contact?.Name ? String(ri.Contact.Name) : null,
      amount: Number(ri.Total ?? 0),
      frequency,
      interval_months,
      next_date: parseXeroDate(sched.NextScheduledDate),
      currency: String(ri.CurrencyCode ?? "ZAR"),
    });
  }
  return out;
}
