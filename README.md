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

| Route            | Access    | Purpose                         |
|------------------|-----------|---------------------------------|
| `/`              | public    | Landing page                    |
| `/login`         | public    | Password sign-in                |
| `/app`           | protected | Dashboard (3 sections)          |
| `/app/accounts`  | protected | Accounts (stub)                 |
| `/app/payroll`   | protected | Payroll (stub)                  |
| `/app/hr`        | protected | HR (stub)                       |
| `/healthz`       | public    | Health check                    |

## Roadmap

- [x] Scaffold Worker + D1 + R2, landing + login gate
- [x] Custom domain `exco.elula.online` (workers.dev disabled)
- [x] Accounts section (cashflow + forecast engine, FY selector)
- [x] Payroll tracking (gross/PAYE/nett, employee types, CSV import/export)
- [x] HR (headcount, employee files, R2 attachments)
- [x] Recurring expenses + Xero repeating-bills sync
