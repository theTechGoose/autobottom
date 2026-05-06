import { assertEquals } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";

import { handler as decideHandler } from "../../../routes/api/judge/decide.tsx";
import { handler as backHandler } from "../../../routes/api/judge/back.tsx";

const MOCK_NEXT = {
  buffer: [{ findingId: "j2", questionIndex: 0, header: "Q1", question: "Test?", answer: "no", thinking: "...", defense: "...", snippet: "" }],
  remaining: 1,
};

function jsonReq(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST", headers: { "content-type": "application/json", cookie: "session=abc" },
    body: JSON.stringify(body),
  });
}

Deno.test("judge decide — posts to correct endpoint", async () => {
  const mock = mockFetch({
    "/judge/api/decide": { body: { ok: true } },
    "/judge/api/next": { body: MOCK_NEXT },
  });
  try {
    const ctx = { req: jsonReq("/api/judge/decide", { findingId: "j1", questionIndex: 0, decision: "uphold", judge: "j@co.com" }), state: {} };
    await (decideHandler as any).POST(ctx);
    assertEquals(mock.calls[0].url.includes("/judge/api/decide"), true);
    assertEquals(mock.calls[1].url.includes("/judge/api/next"), true);
  } finally { mock.restore(); }
});

Deno.test("judge decide — fetches next with judge param", async () => {
  const mock = mockFetch({
    "/judge/api/decide": { body: { ok: true } },
    "/judge/api/next": { body: MOCK_NEXT },
  });
  try {
    const ctx = { req: jsonReq("/api/judge/decide", { findingId: "j1", questionIndex: 0, decision: "overturn", reason: "error", judge: "j@co.com" }), state: {} };
    await (decideHandler as any).POST(ctx);
    assertEquals(mock.calls[1].url.includes("judge=j%40co.com"), true);
  } finally { mock.restore(); }
});

Deno.test("judge decide — renders judge-mode panel", async () => {
  const mock = mockFetch({
    "/judge/api/decide": { body: { ok: true } },
    "/judge/api/next": { body: MOCK_NEXT },
  });
  try {
    const ctx = { req: jsonReq("/api/judge/decide", { findingId: "j1", questionIndex: 0, decision: "uphold", judge: "j@co.com" }), state: {} };
    const res = await (decideHandler as any).POST(ctx);
    const html = await res.text();
    assertEquals(html.includes("queue-left"), true);
  } finally { mock.restore(); }
});

Deno.test("judge back — returns previous item", async () => {
  const mock = mockFetch({ "/judge/api/back": { body: MOCK_NEXT } });
  try {
    const ctx = { req: jsonReq("/api/judge/back", { findingId: "j1", questionIndex: 0, judge: "j@co.com" }), state: {} };
    const res = await (backHandler as any).POST(ctx);
    const html = await res.text();
    assertEquals(html.includes("queue-left"), true);
  } finally { mock.restore(); }
});
