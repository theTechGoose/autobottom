/** POST: flip the active flag on a config and return the refreshed
 *  status pill. Hit by the inline toggle button on /question-lab. */
import { define } from "../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../lib/api.ts";

interface QLConfig { id: string; active?: boolean }

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return new Response(`<span style="color:var(--red);">missing id</span>`, { status: 400, headers: { "content-type": "text/html" } });

    let next = true;
    try {
      const list = await apiFetch<{ configs?: QLConfig[] }>("/api/qlab/configs", ctx.req);
      const cur = list.configs?.find((c) => c.id === id);
      next = !(cur?.active ?? true);
      await apiPost<{ id?: string }>("/api/qlab/configs/update", ctx.req, { id, active: next });
    } catch (err) {
      console.error(`[qlab/toggle-active] failed:`, err);
      return new Response(`<span class="pill pill-red">error</span>`, { headers: { "content-type": "text/html" } });
    }
    return new Response(renderPill(id, next), { headers: { "content-type": "text/html" } });
  },
});

export function renderPill(id: string, active: boolean): string {
  const cls = active ? "pill-green" : "pill-red";
  const label = active ? "active" : "inactive";
  return `<button
    type="button"
    class="pill ${cls}"
    style="cursor:pointer;border:none;font-family:inherit;"
    hx-post="/api/qlab/configs/toggle-active?id=${encodeURIComponent(id)}"
    hx-target="this"
    hx-swap="outerHTML"
    onclick="event.stopPropagation()"
    title="Click to toggle"
  >${label}</button>`;
}
