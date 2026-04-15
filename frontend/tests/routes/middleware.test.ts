import { assertEquals } from "@std/assert";
import { mockFetch } from "../helpers/mock-fetch.ts";

// Import the middleware function
import middleware from "../../routes/_middleware.ts";

function createMiddlewareCtx(pathname: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  const req = new Request(`http://localhost${pathname}`, { headers });
  const state: Record<string, unknown> = {};
  let nextCalled = false;
  const SENTINEL = new Response("next-called", { status: 200 });
  const next = () => { nextCalled = true; return Promise.resolve(SENTINEL); };
  return { ctx: { req, state, next, url: new URL(req.url), destination: "route" as const, params: {}, error: undefined as Error | undefined, Component: (() => null) as any, data: undefined as any, render: (() => new Response()) as any, config: {} as any, codeFrame: undefined, pattern: "/" }, nextCalled: () => nextCalled, state };
}

Deno.test("middleware — static file paths pass through", async () => {
  const { ctx, nextCalled } = createMiddlewareCtx("/static/styles.css");
  await (middleware as any)(ctx);
  assertEquals(nextCalled(), true);
});

Deno.test("middleware — favicon passes through", async () => {
  const { ctx, nextCalled } = createMiddlewareCtx("/favicon.svg");
  await (middleware as any)(ctx);
  assertEquals(nextCalled(), true);
});

Deno.test("middleware — public paths pass through", async () => {
  const { ctx, nextCalled } = createMiddlewareCtx("/login");
  await (middleware as any)(ctx);
  assertEquals(nextCalled(), true);
});

Deno.test("middleware — authenticated user sets ctx.state.user", async () => {
  const mock = mockFetch({
    "/admin/api/me": { body: { email: "alice@co.com", orgId: "org1", role: "admin" } },
  });
  try {
    const { ctx, nextCalled, state } = createMiddlewareCtx("/admin/dashboard", "session=abc");
    await (middleware as any)(ctx);
    assertEquals(nextCalled(), true);
    assertEquals((state.user as any)?.email, "alice@co.com");
    assertEquals((state.user as any)?.role, "admin");
  } finally { mock.restore(); }
});

Deno.test("middleware — 401 from backend redirects to /login", async () => {
  const mock = mockFetch({
    "/admin/api/me": { status: 401, body: { error: "unauthorized" } },
  });
  try {
    const { ctx } = createMiddlewareCtx("/admin/dashboard");
    const res = await (middleware as any)(ctx);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location")?.startsWith("/login"), true);
  } finally { mock.restore(); }
});

Deno.test("middleware — redirect includes encoded pathname", async () => {
  const mock = mockFetch({
    "/admin/api/me": { status: 401, body: {} },
  });
  try {
    const { ctx } = createMiddlewareCtx("/admin/dashboard");
    const res = await (middleware as any)(ctx);
    const location = res.headers.get("location") ?? "";
    assertEquals(location.includes(encodeURIComponent("/admin/dashboard")), true);
  } finally { mock.restore(); }
});

Deno.test("middleware — non-401 error still redirects", async () => {
  const mock = mockFetch({
    "/admin/api/me": { status: 500, body: { error: "internal" } },
  });
  try {
    const { ctx } = createMiddlewareCtx("/review");
    const res = await (middleware as any)(ctx);
    assertEquals(res.status, 302);
  } finally { mock.restore(); }
});

Deno.test("middleware — missing email/role redirects to /login", async () => {
  const mock = mockFetch({
    "/admin/api/me": { body: { email: "", role: "" } },
  });
  try {
    const { ctx } = createMiddlewareCtx("/review");
    const res = await (middleware as any)(ctx);
    assertEquals(res.status, 302);
  } finally { mock.restore(); }
});
