/** HTMX fragment — start a test audit by RID.
 *  Surfaces enqueue / trackActive errors inline so the user sees failure modes
 *  without needing access to Deploy logs. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

interface AuditResponse {
  findingId?: string;
  jobId?: string;
  error?: string;
  enqueue?: { ok: boolean; messageId?: string; callback?: string; error?: string };
  trackActive?: { ok: boolean; error?: string };
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const rid = form.get("test-rid")?.toString() ?? "";
      const type = form.get("test-type")?.toString() ?? "internal";
      if (!rid) return new Response(`<span class="error-text">Enter a record ID</span>`, { headers: { "content-type": "text/html" } });

      const endpoint = type === "partner" ? "/audit/package-by-rid" : "/audit/test-by-rid";
      const data = await apiPost<AuditResponse>(`${endpoint}?rid=${encodeURIComponent(rid)}`, ctx.req, { rid });

      if (data.error) {
        return new Response(`<span class="error-text">${data.error}</span>`, { headers: { "content-type": "text/html" } });
      }

      const id = data.findingId ?? data.jobId ?? "";
      const link = id
        ? `<a href="/audit/report?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" style="color:var(--green);font-weight:600;text-decoration:underline;">${id}</a>`
        : "queued";

      // Build a list of warnings if any sub-step failed. These are non-fatal
      // (finding is still persisted) but the audit won't show up in Active Audits.
      const warnings: string[] = [];
      if (data.enqueue && !data.enqueue.ok) {
        warnings.push(`⚠️ QStash enqueue failed: ${data.enqueue.error ?? "unknown"}`);
      } else if (data.enqueue?.callback) {
        // Show callback URL so we can visually confirm it's the right origin
        warnings.push(`📮 callback: <code style="font-size:10px;">${data.enqueue.callback}</code>`);
      }
      if (data.trackActive && !data.trackActive.ok) {
        warnings.push(`❌ trackActive failed (audit won't show in Active): ${data.trackActive.error ?? "unknown"}`);
      }

      const warningsHtml = warnings.length
        ? `<div style="margin-top:6px;font-size:11px;color:var(--yellow);line-height:1.6;">${warnings.map(w => `<div>${w}</div>`).join("")}</div>`
        : "";

      return new Response(
        `<span style="color:var(--green);font-size:12px;">Audit started: ${link}</span>${warningsHtml}`,
        { headers: { "content-type": "text/html" } },
      );
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
