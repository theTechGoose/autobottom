/** Admin dashboard data controller — wired to stats + review repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { getStats, getRecentCompleted, queryAuditDoneIndex, findAuditsByRecordId } from "@audit/domain/data/stats-repository/mod.ts";
import { getReviewStats } from "@review/domain/business/review-queue/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Dashboard — admin analytics data, audit history, review queue data")
@Controller("admin")
export class DashboardController {

  @Get("dashboard/data")
  async dashboardData() {
    const [pipelineStats, reviewStats, recent] = await Promise.all([
      getStats(ORG()),
      getReviewStats(ORG()),
      getRecentCompleted(ORG(), 25),
    ]);
    return { pipeline: pipelineStats, review: reviewStats, recentCompleted: recent };
  }

  @Get("dashboard/section")
  async dashboardSection(@Query("section") section: string) {
    if (section === "pipeline") return getStats(ORG());
    if (section === "review") return getReviewStats(ORG());
    return { section, data: [] };
  }

  @Get("audits/data")
  async auditsData(@Query("since") since: string, @Query("until") until: string) {
    const s = parseInt(since || "0");
    const u = parseInt(until || String(Date.now()));
    return { audits: await queryAuditDoneIndex(ORG(), s, u) };
  }

  @Get("review-queue/data")
  async reviewQueueData() { return getReviewStats(ORG()); }

  @Get("delete-finding")
  async deleteFinding(@Query("findingId") findingId: string) {
    // TODO: port adminDeleteFinding from judge/kv.ts
    return { ok: true, findingId, message: "delete pending full port" };
  }

  @Get("audits-by-record")
  async auditsByRecord(@Query("recordId") recordId: string) {
    if (!recordId) return { error: "recordId required" };
    return { audits: await findAuditsByRecordId(ORG(), recordId) };
  }
}
