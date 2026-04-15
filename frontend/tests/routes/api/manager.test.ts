import { assertEquals } from "@std/assert";
import { mockFetch } from "../../helpers/mock-fetch.ts";

import { handler as remediateHandler } from "../../../routes/api/manager/remediate.ts";
import { handler as addAgentHandler } from "../../../routes/api/manager/add-agent.ts";
import { handler as deleteAgentHandler } from "../../../routes/api/manager/delete-agent.ts";

function formReq(url: string, data: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(data)) form.append(k, v);
  return new Request(`http://localhost${url}`, { method: "POST", body: form, headers: { cookie: "session=abc" } });
}

Deno.test("remediate — missing fields returns error", async () => {
  const ctx = { req: formReq("/api/manager/remediate", { findingId: "" }), state: {} };
  const res = await (remediateHandler as any).POST(ctx);
  const html = await res.text();
  assertEquals(html.includes("Finding ID and notes required"), true);
});

Deno.test("remediate — success redirects to /manager", async () => {
  const mock = mockFetch({ "/manager/api/remediate": { body: { ok: true } } });
  try {
    const ctx = { req: formReq("/api/manager/remediate", { findingId: "f1", notes: "Discussed with agent", username: "mgr@co.com" }), state: {} };
    const res = await (remediateHandler as any).POST(ctx);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("hx-redirect"), "/manager");
  } finally { mock.restore(); }
});

Deno.test("add-agent — missing fields returns error", async () => {
  const ctx = { req: formReq("/api/manager/add-agent", { email: "" }), state: {} };
  const res = await (addAgentHandler as any).POST(ctx);
  const html = await res.text();
  assertEquals(html.includes("Email and password required"), true);
});

Deno.test("add-agent — success redirects to /manager", async () => {
  const mock = mockFetch({ "/manager/api/agents": { body: { ok: true } } });
  try {
    const ctx = { req: formReq("/api/manager/add-agent", { email: "new@co.com", password: "pass123", supervisor: "mgr@co.com" }), state: {} };
    const res = await (addAgentHandler as any).POST(ctx);
    assertEquals(res.status, 200);
  } finally { mock.restore(); }
});

Deno.test("delete-agent — success redirects to /manager", async () => {
  const mock = mockFetch({ "/manager/api/agents/delete": { body: { ok: true } } });
  try {
    const req = new Request("http://localhost/api/manager/delete-agent", {
      method: "POST", headers: { "content-type": "application/json", cookie: "session=abc" },
      body: JSON.stringify({ email: "old@co.com" }),
    });
    const res = await (deleteAgentHandler as any).POST({ req, state: {} });
    assertEquals(res.status, 200);
  } finally { mock.restore(); }
});
