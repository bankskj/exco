# Exco

Internal operations site for **Elula Online** — Accounts, Payroll, and HR tracking.
Runs on Cloudflare Workers with a D1 database and R2 storage, behind a shared
password gate. Live at **https://exco.elula.online** (workers.dev URL disabled).

## Stack

- **Cloudflare Worker** + [Hono](https://hono.dev) (server-rendered HTML via hono/jsx)
- **D1** (`exco-db`) — SQL database, binding `DB`
- **R2** (`exco-uploads`) — file storage, binding `UPLOADS`
- Auth: one shared site password → signed, HTTP-only session cookie (12h)

## Project layout

```
src/
  index.tsx        routes (public + protected /app/*)
  auth.ts          password check + session cookie helpers
  types.ts         binding/env types
  views/           layout + pages (hono/jsx)
migrations/        D1 SQL migrations
wrangler.jsonc     Worker + bindings config
```

## Local development

```bash
npm install
npm run db:migrate:local      # apply migrations to local D1
npm run dev                   # http://localhost:8787
```

Local secrets live in `.dev.vars` (gitignored). Default local password: `exco-dev-2026`.

## Deploy

Set the production secrets once, then deploy:

```bash
npx wrangler secret put SITE_PASSWORD     # the real site password
npx wrangler secret put SESSION_SECRET    # a long random string
npm run db:migrate:remote                 # apply migrations to remote D1
npm run deploy
```

## Routes

| Route                      | Access    | Purpose                                        |
|----------------------------|-----------|------------------------------------------------|
| `/`                        | public    | Landing page                                   |
| `/login`                   | public    | Password sign-in (+ optional name for audit)   |
| `/healthz`                 | public    | Health check                                   |
| `/app`                     | protected | Executive overview (KPI cards, sync)           |
| `/app/finance`             | protected | Finance: overview, cash, P&L, receivables, forecast, costs, transactions |
| `/app/clients`             | protected | Client billing: 12-client monthly P&L summary  |
| `/app/clients/:id`         | protected | Client tracker (FY months, quarters, drills)   |
| `/app/clients/settings`    | protected | Clients, projects, mappings, treatments, staff |
| `/app/clients/close`       | protected | Month-close checklist, snapshots, audit        |
| `/app/allocations`         | protected | Staff share % grid per month                   |
| `/app/costs`               | protected | Cost inbox (assign / split / rules / queues)   |
| `/app/costs/rules`         | protected | Cost rule editor with preview                  |
| `/app/revenue`             | protected | Revenue lines, contact mapping, overrides      |
| `/app/pipeline`            | protected | Deals & commissions                            |
| `/app/payroll`, `/app/hr`  | protected | People                                         |
| `/app/admin`               | protected | Xero connection, data quality, vendors         |

Full Clients-module behaviour: [docs/client-billing.md](docs/client-billing.md).
Old `/app/projects` URLs redirect to `/app/clients`.

## Roadmap

- [x] Scaffold Worker + D1 + R2, landing + login gate
- [x] Custom domain `exco.elula.online` (workers.dev disabled)
- [x] Accounts section (cashflow + forecast engine, FY selector)
- [x] Payroll tracking (gross/PAYE/nett, employee types, CSV import/export)
- [x] HR (headcount, employee files, R2 attachments)
- [x] Recurring expenses + Xero repeating-bills sync
