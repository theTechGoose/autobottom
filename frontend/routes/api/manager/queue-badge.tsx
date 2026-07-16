/** HTMX fragment — pending-count badge on the sidebar's Queue nav item.
 *  Polled every 10s alongside the stat cards. Empty response (no chip) when
 *  the manager's queue is clear. Reads `as` off HX-Current-URL so an admin
 *  impersonating a manager sees that manager's count. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";

interface ManagerStats { pending?: number; }

export const handler = define.handlers({
  async GET(ctx) {
    try {
      // The sidebar's hx-get URL is static, so impersonation context comes
      // from the page URL HTMX reports in HX-Current-URL.
      const current = ctx.req.headers.get("hx-current-url") ?? "";
      let qs = "";
      try {
        const asEmail = current ? new URL(current).searchParams.get("as") : null;
        if (asEmail) qs = `?as=${encodeURIComponent(asEmail)}`;
      } catch { /* unparseable header — fall through to the caller's own scope */ }
      const stats = await apiFetch<ManagerStats>(`/manager/api/stats${qs}`, ctx.req);
      const pending = stats.pending ?? 0;
      if (pending <= 0) return new Response("", { headers: { "content-type": "text/html" } });
      const label = pending > 999 ? "999+" : String(pending);
      return new Response(
        `<span style="background:var(--red);color:#fff;border-radius:9px;font-size:10px;font-weight:700;padding:1px 6px;line-height:1.4;">${label}</span>`,
        { headers: { "content-type": "text/html" } },
      );
    } catch {
      return new Response("", { headers: { "content-type": "text/html" } });
    }
  },
});
