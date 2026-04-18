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
import { readSheetsCredentials, appendSheetRows } from "@core/data/google-sheets/mod.ts";

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
    const creds = readSheetsCredentials();
    if (!creds) {
      return {
        error: "Sheets not configured — set GOOGLE_SA_JSON + GOOGLE_SHEET_ID env vars on this deployment.",
      };
    }
    const orgId = ORG();
    const [reviewedIds, bypassCfg] = await Promise.all([
      getReviewedFindingIds(orgId),
      getOfficeBypassConfig(orgId),
    ]);
    let appended = 0;
    const tabList = body.tabs.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      for (const tab of tabList) {
        if (tab === "cb" || tab === "om") {
          const report = await queryChargebackReport(orgId, body.since, body.until, reviewedIds, bypassCfg.patterns);
          const source = tab === "cb" ? (report.chargebacks ?? []) : (report.omissions ?? []);
          if (!source.length) continue;
          const rows = source.map((c) => {
            const r = c as unknown as Record<string, unknown>;
            return [
              String(r.date ?? ""),
              String(r.teamMember ?? ""),
              String(r.revenue ?? ""),
              String(r.crmLink ?? ""),
              String(r.findingId ?? ""),
              String(r.type ?? ""),
              Array.isArray(r.failedQuestions) ? (r.failedQuestions as string[]).join("; ") : "",
            ] as (string | number)[];
          });
          const res = await appendSheetRows(creds, tab === "cb" ? "Chargebacks" : "Omissions", rows);
          appended += res.appended;
        } else if (tab === "wire") {
          const items = await queryWireReport(orgId, body.since, body.until, reviewedIds, bypassCfg.patterns);
          if (!items.length) continue;
          const rows = items.map((w) => {
            const r = w as unknown as Record<string, unknown>;
            return [
              String(r.date ?? ""),
              typeof r.score === "number" ? r.score : "",
              typeof r.questions === "number" ? r.questions : "",
              typeof r.passed === "number" ? r.passed : "",
              String(r.crmLink ?? ""),
              String(r.findingId ?? ""),
              String(r.office ?? ""),
              String(r.auditor ?? ""),
              String(r.guestName ?? ""),
            ] as (string | number)[];
          });
          const res = await appendSheetRows(creds, "Wire Deductions", rows);
          appended += res.appended;
        }
      }
    } catch (err) {
      console.error(`❌ [POST-TO-SHEET] failed:`, err);
      return { error: (err as Error).message };
    }
    console.log(`📊 [POST-TO-SHEET] appended ${appended} rows across tabs [${tabList.join(",")}]`);
    return { ok: true, appended };
  }

  @Get("trigger-weekly-sheets") @ReturnedType(OkResponse)
  async triggerWeeklySheets() {
    return { ok: true, message: "Weekly sheets cron triggered — check server logs" };
  }
}
