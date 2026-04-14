/** Chargeback/Wire deduction API controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { queryChargebackReport, queryWireReport } from "@reporting/domain/business/chargeback-report/mod.ts";
import { getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
import { getOfficeBypassConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { getChargebackEntries, getWireDeductionEntries } from "@audit/domain/data/stats-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Chargebacks & Wire Deductions — report data for dashboard and sheets")
@Controller("admin")
export class ChargebackController {

  @Get("chargebacks")
  async getChargebacks(@Query("since") since: string, @Query("until") until: string) {
    if (!since) return { error: "since required" };
    const s = parseInt(since);
    const u = parseInt(until || String(Date.now()));
    const [reviewedIds, bypassCfg] = await Promise.all([
      getReviewedFindingIds(ORG()),
      getOfficeBypassConfig(ORG()),
    ]);
    return queryChargebackReport(ORG(), s, u, reviewedIds, bypassCfg.patterns);
  }

  @Get("wire-deductions")
  async getWireDeductions(@Query("since") since: string, @Query("until") until: string) {
    if (!since) return { error: "since required" };
    const s = parseInt(since);
    const u = parseInt(until || String(Date.now()));
    const [reviewedIds, bypassCfg] = await Promise.all([
      getReviewedFindingIds(ORG()),
      getOfficeBypassConfig(ORG()),
    ]);
    return { items: await queryWireReport(ORG(), s, u, reviewedIds, bypassCfg.patterns) };
  }

  @Post("post-to-sheet")
  async postToSheet(@Body() body: { since: number; until: number; tabs: string }) {
    if (!body.since || !body.until || !body.tabs) return { error: "since, until, tabs required" };
    // TODO: wire to Google Sheets export with actual SA credentials from S3
    return { ok: true, posted: [], message: "sheets export pending SA credential wiring" };
  }

  @Get("trigger-weekly-sheets")
  async triggerWeeklySheets() {
    return { ok: true, message: "weekly sheets trigger pending cron wiring" };
  }
}
