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
}
