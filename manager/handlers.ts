/** HTTP handlers for manager API routes. Uses unified auth. */

import {
  getManagerQueue,
  getManagerFindingDetail,
  submitRemediation,
  getManagerStats,
  backfillManagerQueue,
} from "./kv.ts";
import { resolveEffectiveAuth, listUsers, createUser, deleteUser } from "../auth/kv.ts";
import type { AuthContext, Role } from "../auth/kv.ts";
import { getGameState, getEarnedBadges, emitEvent } from "../lib/kv.ts";
import { getManagerPage } from "./page.ts";

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

// -- Page --

export async function handleManagerPage(_req: Request): Promise<Response> {
  return html(getManagerPage());
}

// -- Me --

export async function handleManagerMe(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role });
}

// -- Queue --

export async function handleManagerQueueList(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const items = await getManagerQueue(auth.orgId);
  return json(items);
}

// -- Finding Detail --

export async function handleManagerFinding(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id parameter required" }, 400);

  const detail = await getManagerFindingDetail(auth.orgId, id);
  if (!detail) return json({ error: "finding not found" }, 404);

  return json(detail);
}

// -- Remediation --

export async function handleManagerRemediate(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { findingId, notes } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);
  if (!notes || typeof notes !== "string" || notes.trim().length < 20) {
    return json({ error: "notes must be at least 20 characters" }, 400);
  }

  const result = await submitRemediation(auth.orgId, findingId, notes.trim(), auth.email);
  if (!result.success) return json({ error: "finding not in manager queue" }, 404);

  // Emit remediation-submitted event
  emitEvent(auth.orgId, auth.email, "remediation-submitted", {
    findingId,
    manager: auth.email,
  }).catch(() => {});

  const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
  return json({ ok: true, findingId, xpGained: result.xpGained, level: result.level, newBadges });
}

// -- Stats --

export async function handleManagerStatsFetch(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const stats = await getManagerStats(auth.orgId);
  return json(stats);
}

// -- Backfill --

export async function handleManagerBackfill(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const result = await backfillManagerQueue(auth.orgId);
  return json(result);
}

// -- Game State --

export async function handleManagerGameState(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const [gameState, badges] = await Promise.all([
    getGameState(auth.orgId, auth.email),
    getEarnedBadges(auth.orgId, auth.email),
  ]);

  return json({ ...gameState, badges: badges.map((b) => b.badgeId) });
}

// -- User Management (managers create and manage their own users) --

export async function handleManagerListAgents(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const allUsers = await listUsers(auth.orgId);
  // Filter to users supervised by this manager (or all non-admin/non-manager for admin)
  const filtered = auth.role === "admin"
    ? allUsers.filter((a) => a.role === "user" || a.role === "reviewer")
    : allUsers.filter((a) => a.supervisor === auth.email);
  return json(filtered);
}

const ALLOWED_ROLES: Role[] = ["user", "reviewer"];

export async function handleManagerCreateAgent(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { email, password, role } = body;
  if (!email || !password) return json({ error: "email and password required" }, 400);

  const assignedRole: Role = ALLOWED_ROLES.includes(role) ? role : "user";

  await createUser(auth.orgId, email, password, assignedRole, auth.email);
  return json({ ok: true, email, role: assignedRole, supervisor: auth.email });
}

export async function handleManagerDeleteAgent(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { email } = body;
  if (!email) return json({ error: "email required" }, 400);

  await deleteUser(auth.orgId, email);
  return json({ ok: true, email });
}
