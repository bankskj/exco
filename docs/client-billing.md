# Client Billing & Cost Allocation — how it works in Exco

Spec of the Clients section as built (November 2026). It replaces the
Xero-Projects-based reporting: Xero stays the source of truth for transactions,
all project and client allocation happens in Exco. Covers where every number
comes from, how it is stored, refreshed and displayed, and the known limits.

URL: `/app/clients` · nav tab **Clients** · code: engine `src/lib/allocation.ts` +
`src/lib/billing_rules.ts`, data layer `src/data/billing.ts`, sync additions in
`src/lib/xero.ts`, views `src/views/clients*.tsx`, `allocations.tsx`, `costs.tsx`,
`revenue_lines.tsx`. Shared types: `src/lib/billing_types.ts`. All money is stored
as **integer cents** and formatted only in views; amounts are ZAR **excluding VAT**.

---

## 1. The 12 reporting clients

Eleven key accounts plus **General Sales**, which takes everything else. Every
rand in a month lands on exactly one of three targets: a **project** (which
belongs to a client), the **Shared Overhead pool**, or **Excluded**.

| # | Reporting client | Xero contacts mapped |
|---|---|---|
| 1 | ABF Sugar Pty Ltd | ABF Sugar Pty Ltd |
| 2 | SAS Atlantique Signarama | SAS ATLANTIQUE SIGNARAMA |
| 3 | Axiomatic Consultants (Pty) Ltd | Axiomatic Consultants (Pty) Ltd |
| 4 | Scuderia Capital (Pty) Ltd | Scuderia Capital (Pty) Ltd; Fortune-Wes / Signarama Côte d'Ivoire |
| 5 | Business Franchise Group Ltd | Business Franchise Group Ltd |
| 6 | Devco Auctioneers and Sales (Pty) Ltd | Devco Auctioneers and Sales (Pty) Ltd |
| 7 | Carlton Solutions Ltd | Carlton Solutions Ltd |
| 8 | Provantage (Pty) Ltd | Provantage (Pty) Ltd (not invoiced in FY2027 yet) |
| 9 | Global Business Solutions | Global Business Solutions |
| 10 | Energy at Work Projects (Pty) Ltd | Energy at Work Projects (Pty) Ltd |
| 11 | CLICKNHIRE (PTY) LTD | CLICKNHIRE (PTY) LTD |
| 12 | **General Sales** | Every other contact, plus anything not assigned elsewhere |

Each client has exactly **one default project** (`is_default = 1`); revenue and
cost aimed at a client without a project land there. Extra projects are created
only when a client needs a split. An unmapped revenue contact goes to General
Sales and is flagged (and blocks month close until mapped).

Key terms: **Contribution** = Revenue − People − Direct. **Net margin** =
Contribution − Overhead Recovery. **Shared Overhead** = company running costs +
staff time targeted at overhead; recovered across all 12 clients pro rata
(default basis: revenue share). Fiscal year is Mar–Feb (FY2027 = Mar 2026–Feb 2027).

---

## 2. Data sources and sync

Xero syncs **line-level** documents into the module's own ledgers
(`revenue_lines`, `cost_lines`) daily (cron `0 2 * * *`, 04:00 SAST) and on
**Sync now**. `syncBillingLedgers` in `src/data/billing.ts` +
`fetchBillingDocs` in `src/lib/xero.ts`, reusing the existing OAuth/tenant
handling and 429/Retry-After logic.

| Xero endpoint | Filter | Lands in |
|---|---|---|
| `GET /Invoices` | ACCREC, AUTHORISED or PAID | `revenue_lines` (one per LineItem) |
| `GET /CreditNotes` | ACCRECCREDIT | `revenue_lines`, negative |
| `GET /Invoices` | ACCPAY, AUTHORISED or PAID | `cost_lines`, doc_kind `bill` |
| `GET /CreditNotes` | ACCPAYCREDIT | `cost_lines`, negative |
| `GET /BankTransactions` | SPEND, AUTHORISED | `cost_lines`, doc_kind `spend` (salary/contractor EFTs included) |
| `GET /BankTransactions` | RECEIVE lines coded to a revenue account | `revenue_lines` |
| `GET /Accounts` | — | fills `gl_categories` names |

Sync rules:

- **Excl VAT**: for `LineAmountTypes = Inclusive`, line amount − tax amount.
  Foreign currency converts to ZAR as amount ÷ `CurrencyRate` (both amounts
  stored; direction to be verified against one known EUR invoice).
- **Idempotent**: `source_ref` = Xero LineItemID, upserted. Running the same
  sync twice changes nothing. The period comes from the document date.
- **Unknown account codes** are auto-created in `gl_categories`: 4xx cost codes
  as Running costs/overhead, anything else as Unmapped (overhead for costs,
  revenue for revenue lines).
- **Window**: first run backfills from 2026-03-01; after that a rolling
  3 months plus anything modified since the last sync (If-Modified-Since).
  Voided/deleted documents are removed from **open** periods only.
- **Closed periods are never written to** — a Xero change there raises a
  post-close warning (`billing_postclose_warning`) without touching the snapshot.
- Errors land in `billing_sync_error` and show as a banner.

**CSV import** (revenue and cost inboxes): columns `date, contact|supplier,
reference, description, account_code, amount_excl, currency`. `source_ref` is a
content hash, so re-imports don't duplicate. Manual add/edit is allowed only for
`manual`/`csv` lines — Xero lines are read-only apart from their assignment.

---

## 3. Calculation model

The engine is one pure function, `computePeriod(input) → PeriodResult`, in
`src/lib/allocation.ts`. It runs per month; quarters and years are sums of
monthly results. It reads nothing from the DB itself — `loadPeriodInput` in
`src/data/billing.ts` loads the input.

**Revenue.** Sum revenue lines for the period by project. Contact → client via
`client_contacts`; line with only a client → that client's default project;
unmapped contact → General Sales, flagged. A manual project override on a line
wins. Excluded-treatment revenue (Other income) is reported separately.

**People cost.** A cost line whose payee matches a staff member's
`staff_payees` alias is that person's cost, whatever the account — this is how
director payments coded to client accounts still follow the person. Per member,
monthly cost = Σ their lines; if none but an Exco payroll entry exists, use
gross × (1 + loading %) instead, marked **estimated**. The month's share %
(`staff_allocations`) spreads the cost over projects/overhead; a month with no
rows **carries the latest earlier month forward**. The remainder (100 − sum)
goes to the member's default target: General Sales, or Shared Overhead for
admin staff (and KJ Banks — all director time is overhead). Totals over 100%
are rejected at save time (HTTP 422). A people-account line whose payee matches
nobody goes to the **Unmatched staff** queue and, until resolved, to General
Sales.

**Direct and overhead cost lines**, by category treatment, resolved in order:
excluded → skip (reported); people-with-payee → above; (a) manual `cost_splits`
on the line; (b) first matching active **cost rule** by priority; (c) default —
direct → General Sales flagged *unassigned*, overhead → pool.

**Split arithmetic.** Percent splits total 100; each piece rounds to cents and
the last absorbs the difference. Fixed splits allocate fixed amounts first with
the remainder to the rule's remainder target; a bill smaller than the fixed
total scales the fixed amounts down pro rata.

**Overhead Recovery.** pool = overhead cost pieces + overhead staff pieces.
Weight the 12 clients by the period's basis — `revenue` (default),
`direct_cost`, or `fixed` (manual % in `overhead_fixed_shares`); negative
weights clamp to 0; fallback chain revenue → direct_cost → equal. Shares are
apportioned by **largest remainder** so pieces sum exactly to the pool. Within
a client the share spreads over its projects by the same basis. General Sales
takes part like any client.

**Reconciliation (hard check, every period):**
Σ clients (People + Direct + Overhead) = Σ non-excluded cost lines + payroll
estimates, and Σ clients Revenue = Σ revenue lines — both **to the cent**. On
failure the summary shows a red banner and the month cannot be closed. Warnings
only: Xero P&L tie-out difference and exception counts (unmapped contacts,
unassigned lines, unmatched staff, payroll estimates).

---

## 4. Cost rules

A rule assigns a provider's bill once; every later month's **actual** amount
splits the same way. Rules run at report time, not at sync — a rule change
flows into every open month; closed months keep their snapshot.

- **Matching**: every filled-in field must match (case-insensitive contains for
  supplier/description, exact for account code), line date within the effective
  window. Priority ascending, ties by name, first match wins. Manual splits on
  a line always beat rules.
- **Modes**: `percent` (must total 100 across projects/overhead) and `fixed`
  (fixed rand amounts, one split flagged remainder takes the rest; short bills
  scale pro rata, remainder 0).
- **Save as rule** from the cost inbox pre-fills the supplier; the editor shows
  a 3-month preview of matching lines and their splits before saving.
- Guardrails: no remainder / not 100% → can't save (422). Every rule change is
  audited with before/after JSON.

---

## 5. Screens and routes

All pages server-rendered (hono/jsx), period filter `?p=` (this/last month,
this/last quarter, this FY, all time; Mar–Feb FY).

| Route | Purpose |
|---|---|
| `GET /app/clients` | 12-client summary: Revenue, People, Direct, Contribution (+%), Overhead, Net (+%), budget variance; month-grid toggle; reconciliation badge; exception chips |
| `GET /app/clients/:id` | Client tracker: FY months + quarter subtotals + FY total; expandable Revenue (by group), People (by staff, % and R), Direct (by group → supplier) |
| `GET /app/clients/:id/projects/:pid` | Same layout per project + contract value and invoiced to date |
| `GET /app/allocations?period=` | Staff share % grid: rows = staff with cost, columns = 12 default projects + extra projects + Overhead; remainder column; copy previous month; >100% blocks save |
| `GET /app/costs?p=&tab=` | Cost inbox: Unassigned / Unmatched staff / By rule / Assigned / Overhead / Excluded; assign, split %, exclude, map payee, save as rule |
| `GET /app/costs/rules` | Rule list and editor with live 3-month preview |
| `GET /app/revenue?p=` | Revenue lines; unmapped contacts on top with Map to client; per-line project override |
| `GET /app/clients/settings` | Clients, projects, contact mappings, category treatments, staff payees/targets/loading, overhead basis |
| `GET /app/clients/close?period=` | Month-close checklist, close/reopen, audit list |
| `GET /app/clients/export.csv?view=` | summary / client / costs / allocations, using the current filter |

---

## 6. Month close and audit

Close checklist — blockers: reconciliation to the cent, no unmapped revenue
contacts, no unmatched staff payments, no allocation rows over 100%. Warnings
(need a tick): unassigned direct lines, staff on payroll estimates, Xero P&L
tie-out difference. Close computes the period, freezes it in
`period_snapshots.result_json` and sets the period closed; reports for closed
periods read the snapshot. Writes touching a closed period are rejected with
**HTTP 409**, enforced in the data layer. Reopen deletes the snapshot and is
audited.

Every write (allocation save, split, rule, mapping, close/reopen, manual line)
inserts a `billing_audit` row with before/after JSON **in the same D1 batch**.
The actor is the optional name captured at login (stored in the session cookie).

---

## 7. Storage reference

```
clients                 the 12 report rows (is_general flags General Sales)   (0025)
client_contacts         Xero contact name/id -> client
projects                work streams; one default per client (ux_projects_default)
project_budgets         (project, period) revenue_c / cost_c
gl_categories           account code -> kind, report_group, treatment
staff_payees            payee text -> employees row (exact|contains)
staff_allocations       (employee, period, target) share %
revenue_lines           one row per invoice/credit-note/RECEIVE line
cost_lines              one row per bill/spend line; employee_id when payee matched
cost_splits             manual per-line assignment (beats rules)
cost_rules (+_splits)   saved split instructions, priority-ordered
billing_periods         period status + overhead basis
overhead_fixed_shares   manual % per client for basis 'fixed'
period_snapshots        frozen PeriodResult at close
billing_audit           every write, before/after JSON
employees               + default_target, loading_pct (0026 sets KJ Banks -> overhead)
app_meta keys           billing_last_sync, billing_sync_error, billing_postclose_warning
```

---

## 8. Backfill routine and known limits

After the first deploy: run the sync (backfills from 2026-03-01), map any
remaining contacts for the 11 clients, add payee aliases for every staff
member/regular contractor (Danie, Dondry, Tylon, Unathi James, Tatenda,
Prashant, KJ Banks…), create rules for Hetzner/Afrihost and other recurring
providers, enter share % from March 2026 (carry-forward covers most months),
then close each month March → October in order.

- The engine trusts the ledgers; journals that exist only in Xero's GL (not as
  invoices/bills/spend) appear in the P&L tie-out difference, not in the module.
- FX conversion direction is pending verification against one known EUR invoice.
- Xero Projects is retired: the Projects tab and `/app/projects` redirect to
  `/app/clients`; the `xero_project*` tables stay read-only for one quarter
  before a drop migration.
