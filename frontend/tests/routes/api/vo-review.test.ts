/** The review submit route (REQ-035): what a refused review answers, and
 *  where a saved one sends the page. */
import { assert, assertEquals } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";
import { handler as reviewHandler } from "../../../routes/api/vo/review.ts";

function post(data: Record<string, string>, htmx = false) {
  const form = new FormData();
  for (const [k, v] of Object.entries(data)) form.append(k, v);
  return {
    req: new Request("http://localhost/api/vo/review", { method: "POST", body: form, headers: htmx ? { "hx-request": "true" } : {} }),
    state: {},
  };
}

// deno-lint-ignore no-explicit-any
const POST = (ctx: unknown) => (reviewHandler as any).POST(ctx) as Promise<Response>;

Deno.test("REQ-035: a second review is refused with 409 and says it was already reviewed", async () => {
  const m = mockFetch({ "/vo/api/review": { status: 409, body: { error: "already-reviewed" } } });
  try {
    const res = await POST(post({ findingId: "f1", note: "again" }));
    assertEquals(res.status, 409);
    assert((await res.text()).includes("already been reviewed"));
  } finally { m.restore(); }
});

Deno.test("REQ-035: inside the modal (HTMX) a refusal comes back 200 so the reason shows", async () => {
  const m = mockFetch({ "/vo/api/review": { status: 403, body: { error: "not-in-scope" } } });
  try {
    const res = await POST(post({ findingId: "f1", note: "x" }, true));
    assertEquals(res.status, 200);
    assert((await res.text()).includes("isn't in this login's queue"));
  } finally { m.restore(); }
});

Deno.test("REQ-035: a saved review from an audit page goes back to the queue it came from, never off-site", async () => {
  const m = mockFetch({ "/vo/api/review": { status: 200, body: { ok: true } } });
  try {
    const back = await POST(post({ findingId: "f1", note: "ok", returnTo: "/vo?member=Dana" }));
    assertEquals(back.headers.get("HX-Redirect"), "/vo?member=Dana");
    const offsite = await POST(post({ findingId: "f1", note: "ok", returnTo: "//evil.example" }));
    assertEquals(offsite.headers.get("HX-Redirect"), "/vo");
  } finally { m.restore(); }
});
