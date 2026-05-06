/** GET: clear the inline action panel — used by the Close button on
 *  bulk-egregious-form. */
import { define } from "../../../../lib/define.ts";

export const handler = define.handlers({
  GET(_ctx) {
    return new Response("", { headers: { "content-type": "text/html" } });
  },
});
