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
// Frontend HTMX fragment routes — these must go to Fresh, not danet
const FRONTEND_API_PREFIXES = [
  "/api/login", "/api/register", "/api/logout",
  "/api/admin/", "/api/review/", "/api/judge/",
  "/api/manager/", "/api/agent/", "/api/chat/",
  "/api/store/buy",  // frontend buy handler (POST); /api/store (GET) stays backend
];

// Backend API routes — everything else under these prefixes goes to danet
const BACKEND_PREFIXES = [
  "/admin", "/audit", "/review/api", "/judge/api", "/manager/api",
  "/agent/api", "/api/qlab", "/api/messages", "/api/users", "/api/events",
  "/api/store", "/api/equip", "/api/badges", "/gamification", "/cron",
  "/webhooks", "/docs",
];

const AUTH_PATHS = ["/login", "/register", "/logout"];

function isBackendRequest(req: Request): boolean {
  const path = new URL(req.url).pathname;

  // Frontend HTMX routes always go to Fresh
  if (FRONTEND_API_PREFIXES.some(p => path.startsWith(p))) return false;

  // Auth page paths: POST → backend (JSON API), GET → frontend (HTML page)
  if (AUTH_PATHS.some(p => path === p)) return req.method === "POST";

  // Health check JSON
  if (path === "/" && req.headers.get("accept")?.includes("application/json")) return true;

  return BACKEND_PREFIXES.some(p => path.startsWith(p));
}

Deno.serve({ port }, (req, info) => {
  if (isBackendRequest(req)) {
    return backendFetch(req);
  }
  return frontendHandler(req, info);
});

console.log(`🚀 Autobottom running on port ${port} (API + Frontend)`);
