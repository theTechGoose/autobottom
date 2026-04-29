/** POST: update a question. Returns a tiny "saved" status fragment for the
 *  editor page (`/question-lab/question/[id]`). Reads HTMX form body, posts
 *  JSON to the backend's /api/qlab/questions/update endpoint. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const id = String(body.id ?? "");
    if (!id) return msg(`<span style="color:var(--red);">missing id</span>`);

    const patch = {
      id,
      name: String(body.name ?? "").trim(),
      text: String(body.text ?? "").trim(),
      autoYesExp: String(body.autoYesExp ?? "").trim(),
      egregious: body.egregious === true || body.egregious === 1 || body.egregious === "1" || body.egregious === "on" || body.egregious === "true",
      temperature: Number(body.temperature ?? 0.8),
      numDocs: Number(body.numDocs ?? 4),
      weight: Number(body.weight ?? 5),
    };

    try {
      await apiPost("/api/qlab/questions/update", ctx.req, patch);
    } catch (err) {
      return msg(`<span style="color:var(--red);">${(err as Error).message}</span>`);
    }
    return msg(`<span style="color:var(--green);">✓ saved</span>`);
  },
});

function msg(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html" } });
}
