/** HTMX fragment — start a test audit by RID. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const rid = form.get("test-rid")?.toString() ?? "";
      const type = form.get("test-type")?.toString() ?? "internal";
      if (!rid) return new Response(`<span class="error-text">Enter a record ID</span>`, { headers: { "content-type": "text/html" } });

      const endpoint = type === "partner" ? "/audit/package-by-rid" : "/audit/test-by-rid";
      const data = await apiPost<{ findingId?: string; jobId?: string; error?: string }>(
        `${endpoint}?rid=${encodeURIComponent(rid)}`, ctx.req, { rid },
      );
      if (data.error) return new Response(`<span class="error-text">${data.error}</span>`, { headers: { "content-type": "text/html" } });
      return new Response(`<span style="color:var(--green);font-size:12px;">Audit started: ${data.findingId ?? data.jobId ?? "queued"}</span>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
