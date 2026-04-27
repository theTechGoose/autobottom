/** POST: create a question. Redirects back to the config view. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const configId = String(body.configId ?? "");
    if (!configId) return new Response("configId required", { status: 400 });
    const created = await apiPost<{ id?: string }>("/api/qlab/questions", ctx.req, {
      configId,
      name: String(body.name ?? "").trim(),
      text: String(body.text ?? "").trim(),
    });
    if (created?.id) {
      const patch = {
        id: created.id,
        autoYesExp: String(body.autoYesExp ?? "").trim(),
        egregious: body.egregious === 1 || body.egregious === "1" || body.egregious === "on",
        temperature: Number(body.temperature ?? 0.8),
        numDocs: Number(body.numDocs ?? 4),
        weight: Number(body.weight ?? 5),
      };
      await apiPost("/api/qlab/questions/update", ctx.req, patch);
    }
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": `/question-lab?configId=${configId}` },
    });
  },
});
