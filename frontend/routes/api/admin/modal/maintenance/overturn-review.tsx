/** Data Maintenance → Overturn Review (REQ-051): the admin on/off switch for
 *  the Overturn Review queue. GET renders the switch with the current state;
 *  POST flips it and renders the new state. Admin-gated by the /api/admin path. */
import { renderToString } from "preact-render-to-string";
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost, parseHtmxBody } from "../../../../../lib/api.ts";

const html = (s: string) => new Response(s, { headers: { "content-type": "text/html" } });

export function OverturnReviewSwitch({ enabled, waiting, error }: { enabled: boolean; waiting: number; error?: string }) {
  return (
    <div id="ovr-switch">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span class={`ovr-switch-state ${enabled ? "on" : "off"}`} style={`font-size:12px;font-weight:700;color:${enabled ? "var(--green)" : "var(--yellow)"};`}>
          {enabled ? "On — overturned appeals wait for the team" : "Off — overturns close and email right away"}
        </span>
        <button
          type="button"
          class={`sf-btn ${enabled ? "danger" : "primary"} ovr-toggle`}
          style="padding:7px 14px;font-size:12px;"
          hx-post="/api/admin/modal/maintenance/overturn-review"
          hx-vals={JSON.stringify({ enabled: String(!enabled) })}
          hx-target="#ovr-switch"
          hx-swap="outerHTML"
        >
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">
        {waiting} {waiting === 1 ? "appeal is" : "appeals are"} waiting in the queue. Turning it off doesn't release them — judges still make the call on each.
      </div>
      {error && <div style="font-size:11px;color:var(--red);margin-top:6px;">{error}</div>}
    </div>
  );
}

async function state(req: Request): Promise<{ enabled: boolean; waiting: number }> {
  const d = await apiFetch<{ enabled?: boolean; remaining?: number }>("/judge/api/overturn-review", req);
  return { enabled: d.enabled !== false, waiting: d.remaining ?? 0 };
}

export const handler = define.handlers({
  async GET(ctx) {
    return html(renderToString(<OverturnReviewSwitch {...await state(ctx.req)} />));
  },
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const r = await apiPost<{ ok: boolean; error?: string }>(
      "/judge/api/overturn-review/config", ctx.req, { enabled: String(body.enabled) === "true" },
    ).catch((e) => ({ ok: false, error: String(e) }));
    return html(renderToString(<OverturnReviewSwitch {...await state(ctx.req)} error={r.ok ? undefined : r.error} />));
  },
});
