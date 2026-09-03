/** Manager API controller — wired to real manager repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { ManagerQueueResponse, ManagerStatsResponse, OkResponse, OkMessageResponse, AgentListResponse, MessageResponse, FindingResponse, ManagerAuditHistoryResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, RemediateRequest, CreateAgentRequest, DeleteEmailRequest, PrefabSubscriptionsRequest } from "@core/dto/requests.ts";
import { getManagerQueue, submitRemediation, skipRemediation, enrichManagerQueueBatch } from "@manager/domain/data/manager-repository/mod.ts";
import { getFinding, getTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { createUser, deleteUser, listUsers } from "@core/business/auth/mod.ts";
import { getPrefabSubscriptions, savePrefabSubscriptions } from "@events/domain/data/events-repository/mod.ts";
import { getAuditHistory } from "@manager/domain/business/audit-history/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

/** Soft-fallback helper for FS aborts on user-facing GETs. Mirrors the
 *  pattern used by ReviewController.softFail — keeps the manager dashboard
 *  rendering with empty/zeroed shapes instead of surfacing a raw 500. */
function softFail<T>(ctx: string, err: unknown, fallback: T): T {
  console.warn(`⚠️ [MANAGER] ${ctx} failed — soft fallback:`, err);
  return fallback;
}

@SwaggerDescription("Manager — failure remediation and team management")
@Controller("manager/api")
export class ManagerController {

  /** NOTE: the live route is dispatched from main.ts (AUTH_CONTEXT_HANDLERS →
   *  handleManagerQueue) — it authenticates the session cookie and scopes the
   *  queue to the manager's department/shift config. This method is kept for
   *  swagger discoverability and internal tooling only. */
  @Get("queue") @ReturnedType(ManagerQueueResponse) @Description("List manager queue items")
  async queueList() {
    try {
      const items = await getManagerQueue(ORG());
      // Lazy display backfill: pre-enrichment items lack voName/failedQuestions.
      // Bounded to 10 findings per poll (auto-refresh drives convergence) —
      // NEVER unbounded hydration on an auto-loading endpoint.
      try { await enrichManagerQueueBatch(ORG(), items, 10); }
      catch (err) { console.warn("⚠️ [MANAGER] queue enrichment skipped:", err); }
      return { items };
    }
    catch (err) { return softFail("queueList", err, { items: [], retry: true }); }
  }

  @Get("finding") @ReturnedType(FindingResponse) @Description("Get finding detail")
  async finding(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const f = await getFinding(ORG(), findingId);
    if (!f) return { error: "not found" };
    // Attach the transcript store's raw + diarized + per-line utteranceTimes so
    // the remediation scrub view can seek the audio to a clicked line. raw and
    // utteranceTimes are a matched pair (the times are indexed to the raw
    // transcript's lines), so always take BOTH from the store — never mix the
    // finding doc's raw with the store's times. diarize-async no longer mirrors
    // the diarized transcript onto the finding doc (that full-doc write raced
    // finalize), so backfill that too when it's missing.
    try {
      const t = await getTranscript(ORG(), findingId);
      if (t) {
        const rec = f as Record<string, unknown>;
        if (!rec.diarizedTranscript && t.diarized) rec.diarizedTranscript = t.diarized;
        if (t.raw) rec.rawTranscript = t.raw;
        if (t.utteranceTimes) rec.utteranceTimes = t.utteranceTimes;
      }
    } catch { /* best-effort display backfill */ }
    return f;
  }

  @Post("remediate") @ReturnedType(OkResponse) @Description("Submit failure remediation") @BodyType(RemediateRequest)
  async remediate(@Body() body: { findingId: string; notes: string; username: string }) {
    if (!body.findingId || !body.notes || !body.username) return { error: "findingId, notes, username required" };
    return submitRemediation(ORG(), body.findingId, body.notes, body.username);
  }

  /** Close a row out with no write-up. No notes, by design — see
   *  skipRemediation for why this awards no XP and fires no webhook. */
  @Post("skip") @ReturnedType(OkResponse) @Description("Skip a failure without recording remediation") @BodyType(GenericBodyRequest)
  async skip(@Body() body: { findingId?: string; username?: string }) {
    if (!body?.findingId || !body?.username) return { error: "findingId, username required" };
    return skipRemediation(ORG(), body.findingId, body.username);
  }

  /** NOTE: the live route is dispatched from main.ts (AUTH_CONTEXT_HANDLERS →
   *  handleManagerStats) — managers get counts over their scoped queue,
   *  admin/super-manager get org-wide numbers. Kept for swagger/tooling. */
  @Get("stats") @ReturnedType(ManagerStatsResponse) @Description("Manager queue statistics")
  async stats() {
    try {
      const items = await getManagerQueue(ORG());
      // Piggyback the lazy queue enrichment on the stats poller (every 10s
      // while a manager dashboard is open) so pre-enrichment items converge
      // even though the queue table itself only loads once per page view.
      // Bounded batch — never unbounded hydration on an auto-loading path.
      try { await enrichManagerQueueBatch(ORG(), items, 10); }
      catch (err) { console.warn("⚠️ [MANAGER] stats enrichment skipped:", err); }
      return {
        total: items.length,
        pending: items.filter((i) => i.status === "pending").length,
        remediated: items.filter((i) => i.status === "remediated").length,
      };
    }
    catch (err) { return softFail("stats", err, { pending: 0, decided: 0, total: 0, retry: true }); }
  }

  // /manager/api/me and /manager/api/game-state are dispatched directly from
  // main.ts (AUTH_CONTEXT_HANDLERS) — they need the session cookie and danet's
  // @Req doesn't work via router.fetch. Same pattern as /admin/api/me.

  @Get("agents") @ReturnedType(AgentListResponse) @Description("List team agents")
  async listAgents() {
    try { return { agents: await listUsers(ORG(), "user") }; }
    catch (err) { return softFail("listAgents", err, { agents: [], retry: true }); }
  }

  @Post("agents") @ReturnedType(OkResponse) @BodyType(CreateAgentRequest)
  async createAgent(@Body() body: { email: string; password: string; supervisor?: string }) {
    if (!body.email || !body.password) return { error: "email, password required" };
    await createUser(ORG(), body.email, body.password, "user", body.supervisor);
    return { ok: true };
  }

  @Post("agents/delete") @ReturnedType(OkResponse) @Description("Delete agent account") @BodyType(DeleteEmailRequest)
  async deleteAgent(@Body() body: { email: string }) {
    if (!body.email) return { error: "email required" };
    await deleteUser(ORG(), body.email);
    return { ok: true };
  }

  @Post("backfill") @ReturnedType(OkMessageResponse) @Description("Backfill manager queue")
  async backfill() { const { backfillManagerQueueLegacy } = await import("@manager/domain/data/manager-repository/mod.ts"); await backfillManagerQueueLegacy(ORG()); return { ok: true }; }

  @Get("prefab-subscriptions") @ReturnedType(OkResponse) @Description("Get prefab subscriptions")
  async getPrefabs() { return getPrefabSubscriptions(ORG()); }

  @Post("prefab-subscriptions") @ReturnedType(OkResponse) @Description("Save prefab subscriptions") @BodyType(PrefabSubscriptionsRequest)
  async savePrefabs(@Body() body: Record<string, boolean>) {
    await savePrefabSubscriptions(ORG(), body);
    return { ok: true };
  }

  /** Audit history (scoped to manager's team or unrestricted for admin).
   *  See `src/manager/domain/business/audit-history/mod.ts` for the filter
   *  + scope + paginate flow. The actual auth-aware path is dispatched from
   *  `main.ts` (AUTH_CONTEXT_HANDLERS) — that handler resolves the session
   *  cookie via `authenticate(req)` and calls `getAuditHistory(...)` directly,
   *  passing email + role. This controller method is kept so the route is
   *  discoverable via swagger/spec and so a fall-through admin-mode call
   *  (no manager scoping) still works for tooling. */
  @Get("audit-history") @ReturnedType(ManagerAuditHistoryResponse) @Description("Manager audit history")
  async auditHistory(
    @Query("owner") owner: string,
    @Query("employeeId") employeeId: string,
    @Query("shift") shift: string,
    @Query("department") department: string,
    @Query("reviewed") reviewed: string,
    @Query("sale") sale: string,
    @Query("sort") sort: string,
    @Query("scoreMin") scoreMin: string,
    @Query("scoreMax") scoreMax: string,
    @Query("page") page: string,
    @Query("limit") limit: string,
    @Query("since") since: string,
    @Query("until") until: string,
    @Query("email") email: string,
    @Query("role") role: string,
  ) {
    const orgId = ORG();
    const effectiveRole = (
      role === "manager" ? "manager" : role === "super-manager" ? "super-manager" : "admin"
    ) as "manager" | "admin" | "super-manager";
    return getAuditHistory(orgId, email ?? "", effectiveRole, {
      owner: owner || undefined,
      employeeId: employeeId || undefined,
      shift: shift || undefined,
      department: department || undefined,
      reviewed: reviewed || undefined,
      sale: sale || undefined,
      sort: sort || undefined,
      scoreMin: scoreMin ? parseInt(scoreMin, 10) : undefined,
      scoreMax: scoreMax ? parseInt(scoreMax, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      since: since ? parseInt(since, 10) : undefined,
      until: until ? parseInt(until, 10) : undefined,
    });
  }
}
