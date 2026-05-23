/** Empty response — collapses the preview iframe back to nothing. */
import { define } from "../../../../../lib/define.ts";

export const handler = define.handlers({
  GET() {
    return new Response("", { headers: { "content-type": "text/html" } });
  },
});
