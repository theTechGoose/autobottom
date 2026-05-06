import { assertEquals } from "@std/assert";

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

Deno.test("middleware — _fresh paths pass through", async () => {
  const { ctx, nextCalled } = createMiddlewareCtx("/_fresh/js/runtime.js");
  await (middleware as any)(ctx);
  assertEquals(nextCalled(), true);
});

Deno.test("middleware — public paths pass through", async () => {
  const { ctx, nextCalled } = createMiddlewareCtx("/login");
  await (middleware as any)(ctx);
  assertEquals(nextCalled(), true);
});

Deno.test("middleware — no cookie redirects to /login", async () => {
  const { ctx } = createMiddlewareCtx("/admin/dashboard");
  const res = await (middleware as any)(ctx);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location")?.startsWith("/login"), true);
});

Deno.test("middleware — redirect includes encoded pathname", async () => {
  const { ctx } = createMiddlewareCtx("/admin/dashboard");
  const res = await (middleware as any)(ctx);
  const location = res.headers.get("location") ?? "";
  assertEquals(location.includes(encodeURIComponent("/admin/dashboard")), true);
});

Deno.test("middleware — invalid cookie redirects to /login", async () => {
  const { ctx } = createMiddlewareCtx("/review", "session=bogus-token-that-doesnt-exist");
  const res = await (middleware as any)(ctx);
  assertEquals(res.status, 302);
});
