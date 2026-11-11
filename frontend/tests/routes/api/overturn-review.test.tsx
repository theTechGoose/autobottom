/** Overturn Review HTMX routes (REQ-048/049): judges only; `show` opens the
 *  question picked in the Appealed Questions list; `decide` records the call as
 *  the signed-in judge, never a form field. */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";
import { handler as showHandler } from "../../../routes/api/judge/overturn-review/show.tsx";
import { handler as decideHandler } from "../../../routes/api/judge/overturn-review/decide.tsx";

const ITEM = {
  findingId: "f1", judge: "j@co.com", heldAt: 1, transcript: null,
  questions: [
    { questionIndex: 0, header: "TimeShare Owner", botAnswer: "No", decision: "overturn", judge: "j@co.com", reviewer: "r0@co.com" },
    { questionIndex: 3, header: "Correct Dates", botAnswer: "No", decision: "overturn", judge: "j@co.com", reviewer: "r3@co.com" },
  ],
};
const DATA = { item: ITEM, remaining: 1, enabled: true, waiting: [] };
const judge = { email: "team@co.com", role: "judge" };

// deno-lint-ignore no-explicit-any
const call = (h: any, method: string, url: string, user: unknown, body?: unknown) =>
  h[method]({
    req: new Request(`http://localhost${url}`, {
      method, headers: { "content-type": "application/json", cookie: "session=abc" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    state: { user },
  }) as Promise<Response>;

Deno.test("REQ-048: show opens the question picked in the Appealed Questions list", async () => {
  const mock = mockFetch({ "/judge/api/overturn-review": { body: DATA } });
  try {
    const res = await call(showHandler, "GET", "/api/judge/overturn-review/show?findingId=f1&q=3", judge);
    assertEquals(res.status, 200);
    assertEquals(mock.calls[0].url.includes("findingId=f1"), true);
    const html = await res.text();
    assertStringIncludes(html.slice(html.indexOf("verdict-question-header")), "Correct Dates");
    assertStringIncludes(html, "r3@co.com");
  } finally { mock.restore(); }
});

Deno.test("REQ-049: only judges (and admins) reach the Overturn Review routes", async () => {
  const mock = mockFetch({ "/judge/api/overturn-review": { body: DATA } });
  try {
    const reviewer = { email: "r@co.com", role: "reviewer" };
    assertEquals((await call(showHandler, "GET", "/api/judge/overturn-review/show?findingId=f1", reviewer)).status, 403);
    assertEquals((await call(decideHandler, "POST", "/api/judge/overturn-review/decide", reviewer, { findingId: "f1" })).status, 403);
    assertEquals(mock.calls.length, 0, "nothing reaches the backend");
  } finally { mock.restore(); }
});

Deno.test("REQ-049: decide records the call as the signed-in judge, not a form field", async () => {
  const mock = mockFetch({
    "/judge/api/overturn-review/decide": { body: { ok: true, finalized: false } },
    "/judge/api/overturn-review": { body: DATA },
  });
  try {
    await call(decideHandler, "POST", "/api/judge/overturn-review/decide", judge,
      { findingId: "f1", questionIndex: "0", verdict: "reverse", note: "fail stands", by: "someone-else@co.com" });
    const sent = JSON.parse(mock.calls[0].body ?? "{}");
    assertEquals([sent.by, sent.verdict, sent.questionIndex, sent.note], ["team@co.com", "reverse", 0, "fail stands"]);
  } finally { mock.restore(); }
});
