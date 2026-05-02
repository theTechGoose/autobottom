/** CSV download wrapper — proxies to backend /admin/audits/data?format=csv.
 *  We need a frontend-side route so the cookie travels and the browser gets
 *  the file with the right Content-Disposition. */
import { define } from "../../../lib/define.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const qs = new URLSearchParams(url.search);
    qs.set("format", "csv");

    // apiFetch JSON-decodes by default — bypass it: build the headers ourselves.
    const cookie = ctx.req.headers.get("cookie") ?? "";
    const port = Deno.env.get("PORT") ?? "3000";
    const apiUrl = Deno.env.get("API_URL") ?? `http://localhost:${port}`;
    const r = await fetch(`${apiUrl}/admin/audits/data?${qs}`, {
      headers: { cookie, accept: "text/csv" },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return new Response(`CSV export failed: HTTP ${r.status} ${text.slice(0, 200)}`, {
        status: r.status,
        headers: { "content-type": "text/plain" },
      });
    }
    const body = await r.text();
    return new Response(body, {
      headers: {
        "content-type": "text/csv",
        "content-disposition": "attachment; filename=audit-history.csv",
      },
    });
  },
});

