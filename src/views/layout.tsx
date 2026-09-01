import type { FC, PropsWithChildren } from "hono/jsx";

const CSS = `
:root {
  --bg: #0e1116;
  --panel: #161b22;
  --panel-2: #1c2230;
  --border: #2a3140;
  --text: #e6edf3;
  --muted: #9aa7b4;
  --accent: #4f8cff;
  --accent-2: #6ee7b7;
  --danger: #ff6b6b;
  --radius: 12px;
  --shadow: 0 8px 30px rgba(0,0,0,.35);
}
* { box-sizing: border-box; }
html { color-scheme: dark; } /* native controls (date pickers, selects, file inputs) render dark */
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: radial-gradient(1200px 600px at 70% -10%, #1a2331 0%, var(--bg) 55%);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.container { max-width: 1040px; margin: 0 auto; padding: 24px; }
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; border-bottom: 1px solid var(--border);
  position: sticky; top: 0; background: rgba(14,17,22,.7); backdrop-filter: blur(8px); z-index: 10;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .3px; }
.brand .logo {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: grid; place-items: center; color: #0b0e13; font-weight: 800; font-size: 15px;
}
.btn {
  display: inline-block; border: 1px solid var(--border); background: var(--panel-2);
  color: var(--text); padding: 10px 18px; border-radius: 10px; font-weight: 600; cursor: pointer;
  transition: .15s ease; text-decoration: none;
}
.btn:hover { border-color: var(--accent); text-decoration: none; }
.btn-primary { background: linear-gradient(135deg, var(--accent), #3f7bef); border-color: transparent; color: #fff; }
.btn-ghost { background: transparent; }
.muted { color: var(--muted); }
.card {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 22px; box-shadow: var(--shadow);
}
div.grid { display: grid; gap: 18px; }
@media (min-width: 720px) { div.grid-3 { grid-template-columns: repeat(3, 1fr); } }
label { display: block; font-size: 14px; color: var(--muted); margin-bottom: 6px; }
input[type=password], input[type=text], input[type=date] {
  width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);
  background: #0c0f14; color: var(--text); font-size: 15px; font-family: inherit;
}
input[type=date] { padding: 10px 12px; font-size: 14px; }
input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
textarea {
  width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
  background: #0c0f14; color: var(--text); font-size: 14px; font-family: inherit;
}
textarea:focus { outline: none; border-color: var(--accent); }
input:focus { outline: none; border-color: var(--accent); }
.error { color: var(--danger); font-size: 14px; margin-top: 10px; }
.footer { color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0 24px; }
.section-icon { font-size: 26px; }
h1 { font-size: 30px; margin: 0 0 8px; }
h2 { font-size: 20px; margin: 0 0 6px; }
h3 { font-size: 15px; margin: 0 0 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }

/* Nav */
.mainnav { display: flex; align-items: center; gap: 4px; }
.navlink { padding: 8px 12px; border-radius: 8px; color: var(--muted); font-weight: 600; font-size: 14px; }
.navlink:hover { color: var(--text); text-decoration: none; background: var(--panel-2); }
.navlink.active { color: var(--text); background: var(--panel-2); }

/* KPI cards */
.kpis { display: grid; gap: 14px; grid-template-columns: repeat(2, 1fr); }
@media (min-width: 860px) { .kpis { grid-template-columns: repeat(4, 1fr); } }
.kpi { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
.kpi .k-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
.kpi .k-value { font-size: 24px; font-weight: 700; margin-top: 6px; }
.kpi .k-sub { font-size: 12px; margin-top: 4px; }
.pos { color: var(--accent-2); } .neg { color: var(--danger); } .warn { color: #f6c453; }

/* Tables */
.tablewrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
table.grid { display: table; gap: 0; border-collapse: collapse; width: 100%; font-size: 13px; }
table.grid th, table.grid td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
table.grid th:first-child, table.grid td:first-child { text-align: left; position: sticky; left: 0; background: var(--panel); z-index: 1; }
table.grid thead th { background: var(--panel-2); color: var(--muted); font-weight: 600; position: sticky; top: 0; }
table.grid tbody tr:hover td { background: rgba(79,140,255,.06); }
table.grid td.num { font-variant-numeric: tabular-nums; }
table.grid tr.total td { font-weight: 700; border-top: 2px solid var(--border); background: var(--panel-2); }
table.grid tr.group td { background: #12161d; color: var(--muted); font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; }
table.grid.fixed { table-layout: fixed; }
table.grid.wrap th, table.grid.wrap td { white-space: normal; overflow-wrap: break-word; }
.pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 12px; font-size: 13px; }
.pager .muted { margin: 0 6px; }
table.grid input { width: 92px; padding: 5px 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text); text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
table.grid.fixed input { width: 100%; }
table.grid td, table.grid th { overflow: hidden; text-overflow: ellipsis; }
table.grid input:hover { border-color: var(--border); }
table.grid input:focus { outline: none; border-color: var(--accent); background: #0c0f14; }
td.fc { color: #f6c453; } /* forecast cell tint */
.cellhint { font-size: 10px; color: var(--muted); }

/* Badges & bits */
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); }
.badge.income { color: var(--accent-2); border-color: rgba(110,231,183,.35); }
.badge.cost { color: var(--danger); border-color: rgba(255,107,107,.35); }
.badge.actual { color: var(--muted); }
.badge.forecast { color: #f6c453; border-color: rgba(246,196,83,.35); }
.badge.recurring { color: var(--accent); border-color: rgba(79,140,255,.35); }
.badge.type-za { color: var(--accent-2); border-color: rgba(110,231,183,.35); }
.badge.type-international { color: #f6c453; border-color: rgba(246,196,83,.35); }
.badge.type-freelancer { color: #c792ea; border-color: rgba(199,146,234,.35); }
.badge.kind-note { color: var(--muted); }
.badge.kind-achievement { color: var(--accent-2); border-color: rgba(110,231,183,.35); }
.badge.kind-verbal_warning { color: #f6c453; border-color: rgba(246,196,83,.35); }
.badge.kind-written_warning { color: var(--danger); border-color: rgba(255,107,107,.35); }
.badge.kind-change { color: var(--accent); border-color: rgba(79,140,255,.35); }
.badge.kind-contract { color: #c792ea; border-color: rgba(199,146,234,.35); }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.spread { justify-content: space-between; }
.formgrid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); align-items: end; }
.formgrid .full { grid-column: 1 / -1; }
input[type=number], select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: #0c0f14; color: var(--text); font-size: 14px; }
.btn-sm { padding: 6px 12px; font-size: 13px; }
.btn-danger { border-color: rgba(255,107,107,.4); color: var(--danger); }
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 16px 0; }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.callout { border-left: 3px solid var(--accent); background: var(--panel-2); padding: 12px 16px; border-radius: 8px; font-size: 13px; }
.section-block { margin-top: 26px; }
a.subnav { margin-right: 14px; font-weight: 600; }

/* Date field with native picker trigger */
.datewrap { position: relative; }
.datewrap input[type=text] { padding-right: 36px; }
.datewrap .dp { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; opacity: 0; cursor: pointer; padding: 0; border: 0; }
.datewrap .dpicon { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 14px; opacity: .75; }

/* Segmented control (Report / Capture) */
.segmented { display: inline-flex; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 4px; gap: 4px; }
.seg { padding: 7px 18px; border-radius: 7px; font-weight: 600; font-size: 14px; color: var(--muted); }
.seg:hover { color: var(--text); text-decoration: none; }
.seg.active { background: var(--accent); color: #fff; }
`;

const NAV = [
  { href: "/app", label: "Dashboard", key: "dashboard" },
  { href: "/app/payroll", label: "Payroll", key: "payroll" },
  { href: "/app/accounts", label: "Accounts", key: "accounts" },
  { href: "/app/expenses", label: "Expenses", key: "expenses" },
  { href: "/app/hr", label: "HR", key: "hr" },
];

export const Layout: FC<
  PropsWithChildren<{ title: string; authed?: boolean; section?: string; wide?: boolean }>
> = ({ title, authed, section, wide, children }) => (
  <html lang="en-ZA">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <title>{title} · Exco</title>
      <style dangerouslySetInnerHTML={{ __html: CSS + (wide ? WIDE_CSS : "") }} />
    </head>
    <body>
      <div class="topbar">
        <a class="brand" href={authed ? "/app" : "/"} style="color:var(--text)">
          <span class="logo">E</span>
          <span>Exco</span>
        </a>
        {authed ? (
          <nav class="mainnav">
            {NAV.map((n) => (
              <a href={n.href} class={section === n.key ? "navlink active" : "navlink"}>
                {n.label}
              </a>
            ))}
            <form method="post" action="/logout" style="margin:0 0 0 8px">
              <button class="btn btn-ghost" type="submit">Sign out</button>
            </form>
          </nav>
        ) : null}
      </div>
      {children}
      <div class="footer">Exco · Elula Online · internal use only</div>
    </body>
  </html>
);

const WIDE_CSS = `.container { max-width: 1320px; }`;

/**
 * dd/mm/yyyy text field with a native calendar picker: the invisible date
 * input sits over the icon; picking a date writes it back as dd/mm/yyyy.
 */
export const DateField: FC<{ name: string; value?: string }> = ({ name, value }) => (
  <div class="datewrap">
    <input type="text" name={name} value={value ?? ""} placeholder="dd/mm/yyyy" inputmode="numeric" autocomplete="off" />
    <input type="date" class="dp" tabindex={-1}
      onchange="var t=this.parentElement.querySelector('input[type=text]');if(this.value){var p=this.value.split('-');t.value=p[2]+'/'+p[1]+'/'+p[0];}" />
    <span class="dpicon">📅</span>
  </div>
);
