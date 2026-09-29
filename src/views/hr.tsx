import type { FC } from "hono/jsx";
import { Layout, DateField } from "./layout";
import { type HrEmployee, type HrNote, type HrDocument, type NoteKind, NOTE_KINDS, KIND_LABEL } from "../data/hr";
import { hBars } from "../lib/charts";
import { formatDMY } from "../lib/period";

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

const fmtDate = (d: string | null) => formatDMY(d);

const Kpi: FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div class="kpi">
    <div class="k-label">{label}</div>
    <div class={`k-value ${tone ?? ""}`}>{value}</div>
    {sub ? <div class="k-sub muted">{sub}</div> : null}
  </div>
);

const KindBadge: FC<{ kind: NoteKind }> = ({ kind }) => <span class={`badge kind-${kind}`}>{KIND_LABEL[kind]}</span>;

const KindOptions: FC<{ selected: NoteKind }> = ({ selected }) => (
  <>
    {[...NOTE_KINDS]
      .sort((a, b) => KIND_LABEL[a].localeCompare(KIND_LABEL[b]))
      .map((k) => (
        <option value={k} selected={k === selected}>{KIND_LABEL[k]}</option>
      ))}
  </>
);

// Wires the Details box so pasted screenshots/images upload as attachments, and
// toggles the per-entry edit form. Applies to every current + future page use.
const HR_SCRIPT = `
document.querySelectorAll('form.hr-note').forEach(function(form){
  var ta = form.querySelector('textarea.paste-body');
  var fileInput = form.querySelector('input[type=file]');
  var previews = form.querySelector('.paste-previews');
  if(!fileInput) return;
  var dt = new DataTransfer();
  fileInput.addEventListener('change', function(){
    for(var j=0;j<fileInput.files.length;j++){
      var f=fileInput.files[j], dup=false;
      for(var k=0;k<dt.items.length;k++){ if(dt.files[k].name===f.name && dt.files[k].size===f.size){dup=true;break;} }
      if(!dup) dt.items.add(f);
    }
    fileInput.files = dt.files;
  });
  if(!ta) return;
  ta.addEventListener('paste', function(e){
    var items = (e.clipboardData||window.clipboardData||{}).items; if(!items) return;
    for(var i=0;i<items.length;i++){
      var it=items[i];
      if(it.kind==='file' && it.type.indexOf('image/')===0){
        var blob=it.getAsFile(); if(!blob) continue;
        var ext=(it.type.split('/')[1]||'png').split('+')[0];
        var file=new File([blob], 'pasted-'+Date.now()+'-'+i+'.'+ext, {type:it.type});
        dt.items.add(file); fileInput.files=dt.files;
        if(previews){
          var img=document.createElement('img'); img.src=URL.createObjectURL(file);
          img.style.cssText='max-height:70px;border-radius:6px;border:1px solid var(--border)';
          previews.appendChild(img);
        }
      }
    }
  });
});
document.querySelectorAll('[data-edit-toggle]').forEach(function(btn){
  btn.addEventListener('click', function(){
    var card=btn.closest('.hist-card'); if(!card) return;
    var v=card.querySelector('.view-mode'), f=card.querySelector('.edit-form');
    v.hidden=!v.hidden; f.hidden=!f.hidden;
  });
});
`;

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
    <Layout title="HR" authed section="people" wide>
      <div class="container">
        <div class="row spread">
          <div>
            <div class="segmented" style="margin:12px 0 10px">
              <a href="/app/payroll" class="seg">Payroll report</a>
              <a href="/app/payroll/capture" class="seg">Capture</a>
              <a href="/app/hr" class="seg active">Employees</a>
            </div>
            <h1 style="margin:0 0 8px">People · Employees</h1>
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
                    <td>{e.end_date ? <span class="badge cost">left {formatDMY(e.end_date)}</span> : <span class="badge income">active</span>}</td>
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
            <div><label>Start date</label><DateField name="start_date" /></div>
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
  payroll?: { status: string; paidThrough: string | null } | null; // matched payroll record
  now: Date;
  saved?: boolean;
}> = ({ emp, notes, docs, payroll, now, saved }) => {
  const t = tenure(emp, now);
  const warnings = notes.filter((n) => n.kind === "verbal_warning" || n.kind === "written_warning").length;
  return (
    <Layout title={emp.name} authed section="people" wide>
      <div class="container">
        <p style="margin:12px 0 0"><a href="/app/hr">← Headcount</a></p>
        <div class="row spread">
          <h1 style="margin-top:8px">{emp.name}</h1>
          {emp.end_date ? <span class="badge cost" style="font-size:13px">left {formatDMY(emp.end_date)}</span> : <span class="badge income" style="font-size:13px">active</span>}
        </div>
        <p class="muted" style="margin-top:0">
          {emp.position || "—"} · {emp.team || "no team"} · manager: {emp.manager || "—"}
        </p>

        {saved ? <div class="callout section-block">✓ Saved.</div> : null}

        <div class="kpis section-block">
          <Kpi label="Started" value={fmtDate(emp.start_date)} />
          <Kpi label="Tenure" value={t.label} sub={emp.end_date ? "at leaving" : "and counting"} />
          {payroll ? (
            <Kpi label="Payroll" value={payroll.paidThrough ? `Paid through ${payroll.paidThrough}` : "Active"}
              tone={payroll.paidThrough ? "warn" : "pos"} sub="from the Payroll register" />
          ) : null}
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
                <div><label>Start date</label><DateField name="start_date" value={emp.start_date ? formatDMY(emp.start_date) : ""} /></div>
                <div><label>Last working day (blank = active)</label><DateField name="end_date" value={emp.end_date ? formatDMY(emp.end_date) : ""} /></div>
                <div><button class="btn btn-primary" type="submit">Save details</button></div>
              </form>
            </div>
          </div>

          <div>
            <div class="card">
              <h3>Add to file</h3>
              <form method="post" action={`/app/hr/${emp.id}/note`} enctype="multipart/form-data" class="hr-note">
                <div class="formgrid">
                  <div><label>Type</label>
                    <select name="kind"><KindOptions selected="note" /></select>
                  </div>
                  <div><label>Date</label><DateField name="note_date" value={formatDMY(now.toISOString().slice(0, 10))} /></div>
                  <div class="full"><label>Title</label><input type="text" name="title" required placeholder="e.g. Signed 2026 contract / Exceeded Q2 targets / Late delivery discussion" /></div>
                  <div class="full"><label>Details</label>
                    <textarea name="body" rows={3} class="paste-body" placeholder="Type here. You can paste screenshots or images straight in — they'll be attached."></textarea>
                    <div class="paste-previews row" style="gap:8px;margin-top:8px"></div>
                  </div>
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
                  <div class="card hist-card" style="margin-bottom:12px">
                    <div class="view-mode">
                      <div class="row spread">
                        <div class="row" style="gap:10px">
                          <KindBadge kind={n.kind} />
                          <strong>{n.title}</strong>
                        </div>
                        <div class="row" style="gap:10px">
                          <span class="muted" style="font-size:12px">{formatDMY(n.note_date ?? n.created_at.slice(0, 10))}</span>
                          {n.updated_at ? <span class="muted" style="font-size:11px">· edited {formatDMY(n.updated_at.slice(0, 10))}</span> : null}
                          <button type="button" class="btn btn-sm" data-edit-toggle>Edit</button>
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

                    <form method="post" action={`/app/hr/${emp.id}/note/${n.id}`} enctype="multipart/form-data" class="hr-note edit-form" hidden>
                      <div class="formgrid">
                        <div><label>Type</label>
                          <select name="kind"><KindOptions selected={n.kind} /></select>
                        </div>
                        <div><label>Date</label><DateField name="note_date" value={formatDMY(n.note_date ?? n.created_at.slice(0, 10))} /></div>
                        <div class="full"><label>Title</label><input type="text" name="title" required value={n.title} /></div>
                        <div class="full"><label>Details</label>
                          <textarea name="body" rows={3} class="paste-body" placeholder="Type here. You can paste screenshots or images straight in — they'll be attached.">{n.body ?? ""}</textarea>
                          <div class="paste-previews row" style="gap:8px;margin-top:8px"></div>
                        </div>
                        <div class="full"><label>Add attachments (documents / images)</label><input type="file" name="files" multiple style="font-size:13px" /></div>
                        <div class="row" style="gap:10px">
                          <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
                          <button type="button" class="btn btn-sm btn-ghost" data-edit-toggle>Cancel</button>
                        </div>
                      </div>
                    </form>
                  </div>
                );
              })}
            </div>
            <script dangerouslySetInnerHTML={{ __html: HR_SCRIPT }} />
          </div>
        </div>
      </div>
    </Layout>
  );
};
