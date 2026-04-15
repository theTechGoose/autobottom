/** Unified entrypoint — serves both backend API (danet) and frontend (Fresh) from one process. */
import "npm:reflect-metadata@0.1.13";

// Initialize Datadog OTel before anything loads
import { initOtel } from "@core/data/datadog-otel/mod.ts";
initOtel();

// Register cron jobs
import { registerCrons } from "@cron/domain/business/cron-core/mod.ts";
registerCrons();

// --- Backend: initialize danet app, extract Hono handler ---
import { DanetApplication } from "@danet/core";
import { AppModule } from "./bootstrap/mod.ts";
import { authenticate } from "@core/business/auth/mod.ts";

const danetApp = new DanetApplication();
await danetApp.init(AppModule);

// @ts-ignore — router is Hono app with .fetch()
const backendFetch: (req: Request) => Promise<Response> = danetApp.router.fetch.bind(danetApp.router);

// --- Frontend: import pre-built Fresh handler from _fresh/server.js ---
// @ts-ignore — generated file, not type-checked
const freshServer = await import("./frontend/_fresh/server.js");
const frontendHandler: (req: Request, info?: Deno.ServeHandlerInfo) => Promise<Response> = freshServer.default.fetch;

// --- Set API_URL for frontend SSR fetches (same origin) ---
const port = Number(Deno.env.get("PORT") ?? 3000);
if (!Deno.env.get("API_URL")) {
  Deno.env.set("API_URL", `http://localhost:${port}`);
}

// --- Route requests ---
// Frontend EXACT page paths — must match exactly (no prefix matching)
const FRONTEND_EXACT_PAGES = new Set([
  "/admin/dashboard", "/admin/users", "/admin/audits", "/admin/weekly-builder",
  "/review", "/review/dashboard",
  "/judge", "/judge/dashboard",
  "/manager", "/agent", "/chat", "/store", "/question-lab",
]);

// Frontend PREFIX paths — anything starting with these goes to Fresh
const FRONTEND_PREFIX_PATHS = [
  "/api/login", "/api/register", "/api/logout",
  "/api/admin/", "/api/review/", "/api/judge/",
  "/api/manager/", "/api/agent/", "/api/chat/",
  "/api/store/buy",
  "/styles.css", "/favicon.svg", "/_fresh/",
];

// Backend API routes — everything under these prefixes goes to danet
const BACKEND_PREFIXES = [
  "/admin", "/audit", "/review/api", "/judge/api", "/manager/api",
  "/agent/api", "/api/qlab", "/api/messages", "/api/users", "/api/events",
  "/api/store", "/api/equip", "/api/badges", "/gamification", "/cron",
  "/webhooks", "/docs",
];

const AUTH_PATHS = ["/login", "/register", "/logout"];

function isBackendRequest(req: Request): boolean {
  const path = new URL(req.url).pathname;

  // Exact frontend page matches
  if (FRONTEND_EXACT_PAGES.has(path)) return false;

  // Frontend prefix matches (HTMX fragments, static assets)
  if (FRONTEND_PREFIX_PATHS.some(p => path.startsWith(p))) return false;

  // Auth page paths: POST → backend (JSON API), GET → frontend (HTML page)
  if (AUTH_PATHS.some(p => path === p)) return req.method === "POST";

  // Root: GET from browser → Fresh (redirect to dashboard), JSON accept → backend health check
  if (path === "/") return req.headers.get("accept")?.includes("application/json") === true;

  // Everything else with a known backend prefix → danet
  return BACKEND_PREFIXES.some(p => path.startsWith(p));
}

Deno.serve({ port }, async (req, info) => {
  const path = new URL(req.url).pathname;

  // /admin/api/me — handled directly (danet's @Req doesn't work via router.fetch)
  if (path === "/admin/api/me") {
    console.log(`[ROUTER] ${req.method} ${path} → direct auth handler`);
    const auth = await authenticate(req);
    if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ email: auth.email, orgId: auth.orgId, role: auth.role });
  }

  if (isBackendRequest(req)) {
    console.log(`[ROUTER] ${req.method} ${path} → backend (danet)`);
    return backendFetch(req);
  }
  console.log(`[ROUTER] ${req.method} ${path} → frontend (Fresh)`);
  return frontendHandler(req, info);
});

console.log(`🚀 Autobottom running on port ${port} (API + Frontend)`);
