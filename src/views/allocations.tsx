import type { FC } from "hono/jsx";
import { Layout, Info } from "./layout";
import { formatZAR } from "../lib/money";
import { label, addMonths } from "../lib/period";

/** Cents → whole-rand display. */
const R = (c: number) => formatZAR(Math.round(c / 100));

export type AllocationsPageProps = {
  /** The month being edited, YYYY-MM. */
  period: string;
  /** Recent periods for the month-picker row. */
  months: string[];
  staff: { employeeId: string; name: string; costC: number; estimated: boolean }[];
  /** The 12 default projects, then extra open projects. */
  columns: { projectId: string; label: string }[];
  /** employeeId → projectId → pct. */
  cells: Record<string, Record<string, number>>;
  /** employeeId → overhead pct. */
  overheadPct: Record<string, number>;
  /** When no rows exist for `period`, the period the shown values carry forward from. */
  carriedFrom: string | null;
  saved: boolean;
  error: string | null;
};

const ROW_SCRIPT = `(function(){
  var btn=document.getElementById('alloc-save');
  function recalc(){
    var bad=false;
    document.querySelectorAll('tr[data-emp]').forEach(function(tr){
      var sum=0;
      tr.querySelectorAll('input[data-pct]').forEach(function(i){
        var v=parseFloat((i.value||'').replace(',','.'));
        if(isFinite(v))sum+=v;
      });
      var rem=Math.round((100-sum)*100)/100;
      var cell=tr.querySelector('td[data-rem]');
      if(cell){cell.textContent=(rem===0?'0':rem)+'%';cell.style.color=rem<0?'var(--danger)':'';}
      if(sum>100.0001){bad=true;tr.style.background='rgba(255,107,107,.1)';}
      else{tr.style.background='';}
    });
    if(btn)btn.disabled=bad;
  }
  document.querySelectorAll('input[data-pct]').forEach(function(i){i.addEventListener('input',recalc);});
  recalc();
})();`;

/**
 * Monthly staff-allocation grid — one % cell per staff member × project (plus
 * Overhead), posted as a single form. Rows over 100% go red and block saving
 * client-side; the route re-validates.
 */
export const AllocationsPage: FC<AllocationsPageProps> = ({
  period,
  months,
  staff,
  columns,
  cells,
  overheadPct,
  carriedFrom,
  saved,
  error,
}) => {
  const pctOf = (employeeId: string, projectId: string): number => cells[employeeId]?.[projectId] ?? 0;
  const rowSum = (employeeId: string): number =>
    columns.reduce((s, c) => s + pctOf(employeeId, c.projectId), 0) + (overheadPct[employeeId] ?? 0);
  const pctVal = (v: number): string => (v ? String(v) : "");

  return (
    <Layout title="Allocations" authed section="clients" wide>
      <div class="container" style="max-width:1320px">
        <div class="row spread">
          <div>
            <h1 style="margin-top:12px">Staff allocations</h1>
            <p class="muted" style="margin-top:0">
              Where did each person's month go? Percentages per project; the remainder lands on the client's default
              project via each person's default target.{" "}
              <Info text="A row may total under 100% — the remainder follows the staff member's default target (general or overhead). Over 100% is an error and is rejected." />
            </p>
          </div>
          <a class="btn btn-sm" style="margin-top:16px" href="/app/clients">← Clients</a>
        </div>

        <div class="segmented section-block" style="flex-wrap:wrap">
          {months.map((m) => (
            <a href={`/app/allocations?period=${m}`} class={m === period ? "seg active" : "seg"}>{label(m)}</a>
          ))}
        </div>

        {error ? (
          <div class="callout section-block" style="border-left-color:var(--danger)">
            <strong class="neg">Not saved:</strong> {error}
          </div>
        ) : null}
        {saved ? (
          <p style="margin:14px 0 0"><span class="badge income">✓ Saved</span></p>
        ) : null}
        {carriedFrom ? (
          <div class="callout section-block">
            No rows for <strong>{label(period)}</strong> — showing <strong>{label(carriedFrom)}</strong> (carry-forward).
            Saving writes them to {label(period)}.
          </div>
        ) : null}

        <form method="post" action="/app/allocations/save" class="section-block">
          <input type="hidden" name="period" value={period} />
          <div class="tablewrap">
            <table class="grid">
              <thead>
                <tr>
                  <th style="text-align:left">Staff member</th>
                  <th>Cost</th>
                  {columns.map((c) => <th>{c.label}</th>)}
                  <th>Overhead</th>
                  <th title="100 − allocated %">Remainder</th>
                </tr>
              </thead>
              <tbody>
                {staff.length === 0 ? (
                  <tr>
                    <td colspan={columns.length + 4} style="text-align:left" class="muted">
                      No staff with cost in {label(period)} yet. People appear here once a Xero payment matches one of
                      their <a href="/app/clients/settings#staff">payee aliases</a> or a payroll amount is captured for
                      the month in <a href="/app/payroll/capture">Payroll</a>.
                    </td>
                  </tr>
                ) : null}
                {staff.map((s) => {
                  const rem = Math.round((100 - rowSum(s.employeeId)) * 100) / 100;
                  return (
                    <tr data-emp={s.employeeId}>
                      <td style="text-align:left">
                        <strong>{s.name}</strong>
                        {s.estimated ? <span class="badge estimate" style="margin-left:8px">estimated</span> : null}
                      </td>
                      <td class="num muted">{R(s.costC)}</td>
                      {columns.map((c) => (
                        <td class="num">
                          <input
                            name={`a::${s.employeeId}::${c.projectId}`}
                            value={pctVal(pctOf(s.employeeId, c.projectId))}
                            size={4}
                            inputmode="decimal"
                            autocomplete="off"
                            data-pct="1"
                          />
                        </td>
                      ))}
                      <td class="num">
                        <input
                          name={`a::${s.employeeId}::overhead`}
                          value={pctVal(overheadPct[s.employeeId] ?? 0)}
                          size={4}
                          inputmode="decimal"
                          autocomplete="off"
                          data-pct="1"
                        />
                      </td>
                      <td class={`num muted ${rem < 0 ? "neg" : ""}`} data-rem="1">{rem}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="toolbar">
            <button id="alloc-save" class="btn btn-primary" type="submit">Save {label(period)}</button>
          </div>
        </form>

        <div class="row" style="gap:10px">
          <form method="post" action="/app/allocations/copy" style="margin:0">
            <input type="hidden" name="period" value={period} />
            <input type="hidden" name="from" value={addMonths(period, -1)} />
            <button class="btn btn-sm" type="submit">Copy previous month</button>
          </form>
          <form
            method="post"
            action="/app/allocations/clear"
            style="margin:0"
            onsubmit={`return confirm('Clear all allocation rows for ${label(period)}?')`}
          >
            <input type="hidden" name="period" value={period} />
            <button class="btn btn-sm btn-danger" type="submit">Clear month</button>
          </form>
        </div>

        <script dangerouslySetInnerHTML={{ __html: ROW_SCRIPT }} />
      </div>
    </Layout>
  );
};
