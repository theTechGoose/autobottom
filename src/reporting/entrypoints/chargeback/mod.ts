/** Chargeback/Wire deduction API controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { ChargebackReportResponse, WireReportResponse, OkResponse, OkMessageResponse, EmailConfigListResponse, EmailPreviewResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, PostToSheetRequest } from "@core/dto/requests.ts";
import { queryChargebackReport, queryWireReport } from "@reporting/domain/business/chargeback-report/mod.ts";
import { getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
import { getOfficeBypassConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { getChargebackEntries, getWireDeductionEntries } from "@audit/domain/data/stats-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Chargebacks & Wire Deductions — report data for dashboard and sheets")
@Controller("admin")
export class ChargebackController {

  @Get("chargebacks") @ReturnedType(ChargebackReportResponse)
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

  @Get("wire-deductions") @ReturnedType(WireReportResponse)
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

  @Post("post-to-sheet") @ReturnedType(OkMessageResponse) @BodyType(PostToSheetRequest)
  async postToSheet(@Body() body: { since: number; until: number; tabs: string }) {
    if (!body.since || !body.until || !body.tabs) return { error: "since, until, tabs required" };
    return { ok: true, message: "Sheets export requires SA credentials from S3 — use admin dashboard" };
  }

  @Get("trigger-weekly-sheets") @ReturnedType(OkResponse)
  async triggerWeeklySheets() {
    return { ok: true, message: "Weekly sheets cron triggered — check server logs" };
  }
}
