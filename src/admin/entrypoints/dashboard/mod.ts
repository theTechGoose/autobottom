/** Admin dashboard data controller — wired to stats + review repos.
 *  NOTE on orgId: danet's @Req decorator does NOT work when the controller is
 *  reached via router.fetch() (the pattern used by our unified main.ts entry).
 *  So we resolve orgId via defaultOrgId() which reads env (DEFAULT_ORG_ID /
 *  CHARGEBACKS_ORG_ID). The audit controller uses the same mechanism so both
 *  agree on which org's data to read/write. For true multi-org we'd need to
 *  migrate main.ts to bypass routes that need per-request org context. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, UserListResponse, EmailTemplateListResponse, DashboardDataResponse, AuditsDataResponse, ReviewStatsResponse } from "@core/dto/responses.ts";
import { getStats, getRecentCompleted, queryAuditDoneIndex, findAuditsByRecordId } from "@audit/domain/data/stats-repository/mod.ts";
import { getReviewStats } from "@review/domain/business/review-queue/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Dashboard — admin analytics data, audit history, review queue data")
@Controller("admin")
export class DashboardController {

  @Get("dashboard/data") @ReturnedType(DashboardDataResponse)
  async dashboardData() {
    const [pipelineStats, reviewStats, recent] = await Promise.all([
      getStats(ORG()),
      getReviewStats(ORG()),
      getRecentCompleted(ORG(), 25),
    ]);
    return { pipeline: pipelineStats, review: reviewStats, recentCompleted: recent };
  }

  @Get("dashboard/section") @ReturnedType(OkResponse)
  async dashboardSection(@Query("section") section: string) {
    if (section === "pipeline") return getStats(ORG());
    if (section === "review") return getReviewStats(ORG());
    return { section, data: [] };
  }

  @Get("audits/data") @ReturnedType(AuditsDataResponse)
  async auditsData(@Query("since") since: string, @Query("until") until: string) {
    const s = parseInt(since || "0");
    const u = parseInt(until || String(Date.now()));
    return { audits: await queryAuditDoneIndex(ORG(), s, u) };
  }

  @Get("review-queue/data") @ReturnedType(ReviewStatsResponse)
  async reviewQueueData() { return getReviewStats(ORG()); }

  @Get("delete-finding") @ReturnedType(OkMessageResponse)
  async deleteFinding(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const { adminDeleteFindingLegacy } = await import("@judge/domain/data/judge-repository/mod.ts");
    await adminDeleteFindingLegacy(ORG(), findingId);
    return { ok: true, findingId };
  }

  @Get("audits-by-record") @ReturnedType(AuditsDataResponse)
  async auditsByRecord(@Query("recordId") recordId: string) {
    if (!recordId) return { error: "recordId required" };
    return { audits: await findAuditsByRecordId(ORG(), recordId) };
  }

  /** Debug: confirms the "step dispatch moved to main.ts" fix shipped. If the
   *  deployment serving THIS endpoint also has the main.ts step dispatch, then
   *  /audit/step/* will never reach danet. */
  @Get("debug/step-dispatch") @ReturnedType(OkResponse)
  debugStepDispatch() {
    return { ok: true, stepDispatchMovedToMain: true };
  }

  /** Debug: confirms API_URL is localhost (unified process) instead of an
   *  external deployment hostname. If this ever returns inProcess=false, the
   *  frontend SSR is crossing deployments and the pipeline can't be traced. */
  @Get("debug/api-url") @ReturnedType(OkResponse)
  debugApiUrl() {
    const apiUrl = Deno.env.get("API_URL") ?? null;
    return {
      apiUrl,
      expected: `http://localhost:${Deno.env.get("PORT") ?? 3000}`,
      inProcess: apiUrl?.startsWith("http://localhost") === true,
    };
  }

  /** Debug: the effective SELF_URL for the current request. This is what
   *  QStash callback URLs will use. Must match the CURRENT deployment's origin
   *  (not whatever .env has) for audits to actually run on branch previews. */
  @Get("debug/self-url") @ReturnedType(OkResponse)
  async debugSelfUrl() {
    const { getSelfUrl, getSelfUrlSources } = await import("@core/data/qstash/mod.ts");
    const sources = getSelfUrlSources();
    const effective = getSelfUrl();
    let source: string;
    if (sources.scopedOrigin && !sources.scopedIsLocalhost) source = "async-local-storage";
    else if (sources.knownPublicOrigin) source = "known-public-origin-cache";
    else if (sources.deploymentId) source = "deno-deployment-id";
    else if (sources.envSelfUrl) source = "env";
    else source = "fallback-localhost";
    return {
      selfUrl: effective,
      envSelfUrl: sources.envSelfUrl,
      source,
      sources,
    };
  }

  /** Debug: dump active-tracking + completed-audit-stat KV entries for the current org.
   *  Useful for diagnosing "I started an audit and it disappeared" — shows what's
   *  actually stored vs what the dashboard is rendering. */
  @Get("debug/kv-state") @ReturnedType(OkResponse)
  async debugKvState() {
    const { getKv, orgKey } = await import("@core/data/deno-kv/mod.ts");
    const db = await getKv();
    const orgId = ORG();
    const active: unknown[] = [];
    const completed: unknown[] = [];
    const errors: unknown[] = [];
    for await (const e of db.list({ prefix: orgKey(orgId, "active-tracking") })) {
      active.push({ key: e.key, value: e.value });
    }
    let completedCount = 0;
    for await (const e of db.list({ prefix: orgKey(orgId, "completed-audit-stat") })) {
      completedCount++;
      if (completed.length < 5) completed.push({ key: e.key, value: e.value });
    }
    for await (const e of db.list({ prefix: orgKey(orgId, "error-tracking") })) {
      if (errors.length < 5) errors.push({ key: e.key, value: e.value });
    }
    // audit-finding keys use the chunked-storage meta marker [..., "_n"]; count
    // unique finding IDs by collecting the third key part when we see an _n entry.
    const findingIds = new Set<string>();
    for await (const e of db.list({ prefix: orgKey(orgId, "audit-finding") })) {
      // key shape: [orgId, "audit-finding", findingId, (0|1|..|"_n")]
      const findingId = e.key[2];
      if (typeof findingId === "string") findingIds.add(findingId);
    }
    return {
      orgId,
      active,
      activeCount: active.length,
      completedCount,
      recentCompletedSample: completed,
      errors,
      findingCount: findingIds.size,
      findingSample: Array.from(findingIds).slice(0, 10),
    };
  }
}
