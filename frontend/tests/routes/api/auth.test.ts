import { assertEquals } from "@std/assert";
import { mockFetch, createCtx } from "../../helpers/mock-fetch.ts";

// Login handler
import { handler as loginHandler } from "../../../routes/api/login.ts";
// Register handler
import { handler as registerHandler } from "../../../routes/api/register.ts";
// Logout handler
import { handler as logoutHandler } from "../../../routes/api/logout.ts";

// Helper to create form-data request
function formReq(url: string, data: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(data)) form.append(k, v);
  return new Request(`http://localhost${url}`, { method: "POST", body: form });
}

// === LOGIN ===

Deno.test("login — missing email redirects back to /login", async () => {
  const ctx = { req: formReq("/api/login", { password: "pass" }), state: {} };
  const res = await (loginHandler as any).POST(ctx);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/login");
});

Deno.test("login — missing password redirects back to /login", async () => {
  const ctx = { req: formReq("/api/login", { email: "a@b.com" }), state: {} };
  const res = await (loginHandler as any).POST(ctx);
  assertEquals(res.status, 302);
});

Deno.test("login — backend error redirects back to /login", async () => {
  const mock = mockFetch({ "/login": { status: 401, body: { error: "Invalid credentials" } } });
  try {
    const ctx = { req: formReq("/api/login", { email: "a@b.com", password: "wrong" }), state: {} };
    const res = await (loginHandler as any).POST(ctx);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/login");
  } finally { mock.restore(); }
});

Deno.test("login — success sets cookie and 303 redirects", async () => {
  const mock = mockFetch({ "/login": { body: { ok: true, role: "admin", cookie: "session=xyz123; Path=/; HttpOnly" } } });
  try {
    const ctx = { req: formReq("/api/login", { email: "a@b.com", password: "pass" }), state: {} };
    const res = await (loginHandler as any).POST(ctx);
    assertEquals(res.status, 303);
    assertEquals(res.headers.get("set-cookie"), "session=xyz123; Path=/; HttpOnly");
    assertEquals(res.headers.get("location"), "/admin/dashboard");
  } finally { mock.restore(); }
});

Deno.test("login — reviewer role redirects to /review", async () => {
  const mock = mockFetch({ "/login": { body: { ok: true, role: "reviewer", cookie: "session=abc" } } });
  try {
    const ctx = { req: formReq("/api/login", { email: "r@b.com", password: "pass" }), state: {} };
    const res = await (loginHandler as any).POST(ctx);
    assertEquals(res.headers.get("location"), "/review");
  } finally { mock.restore(); }
});

Deno.test("login — network error redirects back to /login", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network down"); };
  try {
    const ctx = { req: formReq("/api/login", { email: "a@b.com", password: "pass" }), state: {} };
    const res = await (loginHandler as any).POST(ctx);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/login");
  } finally { globalThis.fetch = original; }
});

// === REGISTER ===

Deno.test("register — missing fields redirects back to /register", async () => {
  const ctx = { req: formReq("/api/register", { email: "a@b.com" }), state: {} };
  const res = await (registerHandler as any).POST(ctx);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/register");
});

Deno.test("register — success sets cookie and 303 redirects", async () => {
  const mock = mockFetch({ "/register": { body: { ok: true, cookie: "session=reg123" } } });
  try {
    const ctx = { req: formReq("/api/register", { orgName: "Test", email: "a@b.com", password: "pass123" }), state: {} };
    const res = await (registerHandler as any).POST(ctx);
    assertEquals(res.status, 303);
    assertEquals(res.headers.get("set-cookie"), "session=reg123");
    assertEquals(res.headers.get("location"), "/admin/dashboard");
  } finally { mock.restore(); }
});

Deno.test("register — backend error redirects back to /register", async () => {
  const mock = mockFetch({ "/register": { status: 400, body: { error: "Email taken" } } });
  try {
    const ctx = { req: formReq("/api/register", { orgName: "Test", email: "a@b.com", password: "pass" }), state: {} };
    const res = await (registerHandler as any).POST(ctx);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/register");
  } finally { mock.restore(); }
});

Deno.test("register — network error redirects back to /register", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("timeout"); };
  try {
    const ctx = { req: formReq("/api/register", { orgName: "X", email: "a@b.com", password: "pass" }), state: {} };
    const res = await (registerHandler as any).POST(ctx);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/register");
  } finally { globalThis.fetch = original; }
});

// === LOGOUT ===

Deno.test("logout — clears cookie and redirects to /login", async () => {
  const ctx = createCtx("/api/logout");
  const res = await (logoutHandler as any).GET(ctx);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/login");
  const cookie = res.headers.get("set-cookie") ?? "";
  assertEquals(cookie.includes("session="), true);
  assertEquals(cookie.includes("Expires="), true);
});
