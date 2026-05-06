/** HTMX fragment — find/delete audit by finding ID. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const findingId = url.searchParams.get("find-finding-id") ?? url.searchParams.get("findingId") ?? "";
    const action = url.searchParams.get("action") ?? "";
    if (!findingId) return new Response(`<span class="error-text">Enter a finding ID</span>`, { headers: { "content-type": "text/html" } });

    try {
      if (action === "delete") {
        await apiFetch(`/admin/delete-finding?findingId=${findingId}`, ctx.req);
        return new Response(`<span style="color:var(--green);font-size:12px;">Deleted ${findingId}</span>`, { headers: { "content-type": "text/html" } });
      }
      const data = await apiFetch<Record<string, unknown>>(`/audit/finding?id=${findingId}`, ctx.req);
      return new Response(`<pre style="font-size:11px;color:var(--text);background:var(--bg);padding:10px;border-radius:6px;overflow-x:auto;">${JSON.stringify(data, null, 2)}</pre>`, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(`<span class="error-text">${e}</span>`, { headers: { "content-type": "text/html" } });
    }
  },
});
