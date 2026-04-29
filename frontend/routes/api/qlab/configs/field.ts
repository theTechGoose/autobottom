/** POST: update a single config field (name / type / testEmailRecipients).
 *  Returns a tiny status fragment. Used by the inline editors on the config
 *  detail page. The active-toggle has its own dedicated route because it
 *  re-renders the pill button itself. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

const STRING_FIELDS = new Set(["name"]);
const ENUM_FIELDS = new Set(["type"]); // internal | partner
const LIST_FIELDS = new Set(["testEmailRecipients"]);

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const id = String(form.get("id") ?? "").trim();
    const field = String(form.get("field") ?? "").trim();
    const raw = String(form.get("value") ?? "");

    if (!id) return msg(`<span style="color:var(--red);">missing id</span>`);

    let payload: unknown;
    if (STRING_FIELDS.has(field)) {
      const trimmed = raw.trim();
      if (!trimmed) return msg(`<span style="color:var(--red);">${field} required</span>`);
      payload = trimmed;
    } else if (ENUM_FIELDS.has(field)) {
      payload = raw === "partner" ? "partner" : "internal";
    } else if (LIST_FIELDS.has(field)) {
      payload = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    } else {
      return msg(`<span style="color:var(--red);">unsupported field "${field}"</span>`);
    }

    try {
      await apiPost("/api/qlab/configs/update", ctx.req, { id, [field]: payload });
    } catch (err) {
      return msg(`<span style="color:var(--red);">${(err as Error).message}</span>`);
    }
    return msg(`<span style="color:var(--green);">✓ saved</span>`);
  },
});

function msg(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}
