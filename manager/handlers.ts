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
import { getGameState, getEarnedBadges, emitEvent, queryAuditDoneIndex, getFinding, getManagerScope } from "../lib/kv.ts";
import { getReviewedFindingIds } from "../review/kv.ts";
import { getManagerPage } from "./page.ts";
import { getManagerAuditsPage } from "./audits-page.ts";

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

export async function handleManagerPage(req: Request): Promise<Response> {
  const qs = new URL(req.url).search;
  return new Response(null, { status: 302, headers: { Location: "/manager/audits" + qs } });
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

// -- Audit History --

export async function handleManagerAuditsPage(_req: Request): Promise<Response> {
  return html(getManagerAuditsPage());
}

export async function handleManagerAuditsData(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "manager" && auth.role !== "admin") return json({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const owner = url.searchParams.get("owner") || "";
  const shift = url.searchParams.get("shift") || "";
  const department = url.searchParams.get("department") || "";
  const reviewed = url.searchParams.get("reviewed") || "";
  const scoreMin = parseInt(url.searchParams.get("scoreMin") || "0", 10);
  const scoreMax = parseInt(url.searchParams.get("scoreMax") || "100", 10);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "50", 10)));
  const sinceParam = url.searchParams.get("since");
  const untilParam = url.searchParams.get("until");
  const since = sinceParam ? parseInt(sinceParam, 10) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const until = untilParam ? parseInt(untilParam, 10) : Date.now();

  const orgId = auth.orgId;
  type AuditRow = {
    findingId: string; ts: number; score: number; recordId?: string;
    isPackage?: boolean; voName?: string; owner?: string; department?: string;
    shift?: string; startedAt?: number; durationMs?: number; reason?: string;
    reviewed?: boolean;
  };
  const indexEntries = await queryAuditDoneIndex(orgId, since, until);
  const windowEntries: AuditRow[] = indexEntries
    .map((e) => ({
      findingId: e.findingId,
      ts: e.completedAt,
      score: e.score,
      recordId: e.recordId,
      isPackage: e.isPackage,
      voName: e.voName,
      owner: e.owner,
      department: e.department,
      shift: e.shift,
      startedAt: e.startedAt,
      durationMs: e.durationMs,
      reason: e.reason,
    }))
    .sort((a, b) => b.ts - a.ts);

  async function hydrateMissing(rows: AuditRow[]): Promise<AuditRow[]> {
    const needsHydration = rows.filter((r) => r.voName === undefined && r.owner === undefined);
    if (needsHydration.length === 0) return rows;
    const findings = await Promise.all(needsHydration.map((r) => getFinding(orgId, r.findingId)));
    const findingMap = new Map<string, Record<string, unknown>>();
    findings.forEach((f, i) => { if (f) findingMap.set(needsHydration[i].findingId, f as Record<string, unknown>); });
    return rows.map((r) => {
      if (r.voName !== undefined || r.owner !== undefined) return r;
      const f = findingMap.get(r.findingId);
      if (!f) return r;
      const rec = f.record as Record<string, unknown> | undefined;
      const isPkg = f.recordingIdField === "GenieNumber";
      const rawVo = String(rec?.VoName ?? "");
      const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
      return {
        ...r,
        isPackage: isPkg,
        voName: vo || undefined,
        owner: f.owner as string | undefined,
        department: String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? "")) || undefined,
        shift: isPkg ? undefined : String(rec?.Shift ?? "") || undefined,
        startedAt: f.startedAt as number | undefined,
      };
    });
  }

  // Hydrate entries with missing department/shift BEFORE scope filtering
  // (old index entries don't have these fields, causing them to be excluded from scoped views)
  const needsHydrationForScope = windowEntries.filter((r) => r.department === undefined);
  if (needsHydrationForScope.length > 0) {
    const hydrated = await hydrateMissing(needsHydrationForScope);
    const hydratedMap = new Map(hydrated.map((r) => [r.findingId, r]));
    for (let i = 0; i < windowEntries.length; i++) {
      const h = hydratedMap.get(windowEntries[i].findingId);
      if (h) windowEntries[i] = h;
    }
  }

  // Scope by manager's department+shift configuration; admin sees everything
  let scopedEntries = windowEntries;
  if (auth.role === "manager") {
    const scope = await getManagerScope(auth.orgId, auth.email);
    scopedEntries = windowEntries.filter((c) => {
      if (scope.departments.length > 0 && !scope.departments.includes(c.department ?? "")) return false;
      if (scope.shifts.length > 0 && !scope.shifts.includes(c.shift ?? "")) return false;
      return true;
    });
  }

  const reviewedIds = await getReviewedFindingIds(auth.orgId);

  // Managers only see reviewed audits (manually reviewed, auto-pass, or invalid genie)
  const isReviewed = (c: typeof scopedEntries[0]) =>
    reviewedIds.has(c.findingId) || c.reason === "perfect_score" || c.reason === "invalid_genie";

  const inWindow = scopedEntries.filter((c) => (!until || c.ts <= until) && (auth.role !== "manager" || isReviewed(c)));

  const filtered = inWindow.filter((c) => {
    if (owner && (c.voName || c.owner) !== owner) return false;
    if (shift && c.shift !== shift) return false;
    if (department && c.department !== department) return false;
    if (reviewed === "yes" && !reviewedIds.has(c.findingId)) return false;
    if (reviewed === "no" && (reviewedIds.has(c.findingId) || c.reason === "perfect_score" || c.reason === "invalid_genie")) return false;
    if (reviewed === "auto" && c.reason !== "perfect_score" && c.reason !== "invalid_genie") return false;
    if (reviewed === "invalid_genie" && c.reason !== "invalid_genie") return false;
    if (c.score != null && (c.score < scoreMin || c.score > scoreMax)) return false;
    return true;
  });

  const owners = [...new Set(inWindow.map((c) => c.voName || c.owner).filter(Boolean))].sort() as string[];
  const shifts = [...new Set(inWindow.map((c) => c.shift).filter(Boolean))].sort() as string[];
  const departments = [...new Set(inWindow.map((c) => c.department).filter(Boolean))].sort() as string[];
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const pageSlice = filtered.slice((page - 1) * limit, page * limit);
  const hydratedPage = await hydrateMissing(pageSlice);
  const items = hydratedPage.map((c) => ({ ...c, reviewed: reviewedIds.has(c.findingId) }));

  console.log(`[MANAGER-AUDITS] 🔍 ${auth.email}: ${total}/${inWindow.length} scoped audits in window, page=${page}/${pages}`);
  return json({ items, total, pages, page, owners, shifts, departments });
}
