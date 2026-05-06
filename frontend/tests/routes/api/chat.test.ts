import { assertEquals } from "@std/assert";
import { mockFetch, createCtx } from "../../helpers/mock-fetch.ts";

import { handler as threadHandler } from "../../../routes/api/chat/thread.tsx";
import { handler as sendHandler } from "../../../routes/api/chat/send.ts";

Deno.test("chat thread — renders message bubbles", async () => {
  const mock = mockFetch({
    "/api/messages/conversations": { body: { conversations: [{ peer: "bob@co.com", messages: [
      { id: "m1", from: "alice@co.com", to: "bob@co.com", body: "Hello!", ts: Date.now() },
      { id: "m2", from: "bob@co.com", to: "alice@co.com", body: "Hey!", ts: Date.now() },
    ] }] } },
  });
  try {
    const ctx = createCtx("/api/chat/thread?email=alice@co.com&peer=bob@co.com", { cookie: "session=abc" });
    const res = await (threadHandler as any).GET(ctx);
    const html = await res.text();
    assertEquals(html.includes("chat-bubble"), true);
    assertEquals(html.includes("Hello!"), true);
  } finally { mock.restore(); }
});

Deno.test("chat thread — empty state when no messages", async () => {
  const mock = mockFetch({
    "/api/messages/conversations": { body: { conversations: [{ peer: "bob@co.com", messages: [] }] } },
  });
  try {
    const ctx = createCtx("/api/chat/thread?email=alice@co.com&peer=bob@co.com", { cookie: "session=abc" });
    const res = await (threadHandler as any).GET(ctx);
    const html = await res.text();
    assertEquals(html.includes("No messages yet"), true);
  } finally { mock.restore(); }
});

Deno.test("chat thread — sent vs received classes", async () => {
  const mock = mockFetch({
    "/api/messages/conversations": { body: { conversations: [{ peer: "bob@co.com", messages: [
      { id: "m1", from: "alice@co.com", to: "bob@co.com", body: "Mine", ts: Date.now() },
      { id: "m2", from: "bob@co.com", to: "alice@co.com", body: "Theirs", ts: Date.now() },
    ] }] } },
  });
  try {
    const ctx = createCtx("/api/chat/thread?email=alice@co.com&peer=bob@co.com", { cookie: "session=abc" });
    const res = await (threadHandler as any).GET(ctx);
    const html = await res.text();
    assertEquals(html.includes("sent"), true);
    assertEquals(html.includes("received"), true);
  } finally { mock.restore(); }
});

Deno.test("chat send — proxies to backend", async () => {
  const mock = mockFetch({ "/api/messages": { body: { id: "m3", from: "a", to: "b", body: "hi", ts: 1 } } });
  try {
    const req = new Request("http://localhost/api/chat/send", {
      method: "POST", headers: { "content-type": "application/json", cookie: "session=abc" },
      body: JSON.stringify({ from: "a@co.com", to: "b@co.com", body: "hi" }),
    });
    const res = await (sendHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 200);
    assertEquals(mock.calls[0].url.includes("/api/messages"), true);
  } finally { mock.restore(); }
});
