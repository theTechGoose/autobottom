/** GET: Fetch chargeback/wire deduction data for a date range, return table HTML. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface CbItem { date?: string; teamMember?: string; revenue?: string; crmLink?: string; findingId?: string; type?: string; failedQuestions?: string[]; }
interface WireItem { date?: string; score?: number; questions?: number; passed?: number; crmLink?: string; findingId?: string; office?: string; auditor?: string; guestName?: string; }

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = url.searchParams.get("tab") ?? "cb";
    const from = url.searchParams.get("cb-date-from") ?? "";
    const to = url.searchParams.get("cb-date-to") ?? "";

    if (tab === "wire") {
      let wires: WireItem[] = [];
      try { const d = await apiFetch<{ items?: WireItem[] }>(`/admin/wire-deductions?from=${from}&to=${to}`, ctx.req); wires = d.items ?? []; } catch {}

      const html = renderToString(
        <div>
          {wires.length === 0 ? (
            <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px 0;">No wire deductions found for this period.</div>
          ) : (
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--cyan);margin-bottom:10px;">Wire Deductions ({wires.length})</div>
              <table class="data-table">
                <thead><tr><th>Date</th><th>Score</th><th>Questions</th><th>Passed</th><th>CRM Link</th><th>Audit</th><th>Office</th><th>Auditor</th><th>Guest</th></tr></thead>
                <tbody>
                  {wires.map((w, i) => (
                    <tr key={i}>
                      <td>{w.date ?? "\u2014"}</td>
                      <td style="font-weight:700;">{w.score != null ? `${w.score}%` : "\u2014"}</td>
                      <td>{w.questions ?? "\u2014"}</td>
                      <td>{w.passed ?? "\u2014"}</td>
                      <td>{w.crmLink ? <a href={w.crmLink} target="_blank" class="tbl-link">CRM</a> : "\u2014"}</td>
                      <td>{w.findingId ? <a href={`/admin/audits?findingId=${w.findingId}`} class="tbl-link">{w.findingId.slice(0, 8)}</a> : "\u2014"}</td>
                      <td>{w.office ?? "\u2014"}</td>
                      <td>{w.auditor ?? "\u2014"}</td>
                      <td>{w.guestName ?? "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    // Chargebacks & Omissions tab
    let cbs: CbItem[] = [];
    let omissions: CbItem[] = [];
    try {
      const d = await apiFetch<{ chargebacks?: CbItem[]; omissions?: CbItem[] }>(`/admin/chargebacks?from=${from}&to=${to}`, ctx.req);
      cbs = d.chargebacks ?? [];
      omissions = d.omissions ?? [];
    } catch {}

    const html = renderToString(
      <div>
        {cbs.length === 0 && omissions.length === 0 ? (
          <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px 0;">No chargebacks or omissions found for this period.</div>
        ) : (
          <div>
            {cbs.length > 0 && (
              <div style="margin-bottom:32px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--red);margin-bottom:10px;">Chargebacks ({cbs.length})</div>
                <table class="data-table">
                  <thead><tr><th>Date</th><th>Team Member</th><th>Revenue</th><th>CRM Link</th><th>Audit</th><th>Type</th><th>Failed Questions</th></tr></thead>
                  <tbody>
                    {cbs.map((c, i) => (
                      <tr key={i}>
                        <td>{c.date ?? "\u2014"}</td>
                        <td style="font-weight:600;">{c.teamMember ?? "\u2014"}</td>
                        <td>{c.revenue ?? "\u2014"}</td>
                        <td>{c.crmLink ? <a href={c.crmLink} target="_blank" class="tbl-link">CRM</a> : "\u2014"}</td>
                        <td>{c.findingId ? <a href={`/admin/audits?findingId=${c.findingId}`} class="tbl-link">{c.findingId.slice(0, 8)}</a> : "\u2014"}</td>
                        <td><span class="pill pill-red">{c.type ?? "CB"}</span></td>
                        <td style="font-size:10px;max-width:200px;">{c.failedQuestions?.join(", ") ?? "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {omissions.length > 0 && (
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--yellow);margin-bottom:10px;">Omissions ({omissions.length})</div>
                <table class="data-table">
                  <thead><tr><th>Date</th><th>Team Member</th><th>Revenue</th><th>CRM Link</th><th>Audit</th><th>Type</th><th>Failed Questions</th></tr></thead>
                  <tbody>
                    {omissions.map((o, i) => (
                      <tr key={i}>
                        <td>{o.date ?? "\u2014"}</td>
                        <td style="font-weight:600;">{o.teamMember ?? "\u2014"}</td>
                        <td>{o.revenue ?? "\u2014"}</td>
                        <td>{o.crmLink ? <a href={o.crmLink} target="_blank" class="tbl-link">CRM</a> : "\u2014"}</td>
                        <td>{o.findingId ? <a href={`/admin/audits?findingId=${o.findingId}`} class="tbl-link">{o.findingId.slice(0, 8)}</a> : "\u2014"}</td>
                        <td><span class="pill pill-yellow">{o.type ?? "OM"}</span></td>
                        <td style="font-size:10px;max-width:200px;">{o.failedQuestions?.join(", ") ?? "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
