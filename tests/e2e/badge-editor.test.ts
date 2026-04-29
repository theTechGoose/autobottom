/** E2E tests for the Badge Editor backend round-trip:
 *  GET items → POST item (create) → GET items (verify present) → POST delete →
 *  GET items (verify gone). */
import { assert, assertEquals } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

let session: { cookie: string; email: string };

interface StoreItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  rarity?: string;
  category?: string;
  icon?: string;
}

async function listItems(cookie: string): Promise<StoreItem[]> {
  const res = await fetch(`${BASE}/admin/badge-editor/items`, {
    headers: { cookie, accept: "application/json" },
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert(Array.isArray(data.items), "items should be an array");
  return data.items;
}

Deno.test({
  name: "E2E badge-editor setup — start server + session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "E2E badge-editor: GET /admin/badge-editor/items returns array",
  sanitizeResources: false,
  async fn() {
    const items = await listItems(session.cookie);
    assert(Array.isArray(items));
  },
});

const TEST_ITEM_ID = `e2e_test_item_${Date.now()}`;

Deno.test({
  name: "E2E badge-editor: POST /admin/badge-editor/item creates a new item",
  sanitizeResources: false,
  async fn() {
    const body = {
      id: TEST_ITEM_ID,
      name: "E2E Test Item",
      description: "Created by e2e test",
      price: 250,
      rarity: "uncommon",
      category: "cosmetics",
      icon: "🧪",
    };
    const res = await fetch(`${BASE}/admin/badge-editor/item`, {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.ok, true);

    // Verify it shows up in the list
    const items = await listItems(session.cookie);
    const found = items.find((it) => it.id === TEST_ITEM_ID);
    assert(found, `created item ${TEST_ITEM_ID} should appear in list`);
    assertEquals(found?.name, "E2E Test Item");
    assertEquals(found?.price, 250);
  },
});

Deno.test({
  name: "E2E badge-editor: POST /admin/badge-editor/item/delete removes the item",
  sanitizeResources: false,
  async fn() {
    const res = await fetch(`${BASE}/admin/badge-editor/item/delete`, {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ id: TEST_ITEM_ID }),
    });
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.ok, true);

    // Verify it's gone
    const items = await listItems(session.cookie);
    const found = items.find((it) => it.id === TEST_ITEM_ID);
    assertEquals(found, undefined, `deleted item ${TEST_ITEM_ID} should not appear in list`);
  },
});

Deno.test({
  name: "E2E badge-editor cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
