/** POST: delete a question. Redirects back to the parent config view. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    const configId = url.searchParams.get("configId") ?? "";
    if (!id) return new Response("id required", { status: 400 });
    try {
      await apiPost("/api/qlab/questions/delete", ctx.req, { id });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`❌ [qlab/questions/delete] backend failed for id=${id}:`, msg);
      return new Response(
        `<tr><td colspan="7" style="color:var(--red);font-size:11px;padding:8px;">Delete failed: ${escapeHtml(msg)}</td></tr>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": configId ? `/question-lab/config/${configId}` : "/question-lab" },
    });
  },
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
