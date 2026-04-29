/** Validation + handler tests for /api/admin/badge-editor/save. */
import { assert, assertEquals } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";

import { handler as saveHandler, validatePayload } from "../../../routes/api/admin/badge-editor/save.tsx";
import { handler as deleteHandler } from "../../../routes/api/admin/badge-editor/delete.tsx";

// ── Validation unit tests ────────────────────────────────────────────────────

Deno.test("validatePayload — rejects missing name", () => {
  const r = validatePayload({ id: "x", price: 10, rarity: "common" });
  assertEquals(r.ok, false);
  assert(r.error?.includes("Name"));
});

Deno.test("validatePayload — rejects negative price", () => {
  const r = validatePayload({ id: "x", name: "X", price: -1, rarity: "common" });
  assertEquals(r.ok, false);
  assert(r.error?.includes("Price"));
});

Deno.test("validatePayload — rejects non-integer price", () => {
  const r = validatePayload({ id: "x", name: "X", price: 10.5, rarity: "common" });
  assertEquals(r.ok, false);
  assert(r.error?.includes("Price"));
});

Deno.test("validatePayload — rejects missing price", () => {
  const r = validatePayload({ id: "x", name: "X", rarity: "common" });
  assertEquals(r.ok, false);
  assert(r.error?.includes("Price"));
});

Deno.test("validatePayload — rejects bad rarity", () => {
  const r = validatePayload({ id: "x", name: "X", price: 10, rarity: "mythic" });
  assertEquals(r.ok, false);
  assert(r.error?.includes("Rarity"));
});

Deno.test("validatePayload — rejects bad ID characters", () => {
  const r = validatePayload({ id: "bad id!", name: "X", price: 10, rarity: "common" });
  assertEquals(r.ok, false);
  assert(r.error?.includes("ID"));
});

Deno.test("validatePayload — accepts valid payload", () => {
  const r = validatePayload({
    id: "title_rookie",
    name: "Rookie",
    description: "Day one.",
    price: 75,
    rarity: "common",
    category: "title",
    icon: "🔰",
    image: "",
  });
  assertEquals(r.ok, true);
  assertEquals(r.item?.id, "title_rookie");
  assertEquals(r.item?.price, 75);
  assertEquals(r.item?.rarity, "common");
});

Deno.test("validatePayload — accepts price as string", () => {
  const r = validatePayload({ id: "x", name: "X", price: "100", rarity: "rare" });
  assertEquals(r.ok, true);
  assertEquals(r.item?.price, 100);
});

// ── Handler integration tests ────────────────────────────────────────────────

Deno.test("save handler — valid payload forwards to backend and returns success fragment", async () => {
  const mock = mockFetch({ "/admin/badge-editor/item": { body: { ok: true } } });
  try {
    const body = JSON.stringify({
      mode: "new",
      originalId: "",
      isBuiltIn: "false",
      id: "title_test",
      name: "Test",
      description: "",
      price: 100,
      rarity: "rare",
      category: "title",
      icon: "🧪",
      image: "",
    });
    const req = new Request("http://localhost/api/admin/badge-editor/save", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=abc" },
      body,
    });
    // deno-lint-ignore no-explicit-any
    const res = await (saveHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 200);
    const html = await res.text();
    assert(html.includes("Saved"));
    // Backend was called
    const call = mock.calls.find((c) => c.url.includes("/admin/badge-editor/item") && !c.url.includes("delete"));
    assert(call, "Backend save endpoint should have been called");
    assertEquals(call!.method, "POST");
    const sent = JSON.parse(call!.body ?? "{}");
    assertEquals(sent.id, "title_test");
    assertEquals(sent.price, 100);
    assertEquals(sent.rarity, "rare");
  } finally { mock.restore(); }
});

Deno.test("save handler — invalid payload returns 400 + error fragment, no backend call", async () => {
  const mock = mockFetch({ "/admin/badge-editor/item": { body: { ok: true } } });
  try {
    const body = JSON.stringify({
      mode: "new",
      originalId: "",
      isBuiltIn: "false",
      id: "title_test",
      name: "", // missing
      description: "",
      price: 100,
      rarity: "rare",
      category: "title",
    });
    const req = new Request("http://localhost/api/admin/badge-editor/save", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=abc" },
      body,
    });
    // deno-lint-ignore no-explicit-any
    const res = await (saveHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 400);
    const html = await res.text();
    assert(html.includes("Name is required"));
    // Backend should NOT have been called
    assertEquals(mock.calls.length, 0);
  } finally { mock.restore(); }
});

Deno.test("save handler — built-in items refused with 400", async () => {
  const mock = mockFetch({ "/admin/badge-editor/item": { body: { ok: true } } });
  try {
    const body = JSON.stringify({
      mode: "edit",
      originalId: "title_rookie",
      isBuiltIn: "true",
      id: "title_rookie",
      name: "Tampered",
      price: 0,
      rarity: "common",
      category: "title",
    });
    const req = new Request("http://localhost/api/admin/badge-editor/save", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=abc" },
      body,
    });
    // deno-lint-ignore no-explicit-any
    const res = await (saveHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 400);
    const html = await res.text();
    assert(html.includes("Built-in"));
    assertEquals(mock.calls.length, 0);
  } finally { mock.restore(); }
});

Deno.test("delete handler — forwards to backend and returns HX-Redirect", async () => {
  const mock = mockFetch({ "/admin/badge-editor/item/delete": { body: { ok: true } } });
  try {
    const req = new Request("http://localhost/api/admin/badge-editor/delete", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=abc" },
      body: JSON.stringify({ id: "title_test" }),
    });
    // deno-lint-ignore no-explicit-any
    const res = await (deleteHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("hx-redirect"), "/admin/badge-editor");
    const call = mock.calls[0];
    assert(call.url.includes("/admin/badge-editor/item/delete"));
    const sent = JSON.parse(call.body ?? "{}");
    assertEquals(sent.id, "title_test");
  } finally { mock.restore(); }
});

Deno.test("delete handler — missing id returns 400", async () => {
  const req = new Request("http://localhost/api/admin/badge-editor/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  // deno-lint-ignore no-explicit-any
  const res = await (deleteHandler as any).POST({ req, state: {} });
  assertEquals(res.status, 400);
});
