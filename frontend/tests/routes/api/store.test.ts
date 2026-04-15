import { assertEquals } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";

import { handler as buyHandler } from "../../../routes/api/store/buy.ts";

Deno.test("store buy — success redirects to /store", async () => {
  const mock = mockFetch({ "/api/store/buy": { body: { ok: true, newBalance: 50 } } });
  try {
    const req = new Request("http://localhost/api/store/buy", {
      method: "POST", headers: { "content-type": "application/json", cookie: "session=abc" },
      body: JSON.stringify({ email: "a@co.com", itemId: "badge-1", price: 10 }),
    });
    const res = await (buyHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("hx-redirect"), "/store");
  } finally { mock.restore(); }
});

Deno.test("store buy — error returns 500 JSON", async () => {
  const mock = mockFetch({ "/api/store/buy": { status: 500, body: { error: "insufficient funds" } } });
  try {
    const req = new Request("http://localhost/api/store/buy", {
      method: "POST", headers: { "content-type": "application/json", cookie: "session=abc" },
      body: JSON.stringify({ email: "a@co.com", itemId: "badge-1", price: 999 }),
    });
    const res = await (buyHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 500);
  } finally { mock.restore(); }
});
