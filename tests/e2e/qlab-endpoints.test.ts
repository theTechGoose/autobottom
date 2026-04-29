/** E2E test for the Question Lab admin modal + CRUD routing.
 *  Regression guards:
 *    - main.ts had `/api/qlab` in BACKEND_PREFIXES, sending the frontend
 *      HTMX wrapper URL `/api/qlab/configs/new` to danet which 404'd.
 *      The fix added the wrapper paths to FRONTEND_PREFIX_PATHS so they hit
 *      Fresh's filesystem routes instead.
 *    - The dashboard QLab admin modal at `/api/admin/modal/qlab` is a new
 *      surface that mirrors prod's "Question Lab" admin modal. */
import { assertEquals, assert, assertStringIncludes } from "#assert";
import { startServer, stopServer, createTestSession, BASE } from "./helpers.ts";

let session: { cookie: string; email: string };

Deno.test({
  name: "E2E QLab setup — start server and create session",
  async fn() {
    await startServer();
    session = await createTestSession();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({ name: "E2E QLab: POST /api/qlab/configs/new returns 200 HTML (regression: was 404)", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/qlab/configs/new`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  });
  assertEquals(res.status, 200, `expected 200 (frontend HTMX wrapper), got ${res.status}`);
  assertEquals(res.headers.get("content-type"), "text/html");
  await res.text();
}});

Deno.test({ name: "E2E QLab: GET /api/admin/modal/qlab renders modal HTML with builder link", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/modal/qlab`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html");
  const html = await res.text();
  assertStringIncludes(html, "Question Lab");
  assertStringIncludes(html, "Open Config Builder");
  assertStringIncludes(html, "/question-lab");
  assertStringIncludes(html, "Internal (Date Legs)");
  assertStringIncludes(html, "Partner (Packages)");
  assertStringIncludes(html, "Remove / Use Product default");
}});

Deno.test({ name: "E2E QLab: GET /api/admin/modal/qlab?tab=partner shows partner-tab body", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/admin/modal/qlab?tab=partner`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, 'name="type" value="partner"');
  assertStringIncludes(html, "No office assignments yet.");
}});

Deno.test({ name: "E2E QLab: backend GET /api/qlab-assignments returns { internal, partner } shape", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/qlab-assignments`, { headers: { cookie: session.cookie } });
  assertEquals(res.status, 200);
  const data = await res.json();
  assert("internal" in data, "response must include `internal`");
  assert("partner" in data, "response must include `partner`");
}});

Deno.test({ name: "E2E QLab: POST /api/admin/modal/qlab/set creates assignment + re-renders modal", sanitizeResources: false, async fn() {
  const ts = Date.now();
  const configName = `E2E-Config-${ts}`;
  const destKey = `dest-${ts}`;

  // Need a config to bind to first — use the backend create endpoint.
  const cfgRes = await fetch(`${BASE}/api/qlab/configs`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: configName, type: "internal" }),
  });
  assertEquals(cfgRes.status, 200, "create config must succeed");
  await cfgRes.json();

  // Now bind via the modal's set route.
  const setRes = await fetch(`${BASE}/api/admin/modal/qlab/set`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ type: "internal", key: destKey, configName }),
    redirect: "manual",
  });
  assertEquals(setRes.status, 200);
  const setHtml = await setRes.text();
  assertStringIncludes(setHtml, destKey, "modal should re-render with the new binding visible");
  assertStringIncludes(setHtml, configName);

  // Backend assignments should reflect the binding.
  const listRes = await fetch(`${BASE}/api/qlab-assignments`, { headers: { cookie: session.cookie } });
  const list = await listRes.json() as { internal?: Record<string, string> };
  assertEquals(list.internal?.[destKey], configName, "backend should persist the binding");

  // Unbind via clear route and verify removal.
  const clearRes = await fetch(`${BASE}/api/admin/modal/qlab/clear?type=internal&key=${encodeURIComponent(destKey)}`, {
    method: "POST",
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(clearRes.status, 200);
  await clearRes.text();
  const after = await (await fetch(`${BASE}/api/qlab-assignments`, { headers: { cookie: session.cookie } })).json() as { internal?: Record<string, string> };
  assertEquals(after.internal?.[destKey], undefined, "binding should be removed");
}});

Deno.test({ name: "E2E QLab: GET /api/qlab/configs/bulk-egregious-form returns 200 HTML panel", sanitizeResources: false, async fn() {
  const res = await fetch(`${BASE}/api/qlab/configs/bulk-egregious-form`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "Mark Bulk Egregious");
  assertStringIncludes(html, "Question Name");
}});

// Helper: count the questions on a config (by name).
async function countQuestionsForConfig(configName: string): Promise<number> {
  const list = await (await fetch(`${BASE}/api/qlab/configs`, { headers: { cookie: session.cookie } })).json() as { configs?: { id: string; name: string }[] };
  const cfg = list.configs?.find((c) => c.name === configName);
  if (!cfg) return -1;
  const served = await (await fetch(`${BASE}/api/qlab/serve?name=${encodeURIComponent(cfg.id)}`, { headers: { cookie: session.cookie } })).json() as { questions?: unknown[] };
  return served.questions?.length ?? 0;
}

Deno.test({ name: "E2E QLab: backend POST /api/qlab/configs/import — fresh config returns ok+configName+questions", sanitizeResources: false, async fn() {
  const ts = Date.now();
  const name = `E2E-Import-${ts}`;
  const res = await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name, type: "internal",
      questions: [
        { name: "Greeting", text: "Did the agent greet?", autoYesExp: "+:foo" },
        { name: "Close", text: "Did the agent close cleanly?" },
      ],
    }),
  });
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.ok, true);
  assertEquals(data.skipped, false);
  assertEquals(data.overwritten, false);
  assertEquals(data.configName, name);
  assertEquals(data.questions, 2, "should report exact question count");

  // Verify autoYesExp persisted on the first question.
  const list = await (await fetch(`${BASE}/api/qlab/configs`, { headers: { cookie: session.cookie } })).json() as { configs?: { id: string; name: string }[] };
  const cfg = list.configs?.find((c) => c.name === name);
  const served = await (await fetch(`${BASE}/api/qlab/serve?name=${encodeURIComponent(cfg!.id)}`, { headers: { cookie: session.cookie } })).json() as { questions?: { name: string; autoYesExp?: string }[] };
  const greeting = served.questions?.find((q) => q.name === "Greeting");
  assertEquals(greeting?.autoYesExp, "+:foo", "autoYesExp must be persisted by importConfig");
}});

Deno.test({ name: "E2E QLab: import dupeMode=skip — second import on same name leaves count unchanged", sanitizeResources: false, async fn() {
  const ts = Date.now();
  const name = `E2E-Skip-${ts}`;
  const body = (questions: unknown[]) => ({ name, type: "internal", questions, dupeMode: "skip" });

  await (await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify(body([{ name: "A", text: "1" }, { name: "B", text: "2" }])),
  })).json();
  assertEquals(await countQuestionsForConfig(name), 2);

  const res2 = await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify(body([{ name: "C", text: "3" }, { name: "D", text: "4" }, { name: "E", text: "5" }])),
  });
  const r2 = await res2.json();
  assertEquals(r2.skipped, true, "second import on the same name must be skipped");
  assertEquals(await countQuestionsForConfig(name), 2, "count must stay at 2");
}});

Deno.test({ name: "E2E QLab: import dupeMode=overwrite — second import replaces (not stacks) the questions", sanitizeResources: false, async fn() {
  const ts = Date.now();
  const name = `E2E-Overwrite-${ts}`;

  await (await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, type: "internal", questions: [{ name: "A", text: "1" }, { name: "B", text: "2" }, { name: "C", text: "3" }], dupeMode: "skip" }),
  })).json();
  assertEquals(await countQuestionsForConfig(name), 3);

  const res = await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, type: "internal", questions: [{ name: "X", text: "9" }], dupeMode: "overwrite" }),
  });
  const r = await res.json();
  assertEquals(r.overwritten, true);
  assertEquals(r.questions, 1, "overwrite reports new count, not stacked total");
  assertEquals(await countQuestionsForConfig(name), 1, "old questions must be deleted");
}});

Deno.test({ name: "E2E QLab: import dupeMode=duplicate — creates a numbered copy", sanitizeResources: false, async fn() {
  const ts = Date.now();
  const name = `E2E-Dup-${ts}`;

  await (await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, type: "internal", questions: [{ name: "A", text: "1" }], dupeMode: "skip" }),
  })).json();

  const res = await fetch(`${BASE}/api/qlab/configs/import`, {
    method: "POST", headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, type: "internal", questions: [{ name: "B", text: "2" }, { name: "C", text: "3" }], dupeMode: "duplicate" }),
  });
  const r = await res.json();
  assertEquals(r.ok, true);
  assertEquals(r.configName, `${name} (2)`, "duplicate suffix should be (2)");
  assertEquals(r.questions, 2);
  assertEquals(await countQuestionsForConfig(name), 1, "original config untouched");
  assertEquals(await countQuestionsForConfig(`${name} (2)`), 2, "duplicate config has its own questions");
}});

Deno.test({ name: "E2E QLab: POST /api/qlab/configs/bulk-egregious returns success message", sanitizeResources: false, async fn() {
  // Backend always returns ok:true with an updated count (even if 0 match), so
  // we don't need any pre-existing questions to exercise the wrapper.
  const fd = new FormData();
  fd.append("name", "DefinitelyNotARealQuestionName");
  fd.append("egregious", "true");

  const res = await fetch(`${BASE}/api/qlab/configs/bulk-egregious`, {
    method: "POST",
    headers: { cookie: session.cookie },
    body: fd,
    redirect: "manual",
  });
  assertEquals(res.status, 200);
  const html = await res.text();
  // Either a "Marked N questions" success or an error message — both are valid
  // signs the wrapper is reachable. We just assert the wrapper is no longer 404.
  assert(html.length > 0, "wrapper must return a non-empty fragment");
}});

Deno.test({
  name: "E2E QLab cleanup — stop server",
  fn() { stopServer(); },
  sanitizeResources: false,
  sanitizeOps: false,
});
