/** Auth middleware — resolves user from session cookie via direct in-process authenticate().
 *  Does NOT make HTTP self-requests — Deno Deploy isolates can't fetch their own localhost. */
import { define } from "../lib/define.ts";
import { isPublicPath, roleRedirect, type GameStateLite } from "../lib/auth.ts";
import { authenticate } from "@core/business/auth/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";

/** Per-isolate game-state cache. 30s TTL keeps the per-page-load Firestore
 *  cost ~free for the same user clicking around. Cross-isolate writes are
 *  picked up at the next eviction; staleness window is bounded. Same SWR
 *  pattern as `_hiddenCache` in src/audit/.../stats-repository. */
const GAME_STATE_TTL_MS = 30_000;
interface CacheEntry { state: GameStateLite; expiresAt: number }
const _gameStateCache = new Map<string, CacheEntry>();

async function getCachedGameState(orgId: string, email: string): Promise<GameStateLite | undefined> {
  const cacheKey = `${orgId}:${email}`;
  const now = Date.now();
  const cached = _gameStateCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.state;
  try {
    const { getGameState } = await import("@gamification/domain/data/gamification-repository/mod.ts");
    const fresh = await getGameState(orgId, email) as unknown as GameStateLite;
    _gameStateCache.set(cacheKey, { state: fresh, expiresAt: now + GAME_STATE_TTL_MS });
    return fresh;
  } catch (err) {
    console.warn(`[MIDDLEWARE] gameState prefetch failed for ${email}:`, err);
    return undefined;
  }
}

/** Build a redirect that's safe for both browser navigation and HTMX swaps.
 *  Without this, an HTMX widget XHR receiving a 302 to /login follows the
 *  redirect, gets 200 + login HTML, and HTMX cheerfully swaps that login
 *  page into the widget's target div. The fix is the HX-Redirect header,
 *  which tells HTMX to do a full-page navigation instead of a swap. */
function authRedirect(req: Request, location: string): Response {
  const isHtmx = req.headers.get("hx-request") === "true";
  if (isHtmx) {
    return new Response(null, { status: 401, headers: { "hx-redirect": location } });
  }
  return new Response(null, { status: 302, headers: { location } });
}

export default define.middleware(async (ctx) => {
  const url = new URL(ctx.req.url);
  const path = url.pathname;

  // Static files pass through
  if (path.startsWith("/static") || path === "/favicon.svg" || path.startsWith("/_fresh")) {
    return ctx.next();
  }

  // Public paths pass through with NO auth lookup. Previously this branch
  // attempted opportunistic auth to populate ctx.state.user for pages
  // like /audit/report that show extra UI for admins — but that put
  // EVERY hit to /login, /api/login, /register, etc. through the auth
  // lane (1-slot Firestore session read), which under any concurrency
  // would queue real login attempts behind unauthenticated form loads
  // and time them out at 24s ("Server busy, please try again").
  //
  // Audit-report's admin-flip UI now does its own auth call inline (see
  // frontend/routes/audit/report.tsx) so only THAT page pays the cost.
  if (isPublicPath(path)) {
    console.log(`[MIDDLEWARE] ${path} — public, pass through`);
    return ctx.next();
  }

  // Authenticate directly in-process — no HTTP self-request.
  // CRITICAL: only the authenticate() call is wrapped in try/catch. Handler errors from
  // ctx.next() must propagate as-is — if we catch them here they get misinterpreted as
  // auth failures and we redirect to /login (confusing to debug). See tests/e2e/modal-endpoints.test.ts.
  let auth: Awaited<ReturnType<typeof authenticate>> = null;
  try {
    auth = await authenticate(ctx.req);
  } catch (e) {
    console.error(`[MIDDLEWARE] ${path} — auth error:`, e);
  }

  if (auth?.email && auth?.role) {
    ctx.state.user = {
      email: auth.email,
      orgId: auth.orgId,
      role: auth.role as "admin" | "super-manager" | "operations-manager" | "judge" | "manager" | "reviewer" | "user",
    };

    // /super-admin/* is gated to a single email. Super Admin bypasses the org
    // impersonation swap below because we want the REAL user's view.
    if (path.startsWith("/super-admin")) {
      if (auth.email !== "ai@monsterrg.com") {
        return authRedirect(ctx.req, "/admin/dashboard");
      }
      return ctx.next();
    }

    // Admin impersonation via ?as=<email> — swap ctx.state.user for the target
    // so the downstream page renders as that user, and stash the real admin
    // email for the golden banner.
    const asEmail = url.searchParams.get("as");
    if (asEmail && auth.role === "admin" && asEmail !== auth.email) {
      try {
        const users = await listUsers(auth.orgId);
        const target = users.find((u) => u.email === asEmail);
        if (target) {
          ctx.state.impersonatedBy = auth.email;
          ctx.state.user = {
            email: target.email,
            orgId: auth.orgId,
            role: target.role as "admin" | "super-manager" | "operations-manager" | "judge" | "manager" | "reviewer" | "user",
          };
        }
      } catch (e) {
        console.error(`[MIDDLEWARE] impersonation lookup failed:`, e);
      }
    }

    // /admin/* and /api/admin/* are gated to real admins. Use the REAL role
    // (auth.role, captured via impersonatedBy) so an admin impersonating a
    // manager can still access admin tools — ctx.state.user.role here may
    // be "manager" because of the impersonation swap above.
    const isAdminPath = path.startsWith("/admin") || path.startsWith("/api/admin");
    const realRole = ctx.state.impersonatedBy ? "admin" : ctx.state.user.role;
    if (isAdminPath && realRole !== "admin") {
      return authRedirect(ctx.req, roleRedirect(ctx.state.user.role));
    }

    // Super-manager (president) has no remediation queue — bounce the bare
    // Manager Portal (the queue page) to the all-departments Audit History.
    if (ctx.state.user.role === "super-manager" && (path === "/manager" || path === "/manager/")) {
      return authRedirect(ctx.req, "/manager/audits");
    }

    // The Operations Portal is the operations manager's own view. Admins keep
    // access (support + `?as=` impersonation); everyone else goes to their own
    // home rather than an empty department rail.
    if (path === "/operations" || path === "/operations/") {
      const opsRole = ctx.state.user.role;
      if (opsRole !== "operations-manager" && opsRole !== "admin") {
        return authRedirect(ctx.req, roleRedirect(opsRole));
      }
    }

    // An operations manager's bare Manager Portal is the org-wide merge of
    // every department they own — the exact view the per-department portal
    // replaces. Send them to the portal instead.
    if (ctx.state.user.role === "operations-manager" && (path === "/manager" || path === "/manager/")) {
      return authRedirect(ctx.req, "/operations");
    }

    // Prefetch game-state for page renders so Sidebar can show equipped
    // cosmetics without an extra round-trip. Skip /api/* (no sidebar) and
    // /login/* (no user yet). Cache hits keep this near-free; misses pay
    // one direct-key Firestore read.
    const isApiPath = path.startsWith("/api/");
    if (!isApiPath) {
      ctx.state.gameState = await getCachedGameState(ctx.state.user.orgId, ctx.state.user.email);
    }

    return ctx.next();
  }

  // Unauthenticated — redirect to login (HX-Redirect for HTMX so widgets
  // don't get the login page swapped into their target slots).
  return authRedirect(ctx.req, `/login?redirect=${encodeURIComponent(path)}`);
});
