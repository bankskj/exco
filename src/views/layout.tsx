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
.grid { display: grid; gap: 18px; }
@media (min-width: 720px) { .grid-3 { grid-template-columns: repeat(3, 1fr); } }
label { display: block; font-size: 14px; color: var(--muted); margin-bottom: 6px; }
input[type=password], input[type=text] {
  width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);
  background: #0c0f14; color: var(--text); font-size: 15px;
}
input:focus { outline: none; border-color: var(--accent); }
.error { color: var(--danger); font-size: 14px; margin-top: 10px; }
.footer { color: var(--muted); font-size: 13px; text-align: center; padding: 40px 0 24px; }
.section-icon { font-size: 26px; }
h1 { font-size: 30px; margin: 0 0 8px; }
h2 { font-size: 20px; margin: 0 0 6px; }
`;

export const Layout: FC<PropsWithChildren<{ title: string; authed?: boolean }>> = ({
  title,
  authed,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <title>{title} · Exco</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <div class="topbar">
        <a class="brand" href="/" style="color:var(--text)">
          <span class="logo">E</span>
          <span>Exco</span>
        </a>
        {authed ? (
          <form method="post" action="/logout" style="margin:0">
            <button class="btn btn-ghost" type="submit">Sign out</button>
          </form>
        ) : null}
      </div>
      {children}
      <div class="footer">Exco · Elula Online · internal use only</div>
    </body>
  </html>
);
