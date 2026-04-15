/** Auth middleware — resolves user from session cookie, redirects to /login if unauthenticated. */
import { define } from "../lib/define.ts";
import { isPublicPath } from "../lib/auth.ts";
import { apiFetch, ApiError } from "../lib/api.ts";

export default define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);

  // Static files and public paths pass through
  if (url.pathname.startsWith("/static") || url.pathname === "/favicon.svg") {
    return ctx.next();
  }
  if (isPublicPath(url.pathname)) {
    return ctx.next();
  }

  // Resolve user from session cookie via backend API
  try {
    const data = await apiFetch<{ email?: string; orgId?: string; role?: string; error?: string }>(
      "/admin/api/me",
      ctx.req,
    );
    if (data.email && data.role) {
      ctx.state.user = {
        email: data.email,
        orgId: data.orgId ?? "",
        role: data.role as "admin" | "judge" | "manager" | "reviewer" | "user",
      };
      return ctx.next();
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // Fall through to redirect
    } else {
      console.error("Auth middleware error:", e);
    }
  }

  // Unauthenticated — redirect to login
  return new Response(null, {
    status: 302,
    headers: { location: `/login?redirect=${encodeURIComponent(url.pathname)}` },
  });
});
