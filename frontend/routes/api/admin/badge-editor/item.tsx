/** GET /api/admin/badge-editor/item?id=<id>
 *  Returns the right-pane detail fragment for a given item. Used by HTMX to
 *  swap the detail when the user clicks an item in the sidebar list. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { BadgeEditorDetail, type StoreItem } from "../../../../components/BadgeEditor.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const id = (url.searchParams.get("id") ?? "").trim();

    if (id === "new" || id === "") {
      const html = renderToString(<BadgeEditorDetail item={null} mode="new" />);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    let items: StoreItem[] = [];
    try {
      const data = await apiFetch<{ items: StoreItem[] }>("/admin/badge-editor/items", ctx.req);
      items = data.items ?? [];
    } catch (e) {
      const msg = (e as Error).message;
      const html = renderToString(
        <div style="padding:20px;color:var(--red);font-size:12px;">Failed to load item: {msg}</div>,
      );
      return new Response(html, { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    const found = items.find((it) => it.id === id) ?? null;
    if (!found) {
      const html = renderToString(
        <div style="padding:20px;color:var(--text-dim);font-size:12px;">Item not found: {id}</div>,
      );
      return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    const html = renderToString(<BadgeEditorDetail item={found} mode="edit" />);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
