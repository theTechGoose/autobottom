import { assertEquals } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";

import { handler as decideHandler } from "../../../routes/api/review/decide.tsx";
import { handler as backHandler } from "../../../routes/api/review/back.tsx";

const MOCK_NEXT = {
  buffer: [{ findingId: "f2", questionIndex: 0, header: "Q2", question: "Was the rate disclosed?", answer: "yes", thinking: "...", defense: "...", snippet: "[AGENT]: Yes" }],
  remaining: 3,
};

function jsonReq(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST", headers: { "content-type": "application/json", cookie: "session=abc" },
    body: JSON.stringify(body),
  });
}

Deno.test("review decide — posts decision then fetches next item", async () => {
  const mock = mockFetch({
    "/review/api/decide": { body: { ok: true } },
    "/review/api/next": { body: MOCK_NEXT },
  });
  try {
    const ctx = { req: jsonReq("/api/review/decide", { findingId: "f1", questionIndex: 0, decision: "confirm", reviewer: "r@co.com" }), state: {} };
    const res = await (decideHandler as any).POST(ctx);
    assertEquals(mock.callCount(), 2);
    assertEquals(mock.calls[0].url.includes("/review/api/decide"), true);
    assertEquals(mock.calls[1].url.includes("/review/api/next"), true);
    const html = await res.text();
    assertEquals(html.includes("queue-left"), true);
    assertEquals(html.includes("queue-right"), true);
  } finally { mock.restore(); }
});

Deno.test("review decide — returns empty state when no items", async () => {
  const mock = mockFetch({
    "/review/api/decide": { body: { ok: true } },
    "/review/api/next": { body: { buffer: [], remaining: 0 } },
  });
  try {
    const ctx = { req: jsonReq("/api/review/decide", { findingId: "f1", questionIndex: 0, decision: "flip", reviewer: "r@co.com" }), state: {} };
    const res = await (decideHandler as any).POST(ctx);
    const html = await res.text();
    assertEquals(html.includes("No items pending review"), true);
  } finally { mock.restore(); }
});

Deno.test("review decide — returns error on failure", async () => {
  const mock = mockFetch({ "/review/api/decide": { status: 500, body: { error: "fail" } } });
  try {
    const ctx = { req: jsonReq("/api/review/decide", { findingId: "f1", questionIndex: 0, decision: "confirm", reviewer: "r@co.com" }), state: {} };
    const res = await (decideHandler as any).POST(ctx);
    const html = await res.text();
    assertEquals(html.includes("Error"), true);
  } finally { mock.restore(); }
});

Deno.test("review back — returns previous item", async () => {
  const mock = mockFetch({
    "/review/api/back": { body: MOCK_NEXT },
  });
  try {
    const ctx = { req: jsonReq("/api/review/back", { findingId: "f1", questionIndex: 0, reviewer: "r@co.com" }), state: {} };
    const res = await (backHandler as any).POST(ctx);
    const html = await res.text();
    assertEquals(html.includes("queue-left"), true);
  } finally { mock.restore(); }
});
