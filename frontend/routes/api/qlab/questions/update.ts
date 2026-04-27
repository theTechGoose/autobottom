/** POST: update a question. Redirects back to the config view. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const id = String(body.id ?? "");
    const configId = String(body.configId ?? "");
    if (!id) return new Response("id required", { status: 400 });
    const patch = {
      id,
      name: String(body.name ?? "").trim(),
      text: String(body.text ?? "").trim(),
      autoYesExp: String(body.autoYesExp ?? "").trim(),
      egregious: body.egregious === 1 || body.egregious === "1" || body.egregious === "on",
      temperature: Number(body.temperature ?? 0.8),
      numDocs: Number(body.numDocs ?? 4),
      weight: Number(body.weight ?? 5),
    };
    await apiPost("/api/qlab/questions/update", ctx.req, patch);
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": `/question-lab?configId=${configId}` },
    });
  },
});
