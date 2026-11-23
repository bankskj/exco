# Projects — how it works in Exco

Spec of the Projects section as currently built (November 2026). Covers where every
number comes from, how it is stored, refreshed and displayed, and the known limits.

URL: `/app/projects` · nav tab **Projects** · code: `src/views/projects.tsx`,
`src/lib/recurring.ts` is unrelated (that's forecasting) — projects logic lives in
`src/lib/xero.ts` (fetch), `src/data/projects.ts` (storage), `src/lib/xlsx.ts` (imports).

---

## 1. Data sources

The section combines **three independent sources**, each with its own refresh cycle:

| Source | What it provides | Refresh | Storage |
|---|---|---|---|
| Xero Projects API | Lifetime totals per project: charge (tasks + expenses), invoiced, estimate, deposit, minutes, status | Every full Xero sync (manual **Sync now** or monthly cron, 1st 04:00 UTC) | `xero_projects`, `xero_project_tasks` |
| Sync snapshots | Cumulative charge/invoiced per project **per month**, recorded at sync time | Written by every full sync (upsert on project+month) | `xero_project_snapshots` |
| Project Financials xlsx import | **Allocation line items** (contact, item, cost, charge, invoiced) — the detail Xero's API does not expose | Manual: export the report from Xero as Excel, upload via **Import Project Financials** | `xero_project_items` |

### 1.1 Xero Projects API (`fetchProjects` / `fetchProjectTasks` in `src/lib/xero.ts`)

- Scope: `projects.read` (granted by reconnecting Xero after the scope was added).
- `GET https://api.xero.com/projects.xro/2.0/projects?page=N&pageSize=50` — paged,
  rate-limit aware (honours `Retry-After` on 429, up to 5 attempts per call).
- Per project the sync stores: `id, name, status (INPROGRESS|CLOSED), currency,
  estimate, minutes_logged, task_amount, expense_amount, invoiced, to_be_invoiced, deposit`.
- Amount fields are read defensively: `totalTaskAmount` / `totalExpenseAmount`, falling
  back to `taskAmountInvoiced + taskAmountToBeInvoiced` (and the expense equivalents)
  when the rollups are absent. Invoiced = `projectAmountInvoiced ?? totalInvoiced`.
- Tasks: `GET /projects/{id}/tasks` per project (name, charge type, rate, minutes,
  amount, invoiced). Expense **line items are not exposed by Xero's API** — only the
  expense total per project. Line detail comes from the xlsx import (below).
- Writes are **atomic**: delete + inserts in a single D1 batch (one transaction), with
  project IDs de-duplicated first, so overlapping syncs cannot half-replace the table.
- Diagnostics: each sync stores the raw JSON of the largest project in app_meta
  `projects_raw_sample`; fetch failures land in `xero_projects_error` and surface on the
  page (scope errors show reconnect instructions; anything else shows a red
  "last sync failed — figures may be stale" banner).

### 1.2 Snapshots (`xero_project_snapshots`)

Xero's API only returns **lifetime** totals, so monthly movement is derived:
every sync upserts the current cumulative `charge` (task+expense) and `invoiced`
per project under the current `YYYY-MM`. Month movement = this month's cumulative −
previous month's cumulative. History therefore starts at the first recorded snapshot
(late Sep 2026) and accumulates automatically; it cannot be backfilled.

### 1.3 Project Financials import (`parseProjectFinancials` in `src/lib/xlsx.ts`)

- Input: Xero **Reports → Project Financials** exported as Excel. The Worker unzips and
  parses the xlsx itself (shared strings + sheet1; no external library).
- Parsed per line: project name (group header rows), contact, item type, item name,
  cost, charge, invoiced. Total/blank rows are skipped. The report period is parsed
  from the header ("For the period 1 March 2026 to 28 February 2027").
- **Period-aware**: a single-month export is tagged with that `period_month`; imports
  for different periods accumulate side by side, and re-importing a period replaces
  only that period's rows. Import metadata (period, date, row count) is kept in
  app_meta `project_items_meta`.
- The export carries **no dates per line** (Xero limitation), which is why monthly
  accuracy comes from importing one month at a time.

---

## 2. Page behaviour (`/app/projects`)

### 2.1 Grouping

Same-named Xero projects (e.g. one "Marketing" project per month) are **grouped into
one row** by trimmed name. The row shows a "N projects" badge, combined figures, and
status "x in progress" / "closed". The drill-down lists the underlying Xero projects
individually.

### 2.2 Filters

- **Status**: In progress (default) · Closed · All — a group counts as in-progress if
  any member is.
- **Period** (`?p=`): All time · This month · Last month · This quarter · Last quarter ·
  This FY. Quarters follow the Mar–Feb fiscal year.

### 2.3 Period figures — source precedence

For any window other than All time, each group's Charge/Invoiced is computed with this
precedence (route logic in `app.get("/app/projects")`):

1. **Dated imports** (exact): sum of `xero_project_items` for the window's months.
2. **Current month**: live API totals minus the last snapshot before the month began.
3. **Snapshot deltas** (fallback, only when no window month has an import):
   cumulative at window end − cumulative before window start.

Partial coverage is allowed: covered months are summed and a note names the months
still missing an import ("Covers the imported months only — not yet imported: …").
Groups with zero movement in the window are hidden. All time always uses the live
lifetime API totals.

### 2.4 Row drill-down (inline) and ledger (right drawer)

- Clicking a project name expands the row: Charge / Invoiced / Profit / Estimate cards,
  the underlying-projects table (for groups), a tasks table when time items exist, and
  an **Open ledger →** button.
- The **ledger** (right slide-out, `?ledger=1`) shows the full allocation line items
  from the imports, **grouped by import period** (dated months first), each section
  with its own totals — plus a "Monthly movement" table from snapshots. The ledger
  follows the selected period filter: only sections inside the window are shown.
- Profit everywhere = invoiced − charge; cost-collector projects (e.g. Head Office)
  legitimately show deeply negative.

---

## 3. Storage reference

```
xero_projects            id PK, name, status, currency, estimate, minutes_logged,
                         task_amount, expense_amount, invoiced, to_be_invoiced,
                         deposit, updated_at              (migration 0022)
xero_project_tasks       id PK, project_id, name, charge_type, rate, minutes,
                         amount, amount_invoiced          (0022)
xero_project_snapshots   (project_id, month) PK, charge, invoiced   (0022)
xero_project_items       autoid PK, project_name, contact, item_type, item_name,
                         cost, charge, invoiced, period_label, period_month
                         (0023, periods added in 0024)
app_meta keys            project_items_meta, projects_raw_sample, xero_projects_error
```

Items are keyed by **project name** (the export has no IDs), which also matches the
page's name-grouping. Figures are excl VAT on the import side (report basis);
API amounts are as Xero returns them.

---

## 4. Known limits & open items

- **Charge values currently zero after sync (open, Nov 2026)**: the API began
  returning ≈0 for task/expense totals while invoiced stays correct. Field fallbacks
  plus a raw-payload diagnostic were deployed (commit `90a1ddb`); the next **Sync now**
  will either repair the Charge column or capture the payload needed for the real
  mapping fix. Until then the main table's lifetime Charge column is unreliable;
  period views driven by imports are unaffected.
- Xero's API exposes **no expense line items** and **no dated project history** — hence
  the import + snapshot design. Figures from the API are lifetime (all time), while
  Xero's own Project Financials report is date-ranged; the page labels this.
- The "All time" label on imports means the synced/imported windows, not company
  history: snapshots start late Sep 2026, imports cover whatever periods were uploaded
  (currently FY-wide 1 Mar 2026–28 Feb 2027 plus Jul/Aug/Sep 2026 monthly).
- Non-ZAR considerations: projects store their currency; period/ledger figures assume
  ZAR amounts as exported/synced.
- Routine: after month-end, export that month's Project Financials and import it
  (~1 minute) — this keeps every period view exact and the ledgers dated.
