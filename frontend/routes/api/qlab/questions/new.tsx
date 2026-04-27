/** GET: render the inline question editor for a new question. */
import { define } from "../../../../lib/define.ts";
import { renderEditor } from "./edit.tsx";

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const configId = url.searchParams.get("configId") ?? "";
    if (!configId) return new Response("configId required", { status: 400 });
    return new Response(renderEditor(null, configId, true), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
