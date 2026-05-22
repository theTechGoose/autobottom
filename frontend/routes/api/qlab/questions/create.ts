/** POST: create a question. Redirects back to the config view.
 *  Single backend round-trip — the inline form only sends {configId, name, text}.
 *  The detail page's column renderers all default missing fields (weight ?? 5,
 *  egregious ?? false, etc.), so the previous follow-up POST to /update was
 *  patching hard-coded defaults that nothing depended on. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const configId = String(body.configId ?? "");
    if (!configId) return new Response("configId required", { status: 400 });
    await apiPost<{ id?: string }>("/api/qlab/questions", ctx.req, {
      configId,
      name: String(body.name ?? "").trim(),
      text: String(body.text ?? "").trim(),
    });
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": `/question-lab/config/${configId}` },
    });
  },
});
