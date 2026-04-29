/** POST: bulk-delete configs.
 *  - Default: reads checked `ids` from the form body and deletes each.
 *  - With `?all=1`: requires the HX-Prompt header to be exactly "DELETE ALL"
 *    (the wipe-everything UX is gated by a typed confirmation prompt). When
 *    confirmed, fetches the full config list and deletes every entry.
 *
 *  Returns HX-Redirect to /question-lab so the table re-renders. */
import { define } from "../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../lib/api.ts";

interface QLConfig { id: string; name: string }

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const isAll = url.searchParams.get("all") === "1";

    let ids: string[] = [];

    if (isAll) {
      // Type-confirmation guard. HTMX sends the user's hx-prompt response in
      // the HX-Prompt request header — must match exactly.
      const prompt = (ctx.req.headers.get("HX-Prompt") ?? "").trim();
      if (prompt !== "DELETE ALL") {
        return new Response(
          `<div style="color:var(--red);font-size:11px;padding:8px;">Type-confirmation failed (got "${escapeHtml(prompt)}"). Nothing was deleted.</div>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      try {
        const list = await apiFetch<{ configs?: QLConfig[] }>("/api/qlab/configs", ctx.req);
        ids = (list.configs ?? []).map((c) => c.id);
      } catch (err) {
        return errorFragment(`Failed to list configs: ${(err as Error).message}`);
      }
    } else {
      const form = await ctx.req.formData();
      ids = form.getAll("ids").map((v) => String(v)).filter(Boolean);
    }

    if (ids.length === 0) {
      return new Response(
        `<div style="color:var(--text-dim);font-size:11px;padding:8px;">No configs selected — nothing to delete.</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    let deleted = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await apiPost("/api/qlab/configs/delete", ctx.req, { id });
        deleted++;
      } catch (err) {
        errors.push(`${id}: ${(err as Error).message}`);
      }
    }

    console.log(`🗑️  [QLAB-BULK-DELETE] deleted=${deleted} errors=${errors.length}${isAll ? " (WIPE ALL)" : ""}`);

    if (errors.length > 0 && deleted === 0) {
      return errorFragment(`All deletes failed: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`);
    }

    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": "/question-lab" },
    });
  },
});

function errorFragment(text: string): Response {
  return new Response(
    `<div style="color:var(--red);font-size:11px;padding:8px;">${escapeHtml(text)}</div>`,
    { headers: { "content-type": "text/html" } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
