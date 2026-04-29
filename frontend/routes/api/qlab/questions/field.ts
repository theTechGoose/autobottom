/** POST: update a single question field (weight / numDocs / temperature /
 *  egregious). Used by the inline editors on /question-lab/config/[id].
 *  Returns a tiny status fragment that fades after a moment. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";

const NUMERIC_FIELDS = new Set(["weight", "numDocs", "temperature"]);
const BOOL_FIELDS = new Set(["egregious"]);

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const id = String(form.get("id") ?? "").trim();
    const field = String(form.get("field") ?? "").trim();
    const raw = String(form.get("value") ?? "");

    if (!id) return msg(`<span style="color:var(--red);">missing id</span>`);
    if (!NUMERIC_FIELDS.has(field) && !BOOL_FIELDS.has(field)) {
      return msg(`<span style="color:var(--red);">unsupported field "${field}"</span>`);
    }

    let parsed: number | boolean;
    if (NUMERIC_FIELDS.has(field)) {
      const n = Number(raw);
      if (Number.isNaN(n)) return msg(`<span style="color:var(--red);">not a number</span>`);
      parsed = n;
    } else {
      parsed = raw === "true" || raw === "on" || raw === "1";
    }

    try {
      await apiPost("/api/qlab/questions/update", ctx.req, { id, [field]: parsed });
    } catch (err) {
      return msg(`<span style="color:var(--red);">${(err as Error).message}</span>`);
    }
    return msg(`<span style="color:var(--green);">✓ saved</span>`);
  },
});

function msg(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}
