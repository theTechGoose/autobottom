/** HTTP handlers for review API routes. */

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
  getReviewStats,
  backfillFromFinished,
} from "./kv.ts";
import { getWebhookConfig, saveWebhookConfig } from "../lib/kv.ts";
import type { WebhookConfig } from "../lib/kv.ts";
import { getReviewPage } from "./page.ts";

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function parseCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/review_session=([^;]+)/);
  return match?.[1] ?? null;
}

async function authenticate(req: Request): Promise<string | null> {
  const token = parseCookie(req);
  if (!token) return null;
  return getSession(token);
}

function sessionCookie(token: string): string {
  return `review_session=${token}; HttpOnly; Path=/review; SameSite=Strict; Max-Age=86400`;
}

function clearCookie(): string {
  return `review_session=; HttpOnly; Path=/review; SameSite=Strict; Max-Age=0`;
}

// -- Page --

export async function handleReviewPage(_req: Request): Promise<Response> {
  return html(getReviewPage());
}

// -- Auth --

export async function handleSetup(req: Request): Promise<Response> {
  const exists = await hasAnyUsers();
  if (exists) return json({ error: "Users already exist. Use /review/api/users to add more." }, 403);

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
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: "username and password required" }, 400);

  await createUser(username, password);
  return json({ ok: true, username });
}

// -- Review Actions --

export async function handleNext(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const result = await claimNextItem(reviewer);
  return json(result);
}

export async function handleDecide(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const { findingId, questionIndex, decision } = body;

  if (!findingId || questionIndex === undefined || !decision) {
    return json({ error: "findingId, questionIndex, and decision required" }, 400);
  }
  if (decision !== "confirm" && decision !== "flip") {
    return json({ error: "decision must be 'confirm' or 'flip'" }, 400);
  }

  const result = await recordDecision(findingId, questionIndex, decision, reviewer);
  if (!result.success) {
    return json({ error: "failed to record decision (lock expired or not owned)" }, 409);
  }

  // Claim next item for the reviewer
  const next = await claimNextItem(reviewer);

  return json({ decided: { findingId, questionIndex, decision }, auditComplete: result.auditComplete, next });
}

export async function handleBack(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const result = await undoDecision(reviewer);
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

// -- Settings --

export async function handleGetSettings(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const settings = await getWebhookConfig("terminate");
  return json(settings ?? { postUrl: "", postHeaders: {} });
}

export async function handleSaveSettings(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const body = await req.json();
  const settings: WebhookConfig = {
    postUrl: body.postUrl ?? "",
    postHeaders: body.postHeaders ?? {},
  };

  await saveWebhookConfig("terminate", settings);
  return json({ ok: true });
}

// -- Stats --

export async function handleStats(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const stats = await getReviewStats();
  return json(stats);
}

// -- Backfill --

export async function handleBackfill(req: Request): Promise<Response> {
  const reviewer = await authenticate(req);
  if (!reviewer) return json({ error: "unauthorized" }, 401);

  const result = await backfillFromFinished();
  return json(result);
}
