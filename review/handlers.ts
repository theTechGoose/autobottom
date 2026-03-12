/** HTTP handlers for review API routes. Uses unified auth. */

import {
  claimNextItem,
  recordDecision,
  undoDecision,
  getReviewStats,
  backfillFromFinished,
  getReviewerDashboardData,
} from "./kv.ts";
import { getWebhookConfig, saveWebhookConfig, resolveGamificationSettings, listSoundPacks, emitEvent } from "../lib/kv.ts";
import type { WebhookConfig, SoundSlot } from "../lib/kv.ts";
import { resolveEffectiveAuth, getUser } from "../auth/kv.ts";
import type { AuthContext } from "../auth/kv.ts";
import { getReviewPage } from "./page.ts";
import { getReviewDashboardPage } from "./dashboard.ts";

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

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

// -- Page --

export async function handleReviewPage(req: Request): Promise<Response> {
  const auth = await resolveEffectiveAuth(req);
  if (auth) {
    const user = await getUser(auth.orgId, auth.email);
    const gamification = await resolveGamificationSettings(auth.orgId, auth.email, auth.role, user?.supervisor);
    const packs = await listSoundPacks(auth.orgId);
    const SLOTS: SoundSlot[] = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];
    const packRegistry: Record<string, Record<string, string>> = {};
    for (const p of packs) {
      const slots: Record<string, string> = {};
      for (const s of SLOTS) {
        if (p.slots[s]) slots[s] = `/sounds/${auth.orgId}/${p.id}/${s}.mp3`;
      }
      packRegistry[p.id] = slots;
    }
    const config = { ...gamification, orgId: auth.orgId, packRegistry };
    return html(getReviewPage(JSON.stringify(config)));
  }
  return html(getReviewPage());
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
    emitEvent(auth.orgId, auth.email, "review-decided", {
      findingId,
      reviewer: auth.email,
      decision,
    }).catch(() => {});
  }

  // Claim next buffer for the reviewer
  const next = await claimNextItem(auth.orgId, auth.email);

  const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
  return json({ decided: { findingId, questionIndex, decision }, auditComplete: result.auditComplete, buffer: next.buffer, newBadges });
}

export async function handleBack(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const result = await undoDecision(auth.orgId, auth.email);
  if (result.buffer.length === 0) {
    return json({ error: "nothing to undo" }, 404);
  }

  return json({ buffer: result.buffer, remaining: result.remaining });
}

// -- Settings --

export async function handleGetSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const settings = await getWebhookConfig(auth.orgId, "terminate");
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

  await saveWebhookConfig(auth.orgId, "terminate", settings);
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

export async function handleReviewDashboardPage(_req: Request): Promise<Response> {
  return html(getReviewDashboardPage());
}

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
