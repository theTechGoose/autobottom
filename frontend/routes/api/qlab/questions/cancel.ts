/** GET: clear the question editor (HTMX swaps in empty content). */
import { define } from "../../../../lib/define.ts";

export const handler = define.handlers({
  GET() {
    return new Response("", { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
