/** Shared helper functions for entrypoint handlers. */

import { authenticate, resolveEffectiveAuth } from "../domain/coordinators/auth/mod.ts";
import type { AuthContext } from "../domain/coordinators/auth/mod.ts";
import { Kv } from "../domain/data/kv/mod.ts";
import type { OrgId } from "../domain/data/kv/mod.ts";

export type Handler = (req: Request) => Promise<Response>;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

export async function requireAdminAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  if (auth.role !== "admin") return json({ error: "forbidden" }, 403);
  return auth;
}

/** Resolve orgId: try auth, then ?org query param, then default org. */
export async function resolveOrgId(req: Request): Promise<OrgId | null> {
  const auth = await authenticate(req);
  if (auth) return auth.orgId;
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  if (org) return org;
  const kv = await Kv.getInstance();
  const def = await kv.db.get<string>(["default-org"]);
  return def.value ?? null;
}

/** Wrap a controller function that needs orgId (resolved from auth/query/default). */
export function withOrgId(fn: (orgId: OrgId, req: Request) => Promise<Response>): Handler {
  return async (req) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return json({ error: "org required (authenticate or provide ?org=)" }, 400);
    return fn(orgId, req);
  };
}

/** Wrap a POST controller function that reads orgId from the request body. */
export function withBodyOrg(fn: (orgId: OrgId, req: Request) => Promise<Response>): Handler {
  return async (req) => {
    const cloned = req.clone();
    try {
      const body = await cloned.json();
      if (!body.orgId) return json({ error: "orgId required in body" }, 400);
      return fn(body.orgId, req);
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
  };
}

export const ROLE_HOME: Record<string, string> = {
  admin: "/admin/dashboard",
  judge: "/judge/dashboard",
  manager: "/manager",
  reviewer: "/review/dashboard",
  user: "/agent",
};

export function requireRolePageAuth(allowedRoles: string[], handler: Handler): Handler {
  return async (req) => {
    const auth = await authenticate(req);
    if (!auth) return Response.redirect(new URL("/login", req.url).href, 302);
    if (auth.role !== "admin" && !allowedRoles.includes(auth.role))
      return Response.redirect(new URL(ROLE_HOME[auth.role] ?? "/", req.url).href, 302);
    return handler(req);
  };
}
