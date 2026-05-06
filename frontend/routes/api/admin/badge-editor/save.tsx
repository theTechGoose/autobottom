/** POST /api/admin/badge-editor/save
 *  Validates form input, forwards to backend POST /admin/badge-editor/item,
 *  returns the refreshed detail pane (with success notice) on success or the
 *  same form (with error notice) on validation failure. */
import { define } from "../../../../lib/define.ts";
import { apiPost, parseHtmxBody } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { BadgeEditorDetail, type StoreItem } from "../../../../components/BadgeEditor.tsx";

const VALID_RARITIES = new Set(["common", "uncommon", "rare", "epic", "legendary"]);

export interface ValidationResult {
  ok: boolean;
  error?: string;
  item?: StoreItem;
}

/** Validate an incoming save payload. Exported so unit tests can call it
 *  without spinning up a request. */
export function validatePayload(input: Record<string, unknown>): ValidationResult {
  const idRaw = String(input.id ?? "").trim();
  const nameRaw = String(input.name ?? "").trim();
  const priceRaw = input.price;
  const rarityRaw = String(input.rarity ?? "").trim().toLowerCase();
  const description = String(input.description ?? "");
  const category = String(input.category ?? "title").trim();
  const icon = String(input.icon ?? "");
  const image = String(input.image ?? "");

  if (!nameRaw) return { ok: false, error: "Name is required" };

  let price: number;
  if (typeof priceRaw === "number") price = priceRaw;
  else if (typeof priceRaw === "string" && priceRaw.length > 0) price = Number(priceRaw);
  else return { ok: false, error: "Price is required" };
  if (!Number.isFinite(price) || !Number.isInteger(price) || price < 0) {
    return { ok: false, error: "Price must be a non-negative integer" };
  }

  if (!VALID_RARITIES.has(rarityRaw)) {
    return { ok: false, error: "Rarity must be one of common | uncommon | rare | epic | legendary" };
  }

  // ID is required for both new and edit; for new mode the form must populate
  // it (we don't auto-slugify on the server — that's a UX nicety we may add
  // later but consistency with backend keys matters more).
  if (!idRaw) return { ok: false, error: "ID is required" };
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(idRaw)) {
    return { ok: false, error: "ID must contain only letters, digits, _ - : ." };
  }

  return {
    ok: true,
    item: {
      id: idRaw,
      name: nameRaw,
      description,
      price,
      rarity: rarityRaw,
      category,
      icon,
      image,
    },
  };
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await parseHtmxBody(ctx.req);
    const isBuiltIn = String(body.isBuiltIn ?? "false") === "true";
    const mode = String(body.mode ?? "edit") === "new" ? "new" : "edit";

    if (isBuiltIn) {
      const html = renderToString(
        <BadgeEditorDetail
          item={{
            id: String(body.originalId ?? ""),
            name: String(body.name ?? ""),
            description: String(body.description ?? ""),
            price: Number(body.price ?? 0) || 0,
            rarity: String(body.rarity ?? "common"),
            category: String(body.category ?? "title"),
            icon: String(body.icon ?? ""),
            image: String(body.image ?? ""),
            isBuiltIn: true,
          }}
          mode="edit"
          notice={{ type: "error", message: "Built-in items cannot be modified" }}
        />,
      );
      return new Response(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    const v = validatePayload(body);
    if (!v.ok || !v.item) {
      // Re-render the form with the user's values + error banner so they can
      // fix and retry.
      const html = renderToString(
        <BadgeEditorDetail
          item={{
            id: String(body.id ?? ""),
            name: String(body.name ?? ""),
            description: String(body.description ?? ""),
            price: Number(body.price ?? 0) || 0,
            rarity: String(body.rarity ?? "common"),
            category: String(body.category ?? "title"),
            icon: String(body.icon ?? ""),
            image: String(body.image ?? ""),
          }}
          mode={mode}
          notice={{ type: "error", message: v.error ?? "Invalid input" }}
        />,
      );
      return new Response(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    try {
      await apiPost("/admin/badge-editor/item", ctx.req, v.item);
    } catch (e) {
      const html = renderToString(
        <BadgeEditorDetail
          item={v.item}
          mode={mode}
          notice={{ type: "error", message: `Save failed: ${(e as Error).message}` }}
        />,
      );
      return new Response(html, { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Successful save — return the refreshed detail with a success banner.
    // Also tell the browser to push the new ?id= state so a page reload keeps
    // the saved item selected (HX-Push-Url is HTMX-native; harmless when not
    // hit via HTMX).
    const html = renderToString(
      <BadgeEditorDetail
        item={v.item}
        mode="edit"
        notice={{ type: "success", message: "Saved" }}
      />,
    );
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "HX-Push-Url": `/admin/badge-editor?id=${encodeURIComponent(v.item.id)}`,
      },
    });
  },
});
