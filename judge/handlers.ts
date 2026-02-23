/** HTTP handlers for judge API routes. */

import {
  claimNextItem,
  recordDecision,
  undoDecision,
  createUser,
  verifyUser,
  hasAnyUsers,
  createSession,
  getSession,
  deleteSession,
  getJudgeStats,
  getJudgeDashboardData,
} from "./kv.ts";
import { getJudgePage } from "./page.ts";
import { getJudgeDashboardPage } from "./dashboard.ts";

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
  const match = cookie.match(/judge_session=([^;]+)/);
  return match?.[1] ?? null;
}

async function authenticate(req: Request): Promise<string | null> {
  const token = parseCookie(req);
  if (!token) return null;
  return getSession(token);
}

function sessionCookie(token: string): string {
  return `judge_session=${token}; HttpOnly; Path=/judge; SameSite=Strict; Max-Age=86400`;
}

function clearCookie(): string {
  return `judge_session=; HttpOnly; Path=/judge; SameSite=Strict; Max-Age=0`;
}

// -- Page --

export async function handleJudgePage(_req: Request): Promise<Response> {
  return html(getJudgePage());
}

// -- Auth --

export async function handleSetup(req: Request): Promise<Response> {
  const exists = await hasAnyUsers();
  if (exists) return json({ error: "Users already exist. Use /judge/api/users to add more." }, 403);

  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  await createUser(username, password);
  const token = await createSession(username);

  return json({ ok: true, username }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function handleLogin(req: Request): Promise<Response> {
  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  const valid = await verifyUser(username, password);
  if (!valid) return json({ error: "invalid credentials" }, 401);

  const token = await createSession(username);
  return json({ ok: true, username }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function handleLogout(req: Request): Promise<Response> {
  const token = parseCookie(req);
  if (token) await deleteSession(token);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

export async function handleAddUser(req: Request): Promise<Response> {
  const judge = await authenticate(req);
  if (!judge) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  await createUser(username, password);
  return json({ ok: true, username });
}

// -- Judge Actions --

export async function handleNext(req: Request): Promise<Response> {
  const judge = await authenticate(req);
  if (!judge) return json({ error: "unauthorized" }, 401);

  const result = await claimNextItem(judge);
  return json(result);
}

export async function handleDecide(req: Request): Promise<Response> {
  const judge = await authenticate(req);
  if (!judge) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const { findingId, questionIndex, decision } = body;

  if (!findingId || questionIndex === undefined || !decision) {
    return json({ error: "findingId, questionIndex, and decision required" }, 400);
  }
  if (decision !== "uphold" && decision !== "overturn") {
    return json({ error: "decision must be 'uphold' or 'overturn'" }, 400);
  }

  const result = await recordDecision(findingId, questionIndex, decision, judge);
  if (!result.success) {
    return json({ error: "failed to record decision (lock expired or not owned)" }, 409);
  }

  const next = await claimNextItem(judge);

  return json({ decided: { findingId, questionIndex, decision }, auditComplete: result.auditComplete, next });
}

export async function handleBack(req: Request): Promise<Response> {
  const judge = await authenticate(req);
  if (!judge) return json({ error: "unauthorized" }, 401);

  const result = await undoDecision(judge);
  if (!result.restored) {
    return json({ error: "nothing to undo" }, 404);
  }

  return json({
    current: result.restored,
    transcript: result.transcript,
    peek: result.peek,
    remaining: result.remaining,
  });
}

// -- Stats --

export async function handleStats(req: Request): Promise<Response> {
  const judge = await authenticate(req);
  if (!judge) return json({ error: "unauthorized" }, 401);

  const stats = await getJudgeStats();
  return json(stats);
}

// -- Dashboard --

export async function handleDashboardPage(_req: Request): Promise<Response> {
  return html(getJudgeDashboardPage());
}

export async function handleDashboardData(_req: Request): Promise<Response> {
  const data = await getJudgeDashboardData();
  return json(data);
}
