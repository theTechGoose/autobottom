/** Generic HTMX config save handler — posts form data to a backend endpoint. */
import { define } from "../../../lib/define.ts";
import { apiPost } from "../../../lib/api.ts";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Format backend JSON response for the maintenance modal. Pulls common
 *  result fields (deleted, scanned, groups, plan, message) into a readable
 *  summary; falls back to a pretty-printed JSON dump so the operator can
 *  always see what happened — instead of the old "Saved" placeholder that
 *  hid the dedup count, dry-run plan, etc. */
function formatResult(result: unknown): string {
  if (result == null || typeof result !== "object") {
    return `<span style="color:var(--green);font-size:12px;">Done</span>`;
  }
  const r = result as Record<string, unknown>;
  if (r.error) {
    return `<span class="error-text">${escapeHtml(String(r.error))}</span>`;
  }
  const lines: string[] = [];
  if (typeof r.deleted === "number") lines.push(`<strong>Deleted:</strong> ${r.deleted}`);
  if (r.plan && typeof r.plan === "object") {
    const p = r.plan as Record<string, unknown>;
    if (typeof p.scanned === "number") lines.push(`<strong>Scanned:</strong> ${p.scanned}`);
    if (typeof p.groups === "number") lines.push(`<strong>Duplicate groups:</strong> ${p.groups}`);
    if (typeof p.orphaned === "number") lines.push(`<strong>Orphaned:</strong> ${p.orphaned}`);
    if (Array.isArray(p.toDelete)) {
      const losers = p.toDelete.filter((d) => d && typeof d === "object" && !(d as { keep?: boolean }).keep).length;
      lines.push(`<strong>To delete:</strong> ${losers}`);
    }
  }
  if (typeof r.message === "string") lines.push(escapeHtml(r.message));
  if (lines.length === 0) {
    const json = JSON.stringify(result, null, 2);
    return `<pre style="margin:0;font-size:11px;color:var(--text-dim);background:var(--bg-2);padding:8px;border-radius:4px;max-height:240px;overflow:auto;">${escapeHtml(json)}</pre>`;
  }
  return `<div style="font-size:12px;color:var(--green);display:grid;gap:4px;">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
}

export const handler = define.handlers({
  async POST(ctx) {
    try {
      const form = await ctx.req.formData();
      const endpoint = form.get("endpoint")?.toString() ?? "";
      if (!endpoint) return new Response(`<span class="error-text">Missing endpoint</span>`, { headers: { "content-type": "text/html" } });

      // Build body from form data (excluding endpoint)
      const body: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        if (key === "endpoint") continue;
        const v = value.toString();
        // Try to parse as number, boolean, or array
        if (v === "true") body[key] = true;
        else if (v === "false") body[key] = false;
        else if (/^\d+$/.test(v)) body[key] = parseInt(v);
        else if (v.includes(",") && !v.includes("\n")) body[key] = v.split(",").map(s => s.trim()).filter(Boolean);
        else if (v.includes("\n")) body[key] = v.split("\n").map(s => s.trim()).filter(Boolean);
        else body[key] = v;
      }

      const result = await apiPost(endpoint, ctx.req, body);
      return new Response(formatResult(result), { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${escapeHtml(String(e))}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
