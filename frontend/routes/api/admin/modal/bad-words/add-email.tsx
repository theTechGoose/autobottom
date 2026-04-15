/** POST: Add email to bad words config, return updated list. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = (form.get("email") as string)?.trim();

    let config: Record<string, unknown> = {};
    try { config = await apiFetch("/admin/bad-word-config", ctx.req); } catch {}
    const emails = (config.emails as string[]) ?? [];
    if (email && !emails.includes(email)) {
      emails.push(email);
      config.emails = emails;
      try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch {}
    }

    const html = renderToString(
      <>{emails.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No recipients</div>
      ) : emails.map(e => (
        <div key={e} class="item-row">
          <span>{e}</span>
          <button class="item-remove" hx-post="/api/admin/modal/bad-words/remove-email" hx-vals={JSON.stringify({ email: e })} hx-target="#bw-email-list" hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
