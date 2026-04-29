/** Thin JSON proxy for the Bulk Audit island — fires one audit at a time.
 *  Island iterates and calls this once per RID with the chosen stagger. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

interface AuditResponse {
  findingId?: string;
  jobId?: string;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const rid = (url.searchParams.get("rid") ?? "").trim();
      const type = (url.searchParams.get("type") ?? "internal").trim();
      if (!rid) return Response.json({ error: "rid required" }, { status: 400 });

      const endpoint = type === "partner" ? "/audit/package-by-rid" : "/audit/test-by-rid";
      // Same owner-attribution as the single-rid test-audit handler — keeps
      // finding.owner pointing at the requesting admin so downstream
      // greeting parsers don't fall back to "Hi Api".
      const owner = ctx.state.user?.email ?? undefined;
      const data = await apiPost<AuditResponse>(`${endpoint}?rid=${encodeURIComponent(rid)}`, ctx.req, owner ? { rid, owner } : { rid });
      return Response.json(data);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
});
