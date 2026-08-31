import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { VendorSummary } from "../lib/xero";
import type { VendorRule } from "../data/expenses";
import { formatZAR, formatZARCompact } from "../lib/money";

export type AnnotatedVendor = VendorSummary & {
  rule: VendorRule | null;
  autoExcludeReason: string | null; // payroll match / contractor prefix (suggestion when no explicit rule)
  effective: "track" | "exclude" | "auto-track" | "ignored"; // what the next sync will do
};

export const VendorReviewPage: FC<{
  vendors: AnnotatedVendor[];
  monthCols: string[]; // 'YYYY-MM' ascending
  monthsBack: number;
  minMonths: number;
  msg?: string;
}> = ({ vendors, monthCols, monthsBack, minMonths, msg }) => {
  const tracked = vendors.filter((v) => v.effective === "track" || v.effective === "auto-track");
  const monthlyTotal = tracked.reduce((s, v) => s + v.avgMonthly, 0);
  return (
    <Layout title="Vendor review" authed section="expenses" wide>
      <div class="container">
        <p style="margin:12px 0 0"><a href="/app/expenses">← Recurring expenses</a></p>
        <div class="row spread">
          <div>
            <h1 style="margin-top:8px">Vendor review</h1>
            <p class="muted" style="margin-top:0">
              Every supplier billed in the last {monthsBack} months, from Xero. Choose what counts as recurring —
              your choices stick and drive every future sync (including the automatic monthly one).
            </p>
          </div>
        </div>

        {msg ? <div class="callout section-block">{msg}</div> : null}

        <div class="callout section-block">
          <strong>How it decides:</strong> <span class="badge income">track</span> and{" "}
          <span class="badge cost">exclude</span> are your picks and always win. Unpicked vendors billed in{" "}
          {minMonths}+ months are tracked automatically; the rest are ignored. Vendors matching payroll names or
          contractor prefixes are excluded automatically. Currently tracking <strong>{tracked.length}</strong> vendors ≈{" "}
          <strong>{formatZAR(monthlyTotal)}/mo</strong>.
        </div>

        <div class="tablewrap section-block">
          <table class="grid">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Status</th>
                <th style="text-align:left">Actions</th>
                <th>Avg / mo</th>
                <th>Months</th>
                {monthCols.map((m) => <th>{m.slice(2).replace("-", "/")}</th>)}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr style={v.effective === "exclude" || v.effective === "ignored" ? "opacity:.5" : ""}>
                  <td>{v.name}</td>
                  <td style="text-align:left">
                    {v.effective === "track" ? <span class="badge income">tracked</span>
                      : v.effective === "auto-track" ? <span class="badge income">auto</span>
                      : v.effective === "exclude" ? <span class="badge cost" title={v.rule?.reason ?? v.autoExcludeReason ?? ""}>excluded{v.rule?.reason === "payroll match" || v.autoExcludeReason === "payroll match" ? " · payroll" : v.rule?.reason === "contractor prefix" || v.autoExcludeReason === "contractor prefix" ? " · contractor" : ""}</span>
                      : <span class="badge actual">ignored (&lt;{minMonths} mo)</span>}
                  </td>
                  <td style="text-align:left">
                    <div class="row" style="gap:6px">
                      {v.effective !== "track" && v.effective !== "auto-track" ? (
                        <form method="post" action="/app/expenses/vendor-rule" style="margin:0">
                          <input type="hidden" name="key" value={v.key} />
                          <input type="hidden" name="name" value={v.name} />
                          <input type="hidden" name="rule" value="track" />
                          <button class="btn btn-sm" type="submit">Track</button>
                        </form>
                      ) : null}
                      {v.effective !== "exclude" ? (
                        <form method="post" action="/app/expenses/vendor-rule" style="margin:0">
                          <input type="hidden" name="key" value={v.key} />
                          <input type="hidden" name="name" value={v.name} />
                          <input type="hidden" name="rule" value="exclude" />
                          <button class="btn btn-sm btn-danger" type="submit">Exclude</button>
                        </form>
                      ) : null}
                      {v.rule ? (
                        <form method="post" action="/app/expenses/vendor-rule" style="margin:0">
                          <input type="hidden" name="key" value={v.key} />
                          <input type="hidden" name="name" value={v.name} />
                          <input type="hidden" name="rule" value="clear" />
                          <button class="btn btn-sm" type="submit" title="Back to automatic">Auto</button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                  <td class="num"><strong>{formatZAR(v.avgMonthly)}</strong></td>
                  <td class="num">{v.monthCount}/{monthsBack}</td>
                  {monthCols.map((m) => (
                    <td class="num muted">{v.months[m] ? formatZARCompact(v.months[m]) : "·"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div class="toolbar">
          <form method="post" action="/app/expenses/sync" style="margin:0">
            <button class="btn btn-primary" type="submit">Apply &amp; sync now</button>
          </form>
          <span class="muted" style="font-size:12px">Sync also runs automatically on the 1st of every month.</span>
        </div>
      </div>
    </Layout>
  );
};
