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
const backendFetch = danetApp.router.fetch.bind(danetApp.router);

// --- Frontend: initialize Fresh app, extract handler ---
import { App, staticFiles } from "@fresh/core";
import type { State } from "./frontend/lib/auth.ts";

const freshApp = new App<State>({ mode: "development" });
freshApp.use(staticFiles());
freshApp.fsRoutes();
const frontendHandler = await freshApp.handler();

// --- Set API_URL for frontend SSR fetches (same origin) ---
const port = Number(Deno.env.get("PORT") ?? 3000);
if (!Deno.env.get("API_URL")) {
  Deno.env.set("API_URL", `http://localhost:${port}`);
}

// --- Route requests ---
const BACKEND_PREFIXES = [
  "/admin", "/audit", "/review/api", "/judge/api", "/manager/api",
  "/agent/api", "/api/qlab", "/api/messages", "/api/users", "/api/events",
  "/api/store", "/api/equip", "/api/badges", "/gamification", "/cron",
  "/webhooks", "/docs",
];

// /login and /register: POST → backend (auth API), GET → frontend (HTML page)
const AUTH_PATHS = ["/login", "/register", "/logout"];

function isBackendRequest(req: Request): boolean {
  const path = new URL(req.url).pathname;

  // Auth paths: POST goes to backend, GET goes to frontend
  if (AUTH_PATHS.some(p => path === p)) {
    return req.method === "POST";
  }

  // Health check
  if (path === "/" && req.headers.get("accept")?.includes("application/json")) {
    return true;
  }

  return BACKEND_PREFIXES.some(p => path.startsWith(p));
}

Deno.serve({ port }, (req, info) => {
  if (isBackendRequest(req)) {
    return backendFetch(req);
  }
  return frontendHandler(req, info);
});

console.log(`🚀 Autobottom running on port ${port} (API + Frontend)`);


