import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { type HrEmployee, type HrNote, type HrDocument, type NoteKind, NOTE_KINDS, KIND_LABEL } from "../data/hr";
import { hBars } from "../lib/charts";

// ---- tenure helpers -------------------------------------------------------

function monthsBetweenDates(a: Date, b: Date): number {
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0));
}

export function tenure(e: HrEmployee, now: Date): { months: number; label: string } {
  if (!e.start_date) return { months: 0, label: "—" };
  const start = new Date(e.start_date + "T00:00:00Z");
  const until = e.end_date ? new Date(e.end_date + "T00:00:00Z") : now;
  const m = monthsBetweenDates(start, until);
  const y = Math.floor(m / 12);
  const rem = m % 12;
  const label = y > 0 ? `${y}y ${rem}m` : `${rem}m`;
  return { months: m, label };
}

const fmtDate = (d: string | null) => (d ? d : "—");

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const KindBadge: FC<{ kind: NoteKind }> = ({ kind }) => <span class={`badge kind-${kind}`}>{KIND_LABEL[kind]}</span>;

// ---- headcount dashboard --------------------------------------------------

export const HrDashboard: FC<{
  employees: HrEmployee[];
  warnings: Map<string, number>;
  now: Date;
  show: "active" | "left" | "all";
}> = ({ employees, warnings, now, show }) => {
  const active = employees.filter((e) => !e.end_date);
  const left = employees.filter((e) => e.end_date);
  const visible = show === "active" ? active : show === "left" ? left : employees;

  const yearAgo = new Date(now.getTime() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const joins12 = employees.filter((e) => e.start_date && e.start_date >= yearAgo).length;
  const exits12 = left.filter((e) => e.end_date! >= yearAgo).length;
  const avgTenureM = active.length ? active.reduce((s, e) => s + tenure(e, now).months, 0) / active.length : 0;
  const avgTenure = `${Math.floor(avgTenureM / 12)}y ${Math.round(avgTenureM % 12)}m`;

  const byGroup = (key: (e: HrEmployee) => string | null) => {
    const m = new Map<string, number>();
    for (const e of active) {
      const k = key(e) || "Unassigned";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  return (
    <Layout title="HR" authed section="hr" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">HR · Headcount</h1>
            <p class="muted" style="margin-top:0">Who we have, where they are, and how long they've been with us.</p>
          </div>
          <a class="btn btn-sm" href="/app/hr/export.csv">⬇ Export CSV</a>
        </div>

        <div class="kpis section-block">
          <Kpi label="Active headcount" value={String(active.length)} sub={`${employees.length} on record`} />
          <Kpi label="Avg tenure (active)" value={avgTenure} />
          <Kpi label="Joined · last 12 mo" value={String(joins12)} tone="pos" />
          <Kpi label="Left · last 12 mo" value={String(exits12)} tone={exits12 > 0 ? "neg" : ""} />
        </div>

        <div class="grid section-block" style="grid-template-columns:1fr 1fr;gap:18px">
          <div class="card">
            <h3>Active by team</h3>
            <div dangerouslySetInnerHTML={{ __html: hBarsCount(byGroup((e) => e.team)) }} />
          </div>
          <div class="card">
            <h3>Active by position</h3>
            <div dangerouslySetInnerHTML={{ __html: hBarsCount(byGroup((e) => e.position)) }} />
          </div>
        </div>

        <div class="row spread section-block">
          <div class="segmented">
            <a href="/app/hr" class={show === "active" ? "seg active" : "seg"}>Active ({active.length})</a>
            <a href="/app/hr?show=left" class={show === "left" ? "seg active" : "seg"}>Left ({left.length})</a>
            <a href="/app/hr?show=all" class={show === "all" ? "seg active" : "seg"}>All</a>
          </div>
        </div>

        <div class="tablewrap" style="margin-top:12px">
          <table class="grid">
            <thead>
              <tr><th>Name</th><th>Position</th><th>Team</th><th>Manager</th><th>Started</th><th>Tenure</th><th>Status</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const w = warnings.get(e.id) ?? 0;
                return (
                  <tr>
                    <td><a href={`/app/hr/${e.id}`}>{e.name}</a></td>
                    <td class="muted">{e.position || "—"}</td>
                    <td class="muted">{e.team || "—"}</td>
                    <td class="muted">{e.manager || "—"}</td>
                    <td>{fmtDate(e.start_date)}</td>
                    <td>{tenure(e, now).label}</td>
                    <td>{e.end_date ? <span class="badge cost">left {e.end_date}</span> : <span class="badge income">active</span>}</td>
                    <td>{w > 0 ? <span class="badge kind-written_warning">⚠ {w}</span> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div class="section-block card">
          <h3>Add employee</h3>
          <form method="post" action="/app/hr/employee" class="formgrid">
            <div><label>Name</label><input type="text" name="name" required /></div>
            <div><label>Email</label><input type="text" name="email" /></div>
            <div><label>Position</label><input type="text" name="position" /></div>
            <div><label>Team</label><input type="text" name="team" /></div>
            <div><label>Manager</label><input type="text" name="manager" /></div>
            <div><label>Start date</label><input type="date" name="start_date" /></div>
            <div><button class="btn btn-primary" type="submit">Add</button></div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

/** Count variant of hBars (no currency formatting). */
function hBarsCount(items: { label: string; value: number }[]): string {
  const W = 400;
  const rowH = 30;
  const H = Math.max(rowH, items.length * rowH) + 8;
  const labelW = 150;
  const barMax = W - labelW - 50;
  const max = Math.max(1, ...items.map((i) => i.value));
  let out = "";
  items.forEach((it, i) => {
    const y = 6 + i * rowH;
    const w = (it.value / max) * barMax;
    const esc = it.label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    out += `<text x="0" y="${y + 15}" fill="#9aa7b4" font-size="12">${esc.slice(0, 20)}</text>`;
    out += `<rect x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="16" rx="3" fill="#4f8cff" opacity="0.85"/>`;
    out += `<text x="${labelW + w + 6}" y="${y + 16}" fill="#e6edf3" font-size="12">${it.value}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" font-family="-apple-system,Segoe UI,Roboto,sans-serif" role="img">${out}</svg>`;
}

// ---- employee file --------------------------------------------------------

export const HrEmployeePage: FC<{
  emp: HrEmployee;
  notes: HrNote[];
  docs: Map<string, HrDocument[]>;
  now: Date;
  saved?: boolean;
}> = ({ emp, notes, docs, now, saved }) => {
  const t = tenure(emp, now);
  const warnings = notes.filter((n) => n.kind === "verbal_warning" || n.kind === "written_warning").length;
  return (
    <Layout title={emp.name} authed section="hr" wide>
      <div class="container">
        <p style="margin:12px 0 0"><a href="/app/hr">← Headcount</a></p>
        <div class="row spread">
          <h1 style="margin-top:8px">{emp.name}</h1>
          {emp.end_date ? <span class="badge cost" style="font-size:13px">left {emp.end_date}</span> : <span class="badge income" style="font-size:13px">active</span>}
        </div>
        <p class="muted" style="margin-top:0">
          {emp.position || "—"} · {emp.team || "no team"} · manager: {emp.manager || "—"}
        </p>

        {saved ? <div class="callout section-block">✓ Saved.</div> : null}

        <div class="kpis section-block">
          <Kpi label="Started" value={fmtDate(emp.start_date)} />
          <Kpi label="Tenure" value={t.label} sub={emp.end_date ? "at leaving" : "and counting"} />
          <Kpi label="File entries" value={String(notes.length)} />
          <Kpi label="Warnings" value={String(warnings)} tone={warnings > 0 ? "neg" : ""} />
        </div>

        <div class="grid section-block" style="grid-template-columns:1fr 1.6fr;gap:18px">
          <div>
            <div class="card">
              <h3>Details</h3>
              <form method="post" action={`/app/hr/${emp.id}/update`} class="formgrid" style="grid-template-columns:1fr">
                <div><label>Name</label><input type="text" name="name" value={emp.name} required /></div>
                <div><label>Email</label><input type="text" name="email" value={emp.email ?? ""} /></div>
                <div><label>Position</label><input type="text" name="position" value={emp.position ?? ""} /></div>
                <div><label>Team</label><input type="text" name="team" value={emp.team ?? ""} /></div>
                <div><label>Manager</label><input type="text" name="manager" value={emp.manager ?? ""} /></div>
                <div><label>Start date</label><input type="date" name="start_date" value={emp.start_date ?? ""} /></div>
                <div><label>Last working day (blank = active)</label><input type="date" name="end_date" value={emp.end_date ?? ""} /></div>
                <div><button class="btn btn-primary" type="submit">Save details</button></div>
              </form>
            </div>
          </div>

          <div>
            <div class="card">
              <h3>Add to file</h3>
              <form method="post" action={`/app/hr/${emp.id}/note`} enctype="multipart/form-data">
                <div class="formgrid">
                  <div><label>Type</label>
                    <select name="kind">
                      {[...NOTE_KINDS]
                        .sort((a, b) => KIND_LABEL[a].localeCompare(KIND_LABEL[b]))
                        .map((k) => <option value={k} selected={k === "note"}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <div><label>Date</label><input type="date" name="note_date" value={now.toISOString().slice(0, 10)} /></div>
                  <div class="full"><label>Title</label><input type="text" name="title" required placeholder="e.g. Signed 2026 contract / Exceeded Q2 targets / Late delivery discussion" /></div>
                  <div class="full"><label>Details</label><textarea name="body" rows={3}></textarea></div>
                  <div class="full"><label>Attachments (documents / images)</label><input type="file" name="files" multiple style="font-size:13px" /></div>
                  <div><button class="btn btn-primary" type="submit">Add entry</button></div>
                </div>
              </form>
            </div>

            <div class="section-block">
              <h3>History</h3>
              {notes.length === 0 ? <p class="muted">Nothing on file yet.</p> : null}
              {notes.map((n) => {
                const atts = docs.get(n.id) ?? [];
                return (
                  <div class="card" style="margin-bottom:12px">
                    <div class="row spread">
                      <div class="row" style="gap:10px">
                        <KindBadge kind={n.kind} />
                        <strong>{n.title}</strong>
                      </div>
                      <div class="row" style="gap:10px">
                        <span class="muted" style="font-size:12px">{n.note_date ?? n.created_at.slice(0, 10)}</span>
                        <form method="post" action="/app/hr/note/delete" style="margin:0"
                          onsubmit="return confirm('Delete this entry and its attachments?')">
                          <input type="hidden" name="id" value={n.id} />
                          <input type="hidden" name="emp" value={emp.id} />
                          <button class="btn btn-sm btn-danger" type="submit">✕</button>
                        </form>
                      </div>
                    </div>
                    {n.body ? <p style="margin:10px 0 0;white-space:pre-wrap">{n.body}</p> : null}
                    {atts.length > 0 ? (
                      <div class="row" style="gap:10px;margin-top:12px;flex-wrap:wrap">
                        {atts.map((d) =>
                          d.content_type?.startsWith("image/") ? (
                            <a href={`/app/hr/file/${d.id}`} target="_blank">
                              <img src={`/app/hr/file/${d.id}`} alt={d.filename} style="max-height:120px;max-width:200px;border-radius:8px;border:1px solid var(--border)" />
                            </a>
                          ) : (
                            <a class="btn btn-sm" href={`/app/hr/file/${d.id}`} target="_blank">📄 {d.filename}</a>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
