import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { formatZAR } from "../lib/money";
import { label } from "../lib/period";

export type DashStats = {
  cash: { bankToday: number; runwayMonths: number | null; runwayMonth: string | null; netPosition: number; anchored: boolean };
  income: { fyLabel: string; income: number; net: number; nim: number };
  deals: { quoted: number; quotedN: number; invoiced: number; commDue: number };
  payroll: { month: string | null; nett: number; gross: number; paid: number };
  expenses: { recurringMonthly: number; activeN: number; debtorsDue: number };
  hr: { active: number; avgTenure: string; warnings: number };
};

const Stat: FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
  <div style="min-width:110px">
    <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px">{label}</div>
    <div class={tone ?? ""} style="font-size:19px;font-weight:700;margin-top:2px">{value}</div>
  </div>
);

const SectionCard: FC<{ href: string; icon: string; title: string; children?: unknown }> = ({ href, icon, title, children }) => (
  <a class="card" href={href} style="color:var(--text);display:block">
    <div class="row spread">
      <h2 style="margin:0"><span class="section-icon" style="margin-right:8px">{icon}</span>{title}</h2>
      <span class="muted" style="font-size:12px">open →</span>
    </div>
    <div class="row" style="gap:22px;margin-top:14px;flex-wrap:wrap">{children}</div>
  </a>
);

export const Dashboard: FC<{ s: DashStats }> = ({ s }) => (
  <Layout title="Dashboard" authed section="dashboard" wide>
    <div class="container">
      <h1 style="margin-top:16px">Dashboard</h1>
      <p class="muted">Live across the business — click any card to drill in.</p>

      <div class="grid section-block" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:18px">
        <SectionCard href="/app/accounts" icon="💰" title="Cashflow">
          <Stat label="Bank (modelled)" value={formatZAR(s.cash.bankToday)} tone={s.cash.bankToday < 0 ? "neg" : "pos"} />
          <Stat label="Runway" value={s.cash.runwayMonths == null ? "Cash-positive" : `${s.cash.runwayMonths} mo`}
            tone={s.cash.runwayMonths == null ? "pos" : s.cash.runwayMonths <= 6 ? "neg" : "warn"} />
          <Stat label="Net position" value={formatZAR(s.cash.netPosition)} tone={s.cash.netPosition < 0 ? "neg" : "pos"} />
        </SectionCard>

        <SectionCard href="/app/accounts/income" icon="📈" title={`Income — ${s.income.fyLabel} to date`}>
          <Stat label="Income" value={formatZAR(s.income.income)} />
          <Stat label="Net profit" value={formatZAR(s.income.net)} tone={s.income.net < 0 ? "neg" : "pos"} />
          <Stat label="NI margin" value={`${s.income.nim}%`} tone={s.income.nim < 0 ? "neg" : ""} />
        </SectionCard>

        <SectionCard href="/app/accounts/deals" icon="🤝" title="Deals">
          <Stat label="Quoted (pipeline)" value={formatZAR(s.deals.quoted)} />
          <Stat label="Invoiced value" value={formatZAR(s.deals.invoiced)} />
          <Stat label="Commission due" value={formatZAR(s.deals.commDue)} tone="pos" />
        </SectionCard>

        <SectionCard href="/app/payroll" icon="🧾" title={`Payroll — ${s.payroll.month ? label(s.payroll.month) : "—"}`}>
          <Stat label="Nett" value={formatZAR(s.payroll.nett)} />
          <Stat label="Gross" value={formatZAR(s.payroll.gross)} />
          <Stat label="People paid" value={String(s.payroll.paid)} />
        </SectionCard>

        <SectionCard href="/app/expenses" icon="🔁" title="Expenses">
          <Stat label="Recurring / month" value={formatZAR(s.expenses.recurringMonthly)} />
          <Stat label="Active items" value={String(s.expenses.activeN)} />
          <Stat label="Debtors due" value={formatZAR(s.expenses.debtorsDue)} tone="warn" />
        </SectionCard>

        <SectionCard href="/app/hr" icon="👥" title="HR">
          <Stat label="Active headcount" value={String(s.hr.active)} />
          <Stat label="Avg tenure" value={s.hr.avgTenure} />
          <Stat label="Warnings on file" value={String(s.hr.warnings)} tone={s.hr.warnings > 0 ? "warn" : ""} />
        </SectionCard>
      </div>

      {!s.cash.anchored ? (
        <p class="muted section-block" style="font-size:12px">
          Cashflow balance is anchored — figures update from Xero on the monthly sync or a manual "Sync from Xero".
        </p>
      ) : null}
    </div>
  </Layout>
);
