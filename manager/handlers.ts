/** HTTP handlers for manager API routes. */

import {
  createManagerUser,
  verifyManagerUser,
  hasAnyManagerUsers,
  createManagerSession,
  getManagerSession,
  deleteManagerSession,
  getManagerQueue,
  getManagerFindingDetail,
  submitRemediation,
  getManagerStats,
  backfillManagerQueue,
} from "./kv.ts";
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

function parseCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/manager_session=([^;]+)/);
  return match?.[1] ?? null;
}

async function authenticate(req: Request): Promise<string | null> {
  const token = parseCookie(req);
  if (!token) return null;
  return getManagerSession(token);
}

function sessionCookie(token: string): string {
  return `manager_session=${token}; HttpOnly; Path=/manager; SameSite=Strict; Max-Age=86400`;
}

function clearCookie(): string {
  return `manager_session=; HttpOnly; Path=/manager; SameSite=Strict; Max-Age=0`;
}

// -- Page --

export async function handleManagerPage(_req: Request): Promise<Response> {
  return html(getManagerPage());
}

// -- Auth --

export async function handleManagerSetup(req: Request): Promise<Response> {
  const exists = await hasAnyManagerUsers();
  if (exists) return json({ error: "Manager users already exist. Use /manager/api/users to add more." }, 403);

  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  await createManagerUser(username, password);
  const token = await createManagerSession(username);
  return json({ ok: true, username }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function handleManagerLogin(req: Request): Promise<Response> {
  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  const valid = await verifyManagerUser(username, password);
  if (!valid) return json({ error: "invalid credentials" }, 401);

  const token = await createManagerSession(username);
  return json({ ok: true, username }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function handleManagerLogout(req: Request): Promise<Response> {
  const token = parseCookie(req);
  if (token) await deleteManagerSession(token);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

export async function handleManagerAddUser(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  await createManagerUser(username, password);
  return json({ ok: true, username });
}

export async function handleManagerMe(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  return json({ username: user });
}

// -- Queue --

export async function handleManagerQueueList(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const items = await getManagerQueue();
  return json(items);
}

// -- Finding Detail --

export async function handleManagerFinding(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id parameter required" }, 400);

  const detail = await getManagerFindingDetail(id);
  if (!detail) return json({ error: "finding not found" }, 404);

  return json(detail);
}

// -- Remediation --

export async function handleManagerRemediate(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const { findingId, notes } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);
  if (!notes || typeof notes !== "string" || notes.trim().length < 20) {
    return json({ error: "notes must be at least 20 characters" }, 400);
  }

  const success = await submitRemediation(findingId, notes.trim(), user);
  if (!success) return json({ error: "finding not in manager queue" }, 404);

  return json({ ok: true, findingId });
}

// -- Stats --

export async function handleManagerStatsFetch(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const stats = await getManagerStats();
  return json(stats);
}

// -- Backfill --

export async function handleManagerBackfill(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const result = await backfillManagerQueue();
  return json(result);
}
