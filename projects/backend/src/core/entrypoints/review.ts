/** HTTP handlers for review API routes. Uses unified auth. */

import { Kv } from "../domain/data/kv/mod.ts";
import type { WebhookConfig } from "../domain/data/kv/mod.ts";
import {
  claimNextItem,
  recordDecision,
  undoDecision,
  getReviewStats,
  backfillFromFinished,
  getReviewerDashboardData,
} from "../domain/coordinators/review/mod.ts";

import { resolveEffectiveAuth } from "../domain/coordinators/auth/mod.ts";
import type { AuthContext } from "../domain/coordinators/auth/mod.ts";

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

// -- Review Actions --

export async function handleNext(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const result = await claimNextItem(auth.orgId, auth.email);
  return json(result);
}

export async function handleDecide(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { findingId, questionIndex, decision, combo, level, speedMs } = body;

  if (!findingId || questionIndex === undefined || !decision) {
    return json({ error: "findingId, questionIndex, and decision required" }, 400);
  }
  if (decision !== "confirm" && decision !== "flip") {
    return json({ error: "decision must be 'confirm' or 'flip'" }, 400);
  }

  const result = await recordDecision(
    auth.orgId, findingId, questionIndex, decision, auth.email,
    combo ?? undefined, level ?? undefined, speedMs ?? undefined,
  );
  if (!result.success) {
    return json({ error: "failed to record decision (lock expired or not owned)" }, 409);
  }

  // Emit review-decided event when an audit's review is fully complete
  if (result.auditComplete) {
    (await Kv.getInstance()).emitEvent(auth.orgId, auth.email, "review-decided", {
      findingId,
      reviewer: auth.email,
      decision,
    }).catch(() => {});
  }

  // Claim next item for the reviewer
  const next = await claimNextItem(auth.orgId, auth.email);

  const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
  return json({ decided: { findingId, questionIndex, decision }, auditComplete: result.auditComplete, next, newBadges });
}

export async function handleBack(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const result = await undoDecision(auth.orgId, auth.email);
  if (!result.restored) {
    return json({ error: "nothing to undo" }, 404);
  }

  return json({
    current: result.restored,
    transcript: result.transcript,
    peek: result.peek,
    remaining: result.remaining,
    auditRemaining: result.auditRemaining,
  });
}

// -- Settings --

export async function handleGetSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const settings = await (await Kv.getInstance()).getWebhookConfig(auth.orgId, "terminate");
  return json(settings ?? { postUrl: "", postHeaders: {} });
}

export async function handleSaveSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const settings: WebhookConfig = {
    postUrl: body.postUrl ?? "",
    postHeaders: body.postHeaders ?? {},
  };

  await (await Kv.getInstance()).saveWebhookConfig(auth.orgId, "terminate", settings);
  return json({ ok: true });
}

// -- Stats --

export async function handleStats(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const stats = await getReviewStats(auth.orgId);
  return json(stats);
}

// -- Backfill --

export async function handleBackfill(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const result = await backfillFromFinished(auth.orgId);
  return json(result);
}

// -- Reviewer Dashboard --

export async function handleReviewDashboardData(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const data = await getReviewerDashboardData(auth.orgId, auth.email);
  return json(data);
}

export async function handleReviewMe(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role });
}
