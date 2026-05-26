/** POST: delete a config + all its questions. Redirects browser to /question-lab. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return new Response("id required", { status: 400 });
    try {
      await apiPost("/api/qlab/configs/delete", ctx.req, { id });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`❌ [qlab/configs/delete] backend failed for id=${id}:`, msg);
      return new Response(
        `<div style="color:var(--red);font-size:11px;padding:8px;">Delete failed: ${escapeHtml(msg)}</div>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": "/question-lab" },
    });
  },
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
