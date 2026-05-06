/** POST: mark or unmark every question with a given name as egregious. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const name = String(form.get("name") ?? "").trim();
    const egregious = String(form.get("egregious") ?? "true") === "true";

    if (!name) return msg(`<span style="color:var(--red);">Pick a question name first.</span>`);

    try {
      const r = await apiPost<{ ok?: boolean; updated?: number; error?: string }>(
        "/api/qlab/questions/bulk-egregious",
        ctx.req,
        { name, egregious },
      );
      if (r.error) return msg(`<span style="color:var(--red);">${escapeHtml(r.error)}</span>`);
      const verb = egregious ? "Marked" : "Unmarked";
      const count = r.updated ?? 0;
      return msg(`<span style="color:var(--green);">✓ ${verb} ${count} question${count === 1 ? "" : "s"} named "${escapeHtml(name)}".</span>`);
    } catch (err) {
      return msg(`<span style="color:var(--red);">Failed: ${escapeHtml((err as Error).message)}</span>`);
    }
  },
});

function msg(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
