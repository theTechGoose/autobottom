/** Reviewer Throughput modal fragment — compact by-reviewer summary + a link to
 *  the full-page report. POSTed from the preset bar (GET for initial load).
 *  Mirrors the engagement fragment. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { resolveRange } from "../../../../../lib/report-range.ts";
import { renderToString } from "preact-render-to-string";

interface ByReviewer {
  email: string; reviewed: number; avgScore: number; timedAudits: number;
  avgHandleMs: number; avgPerQuestionMs: number; auditsPerActiveHour: number;
}
interface Resp {
  aggregate: { reviewers: number; totalAudits: number; timedAudits: number; avgHandleMs: number; avgPerQuestionMs: number; auditsPerActiveHour: number };
  byReviewer: ByReviewer[];
}

function fmtMs(ms?: number): string {
  if (ms == null || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function renderThroughput(req: Request, preset: string, customFrom: string, customTo: string): Promise<string> {
  const { since, until, label } = resolveRange(preset, customFrom, customTo);
  let r: Resp;
  try {
    r = await apiFetch<Resp>(`/admin/reviewer-throughput/detail?since=${since}&until=${until}`, req);
  } catch (e) {
    return renderToString(
      <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
        Failed: {String((e as Error).message ?? e)}
      </div>,
    );
  }
  const a = r.aggregate;
  const top = (r.byReviewer ?? []).slice(0, 8);

  return renderToString(
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px;background:var(--bg);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);">
          Reviewer Throughput — {label} · {a.totalAudits.toLocaleString()} audits · {a.reviewers} reviewers
        </div>
        <a href={`/admin/reviewer-throughput?since=${since}&until=${until}`} target="_blank" rel="noopener"
          class="sf-btn ghost" style="font-size:11px;padding:4px 10px;text-decoration:none;white-space:nowrap;">Open full report ↗</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
        <Mini label="Avg handle / audit" value={fmtMs(a.avgHandleMs)} />
        <Mini label="Avg / question" value={fmtMs(a.avgPerQuestionMs)} />
        <Mini label="Audits / active hr" value={a.auditsPerActiveHour ? String(a.auditsPerActiveHour) : "—"} />
      </div>
      <table class="data-table" style="width:100%;font-size:11px;">
        <thead>
          <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
            <th style="padding:6px 8px;">Reviewer</th>
            <th style="padding:6px 8px;width:70px;">Audits</th>
            <th style="padding:6px 8px;width:90px;">Avg handle</th>
            <th style="padding:6px 8px;width:90px;">Avg/q</th>
          </tr>
        </thead>
        <tbody>
          {top.length === 0 && (
            <tr><td colSpan={4} style="padding:12px;text-align:center;color:var(--text-dim);">No reviewer activity in this window.</td></tr>
          )}
          {top.map((x) => (
            <tr key={x.email} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
              <td style="padding:6px 8px;color:var(--text-bright);">{x.email}</td>
              <td style="padding:6px 8px;font-weight:600;">{x.reviewed.toLocaleString()}</td>
              <td style="padding:6px 8px;color:var(--cyan);">{x.timedAudits ? fmtMs(x.avgHandleMs) : "—"}</td>
              <td style="padding:6px 8px;color:var(--green);">{x.timedAudits ? fmtMs(x.avgPerQuestionMs) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">
        Handle time = active on-screen time per question (idle &gt;60s / tab-away discarded). Forward-only.
        Open the full report for the by-question breakdown, the question filter, and per-reviewer drill-down.
      </div>
    </div>,
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">{label}</div>
      <div style="font-size:18px;font-weight:700;color:var(--text-bright);font-variant-numeric:tabular-nums;">{value}</div>
    </div>
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const sp = new URL(ctx.req.url).searchParams;
    const preset = sp.get("preset") ?? "today";
    const html = await renderThroughput(ctx.req, preset, sp.get("custom-from") ?? "", sp.get("custom-to") ?? "");
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const preset = String(form.get("preset") ?? "today");
    const customFrom = String(form.get("custom-from") ?? "");
    const customTo = String(form.get("custom-to") ?? "");
    const html = await renderThroughput(ctx.req, preset, customFrom, customTo);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
