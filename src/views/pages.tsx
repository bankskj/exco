import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export const Landing: FC = () => (
  <Layout title="Welcome">
    <div class="container">
      <div class="card" style="text-align:center; padding:56px 28px; margin-top:32px">
        <div class="logo" style="width:56px;height:56px;border-radius:14px;font-size:26px;margin:0 auto 20px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;color:#0b0e13;font-weight:800">
          E
        </div>
        <h1>Exco</h1>
        <p class="muted" style="max-width:520px;margin:0 auto 28px">
          Internal operations for Accounts, Payroll, and HR. Access is restricted to
          authorized Elula Online staff.
        </p>
        <a class="btn btn-primary" href="/login">Enter the site</a>
      </div>

      <div class="grid grid-3" style="margin-top:24px">
        <div class="card">
          <div class="section-icon">📊</div>
          <h2>Accounts</h2>
          <p class="muted">Track financial accounts and records.</p>
        </div>
        <div class="card">
          <div class="section-icon">💷</div>
          <h2>Payroll</h2>
          <p class="muted">Manage and track payroll runs.</p>
        </div>
        <div class="card">
          <div class="section-icon">👥</div>
          <h2>HR</h2>
          <p class="muted">People, records, and documents.</p>
        </div>
      </div>
    </div>
  </Layout>
);

export const Login: FC<{ error?: boolean }> = ({ error }) => (
  <Layout title="Sign in">
    <div class="container" style="max-width:420px">
      <div class="card" style="margin-top:48px">
        <h1 style="font-size:24px">Sign in</h1>
        <p class="muted" style="margin-top:0">Enter the site password to continue.</p>
        <form method="post" action="/login">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
          {error ? <div class="error">Incorrect password. Try again.</div> : null}
          <button class="btn btn-primary" type="submit" style="width:100%;margin-top:16px">
            Sign in
          </button>
        </form>
      </div>
    </div>
  </Layout>
);

type SectionCard = { href: string; icon: string; title: string; desc: string };

const SECTIONS: SectionCard[] = [
  { href: "/app/accounts", icon: "📊", title: "Accounts", desc: "Financial accounts and records." },
  { href: "/app/payroll", icon: "💷", title: "Payroll", desc: "Payroll runs and tracking." },
  { href: "/app/hr", icon: "👥", title: "HR", desc: "People, records, and documents." },
];

export const Dashboard: FC = () => (
  <Layout title="Dashboard" authed>
    <div class="container">
      <h1 style="margin-top:16px">Dashboard</h1>
      <p class="muted">Choose a section to get started.</p>
      <div class="grid grid-3" style="margin-top:20px">
        {SECTIONS.map((s) => (
          <a class="card" href={s.href} style="color:var(--text);display:block">
            <div class="section-icon">{s.icon}</div>
            <h2>{s.title}</h2>
            <p class="muted">{s.desc}</p>
          </a>
        ))}
      </div>
    </div>
  </Layout>
);

export const SectionStub: FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <Layout title={title} authed>
    <div class="container">
      <p style="margin-top:16px"><a href="/app">← Dashboard</a></p>
      <div class="card">
        <div class="section-icon">{icon}</div>
        <h1>{title}</h1>
        <p class="muted">
          This section is set up and ready. Functionality is coming next — we'll build it
          out against the D1 database and R2 storage.
        </p>
      </div>
    </div>
  </Layout>
);
