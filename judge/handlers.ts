/** HTTP handlers for judge API routes. Uses unified auth. */

import {
  claimNextItem,
  recordDecision,
  undoDecision,
  getJudgeStats,
  getJudgeDashboardData,
  dismissFindingFromJudgeQueue,
} from "./kv.ts";
import { resolveEffectiveAuth, listUsers, createUser, deleteUser } from "../auth/kv.ts";
import type { AuthContext } from "../auth/kv.ts";
import { resolveGamificationSettings, listSoundPacks, emitEvent, getReviewerConfig, saveReviewerConfig } from "../lib/kv.ts";
import type { SoundSlot } from "../lib/kv.ts";
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

async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveEffectiveAuth(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  return auth;
}

// -- Page --

export async function handleJudgePage(req: Request): Promise<Response> {
  const auth = await resolveEffectiveAuth(req);
  if (auth) {
    const gamification = await resolveGamificationSettings(auth.orgId, auth.email, auth.role);
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
    return html(getJudgePage(JSON.stringify(config)));
  }
  return html(getJudgePage());
}

// -- Judge Actions --

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
  const { findingId, questionIndex, decision, reason, combo, level } = body;

  if (!findingId || questionIndex === undefined || !decision) {
    return json({ error: "findingId, questionIndex, and decision required" }, 400);
  }
  if (decision !== "uphold" && decision !== "overturn") {
    return json({ error: "decision must be 'uphold' or 'overturn'" }, 400);
  }
  const validReasons = ["error", "logic", "fragment", "transcript"];
  if (decision === "overturn" && reason && !validReasons.includes(reason)) {
    return json({ error: "reason must be one of: error, logic, fragment, transcript" }, 400);
  }

  const t0 = Date.now();
  const result = await recordDecision(
    auth.orgId, findingId, questionIndex, decision, auth.email,
    reason || undefined, combo ?? undefined, level ?? undefined,
  );
  const next = await claimNextItem(auth.orgId, auth.email);
  console.log(`[JUDGE] ⚡ decide: ${Date.now() - t0}ms findingId=${findingId} decision=${decision}`);

  if (!result.success) {
    return json({ error: "failed to record decision (lock expired or not owned)" }, 409);
  }

  // Emit appeal-decided event when an appeal is fully judged
  if (result.auditComplete) {
    emitEvent(auth.orgId, auth.email, "appeal-decided", {
      findingId,
      judge: auth.email,
      decision,
    }).catch(() => {});
  }

  const newBadges = result.newBadges.map(({ check: _, ...rest }) => rest);
  return json({ decided: { findingId, questionIndex, decision, reason: reason || null }, auditComplete: result.auditComplete, buffer: next.buffer, newBadges });
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

// -- Stats --

export async function handleStats(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const stats = await getJudgeStats(auth.orgId);
  return json(stats);
}

// -- Dashboard --

export async function handleDashboardPage(_req: Request): Promise<Response> {
  return html(getJudgeDashboardPage());
}

export async function handleDashboardData(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const data = await getJudgeDashboardData(auth.orgId);
  return json(data);
}

// -- Me --

export async function handleJudgeMe(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role });
}

// -- Reviewer Management (judges manage their own reviewers) --

export async function handleJudgeListReviewers(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const reviewers = await listUsers(auth.orgId, "reviewer");
  // Filter to only reviewers supervised by this judge (or all for admin)
  const filtered = auth.role === "admin"
    ? reviewers
    : reviewers.filter((r) => r.supervisor === auth.email);
  return json(filtered);
}

export async function handleJudgeCreateReviewer(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) return json({ error: "email and password required" }, 400);

  await createUser(auth.orgId, email, password, "reviewer", auth.email);
  return json({ ok: true, email, role: "reviewer", supervisor: auth.email });
}

export async function handleJudgeDeleteReviewer(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { email } = body;
  if (!email) return json({ error: "email required" }, 400);

  await deleteUser(auth.orgId, email);
  return json({ ok: true, email });
}

export async function handleJudgeGetReviewerConfig(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const email = new URL(req.url).searchParams.get("email");
  if (!email) return json({ error: "email required" }, 400);
  const config = await getReviewerConfig(auth.orgId, email);
  return json(config ?? { allowedTypes: ["date-leg", "package"] });
}

export async function handleJudgeSaveReviewerConfig(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { email, allowedTypes } = body;
  if (!email || !Array.isArray(allowedTypes)) return json({ error: "email and allowedTypes required" }, 400);
  const valid = allowedTypes.filter((t: string) => t === "date-leg" || t === "package");
  if (valid.length === 0) return json({ error: "allowedTypes must include at least one valid type" }, 400);
  await saveReviewerConfig(auth.orgId, email, { allowedTypes: valid });
  return json({ ok: true });
}


export async function handleJudgeDismissFinding(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json();
  const { findingId } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);

  const result = await dismissFindingFromJudgeQueue(auth.orgId, findingId);
  return json({ ok: true, ...result });
}
