/** HTMX fragment — finding detail (transcript snippet, Q&A, agent, score).
 *  Tries the manager-scoped endpoint first; falls back to the generic audit
 *  endpoint when the manager one is incomplete. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface AnsweredQuestion { question?: string; answer?: string; reason?: string; }
interface Finding {
  findingId?: string;
  owner?: string;
  recordingId?: string;
  recordingIdField?: string;
  rawTranscript?: string;
  diarizedTranscript?: string;
  answeredQuestions?: AnsweredQuestion[];
  record?: Record<string, unknown>;
  completedAt?: number;
  findingStatus?: string;
}

function pillColor(answer?: string): string {
  return answer === "Yes" ? "green" : answer === "No" ? "red" : "blue";
}

function score(qs: AnsweredQuestion[]): number {
  if (qs.length === 0) return 0;
  const yes = qs.filter((q) => q.answer === "Yes").length;
  return Math.round((yes / qs.length) * 100);
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("findingId") ?? "";
    if (!findingId) {
      return new Response(`<div class="error-text">findingId required</div>`, { headers: { "content-type": "text/html" } });
    }
    let f: Finding | null = null;
    try {
      const resp = await apiFetch<Finding | { error: string }>(`/manager/api/finding?findingId=${encodeURIComponent(findingId)}`, ctx.req);
      if (!("error" in resp)) f = resp as Finding;
    } catch { /* fall through */ }
    if (!f || !f.answeredQuestions) {
      try {
        f = await apiFetch<Finding>(`/audit/finding?id=${encodeURIComponent(findingId)}`, ctx.req);
      } catch (e) {
        return new Response(`<div class="error-text">Failed to load finding: ${e}</div>`, { headers: { "content-type": "text/html" } });
      }
    }
    if (!f) {
      return new Response(`<div class="error-text">Not found</div>`, { headers: { "content-type": "text/html" } });
    }

    const qs = f.answeredQuestions ?? [];
    const transcriptText = f.diarizedTranscript ?? f.rawTranscript ?? "";
    const transcriptSnippet = transcriptText.length > 600 ? transcriptText.slice(0, 600) + "\u2026" : transcriptText;
    const recordId = String((f.record as { RecordId?: unknown })?.RecordId ?? "");

    const html = renderToString(
      <div style="padding:8px 0;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px;">
          <div><div style="color:var(--text-muted);font-size:11px;">Agent</div><div style="font-weight:600;">{f.owner ?? "\u2014"}</div></div>
          <div><div style="color:var(--text-muted);font-size:11px;">Score</div><div style="font-weight:600;"><span class={`pill pill-${score(qs) >= 90 ? "green" : score(qs) >= 70 ? "yellow" : "red"}`}>{score(qs)}%</span></div></div>
          <div><div style="color:var(--text-muted);font-size:11px;">Recording</div><div class="mono" style="font-size:12px;">{f.recordingId ?? "\u2014"}</div></div>
          <div><div style="color:var(--text-muted);font-size:11px;">Record</div><div class="mono" style="font-size:12px;">{recordId || "\u2014"}</div></div>
          <div><div style="color:var(--text-muted);font-size:11px;">Type</div><div><span class={`pill ${f.recordingIdField === "GenieNumber" ? "pill-purple" : "pill-blue"}`}>{f.recordingIdField === "GenieNumber" ? "partner" : "internal"}</span></div></div>
          <div><div style="color:var(--text-muted);font-size:11px;">Status</div><div>{f.findingStatus ?? "\u2014"}</div></div>
        </div>

        <div style="margin-bottom:14px;">
          <div class="tbl-title" style="margin-bottom:6px;">Transcript Snippet</div>
          <pre style="white-space:pre-wrap;font-size:11px;color:var(--text);background:var(--bg);padding:10px;border-radius:6px;max-height:160px;overflow-y:auto;border:1px solid var(--border);">{transcriptSnippet || "(no transcript)"}</pre>
        </div>

        <div>
          <div class="tbl-title" style="margin-bottom:6px;">Questions ({qs.length})</div>
          <table class="data-table">
            <thead><tr><th>#</th><th>Question</th><th>Answer</th><th>Reason</th></tr></thead>
            <tbody>
              {qs.length === 0 ? (
                <tr class="empty-row"><td colSpan={4}>No questions</td></tr>
              ) : qs.map((q, i) => (
                <tr key={i}>
                  <td class="mono" style="width:28px;">{i + 1}</td>
                  <td style="font-size:12px;">{q.question ?? "\u2014"}</td>
                  <td><span class={`pill pill-${pillColor(q.answer)}`}>{q.answer ?? "\u2014"}</span></td>
                  <td style="font-size:11px;color:var(--text-muted);">{q.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
