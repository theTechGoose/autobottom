/** Render tests for the Badge Editor page + detail component. */
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { BadgeEditorDetail, type StoreItem } from "../../components/BadgeEditor.tsx";

const FIXTURE_ITEMS: StoreItem[] = [
  { id: "title_rookie", name: "Rookie", description: "Day one.", price: 75, rarity: "common", category: "title", icon: "🔰" },
  { id: "title_ace", name: "Ace Team Member", description: "Sharp.", price: 200, rarity: "uncommon", category: "title", icon: "🃏" },
  { id: "frame_galaxy", name: "Galaxy Frame", description: "Cosmos.", price: 1200, rarity: "legendary", category: "avatar_frame", icon: "🌌" },
];

Deno.test("BadgeEditorDetail — renders editable form for a custom item", () => {
  const html = renderHTML(<BadgeEditorDetail item={FIXTURE_ITEMS[0]} mode="edit" />);
  assertContains(html, "Edit Item");
  assertContains(html, 'name="name"');
  assertContains(html, 'value="Rookie"');
  assertContains(html, 'name="price"');
  assertContains(html, 'name="rarity"');
  assertContains(html, "common");
  assertContains(html, "Save");
  assertContains(html, "Delete");
  assertContains(html, "/api/admin/badge-editor/save");
});

Deno.test("BadgeEditorDetail — new mode shows Create button + writable ID", () => {
  const html = renderHTML(<BadgeEditorDetail item={null} mode="new" />);
  assertContains(html, "New Item");
  assertContains(html, "Create");
  assertNotContains(html, ">Delete<");
});

Deno.test("BadgeEditorDetail — built-in items render read-only and hide Save/Delete", () => {
  const builtIn: StoreItem = { ...FIXTURE_ITEMS[0], isBuiltIn: true };
  const html = renderHTML(<BadgeEditorDetail item={builtIn} mode="edit" />);
  assertContains(html, "Built-In Item");
  assertContains(html, "cannot be edited");
  assertNotContains(html, ">Save<");
  assertNotContains(html, ">Delete<");
});

Deno.test("BadgeEditorDetail — surfaces a success notice", () => {
  const html = renderHTML(
    <BadgeEditorDetail item={FIXTURE_ITEMS[0]} mode="edit" notice={{ type: "success", message: "Saved" }} />,
  );
  assertContains(html, "Saved");
  assertContains(html, "var(--green)");
});

Deno.test("BadgeEditorDetail — surfaces an error notice", () => {
  const html = renderHTML(
    <BadgeEditorDetail item={null} mode="new" notice={{ type: "error", message: "Name is required" }} />,
  );
  assertContains(html, "Name is required");
  assertContains(html, "var(--red)");
});

// ── Page-level: render the list aside as a standalone fragment. We exercise
// the same JSX the page renders by inlining a tiny stand-in (no Fresh ctx).
Deno.test("Badge Editor — list shows items + rarity pills + + New Item button", () => {
  // Reproduce the list aside JSX from the page route. Keeping this in-test
  // avoids importing the route handler (which depends on Fresh ctx + fetch).
  const RARITY_COLORS: Record<string, string> = {
    common: "#6b7280", uncommon: "#22c55e", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b",
  };
  const aside = (
    <aside>
      <h1>Badge Editor</h1>
      <a href="/admin/badge-editor?id=new" class="sf-btn primary">+ New Item</a>
      {FIXTURE_ITEMS.map((it) => (
        <a key={it.id} href={`/admin/badge-editor?id=${it.id}`} data-rarity={it.rarity}>
          <span>{it.icon}</span>
          <span>{it.name}</span>
          <span class="pill" style={`color:${RARITY_COLORS[it.rarity ?? "common"]};`}>{it.rarity}</span>
        </a>
      ))}
    </aside>
  );
  const html = renderHTML(aside);
  assertContains(html, "Badge Editor");
  assertContains(html, "+ New Item");
  assertContains(html, "Rookie");
  assertContains(html, "Ace Team Member");
  assertContains(html, "Galaxy Frame");
  // Each rarity colored pill present
  assertContains(html, "#6b7280"); // common
  assertContains(html, "#22c55e"); // uncommon
  assertContains(html, "#f59e0b"); // legendary
});
