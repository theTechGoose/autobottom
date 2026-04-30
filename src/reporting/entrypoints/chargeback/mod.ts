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
import { loadSheetsCredentials, appendSheetRows } from "@core/data/google-sheets/mod.ts";

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
    const creds = await loadSheetsCredentials();
    if (!creds) {
      return {
        error: "Sheets not configured — set SHEETS_SA_S3_KEY + CHARGEBACKS_SHEET_ID env vars (S3 bucket already wired via S3_BUCKET).",
      };
    }
    const orgId = ORG();
    const [reviewedIds, bypassCfg] = await Promise.all([
      getReviewedFindingIds(orgId),
      getOfficeBypassConfig(orgId),
    ]);
    // Sheet columns must match the existing prod sheet schema:
    //   Chargebacks/Omissions: Date, Team Member, Revenue, CRM Link, Destination, Failed Questions
    //   Wire Deductions:       Date, Score, Questions, Passed, CRM Link, Audit Link, Office, Auditor, Guest Name
    // Source entries use the raw repository shape (ts, voName, destination,
    // recordId, failedQHeaders…) — translate at write-time so we don't write
    // empty cells when the queryChargebackReport returns the canonical shape.
    const QB_DATE_URL = "https://monsterrg.quickbase.com/db/bpb28qsnn?a=dr&rid=";
    const QB_PKG_URL = "https://monsterrg.quickbase.com/db/bttffb64u?a=dr&rid=";
    const fmtDate = (ts: number): string => {
      if (!ts) return "";
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };
    let appended = 0;
    const tabList = body.tabs.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      for (const tab of tabList) {
        if (tab === "cb" || tab === "om") {
          const report = await queryChargebackReport(orgId, body.since, body.until, reviewedIds, bypassCfg.patterns);
          const source = tab === "cb" ? (report.chargebacks ?? []) : (report.omissions ?? []);
          if (!source.length) continue;
          const rows = source.map((e) => [
            fmtDate(e.ts),
            e.voName ?? "",
            e.revenue ?? "",
            e.recordId ? `${QB_DATE_URL}${e.recordId}` : "",
            e.destination ?? "",
            (e.failedQHeaders ?? []).join("; "),
          ] as (string | number)[]);
          const res = await appendSheetRows(creds, tab === "cb" ? "Chargebacks" : "Omissions", rows);
          appended += res.appended;
        } else if (tab === "wire") {
          const items = await queryWireReport(orgId, body.since, body.until, reviewedIds, bypassCfg.patterns);
          if (!items.length) continue;
          const rows = items.map((e) => [
            fmtDate(e.ts),
            typeof e.score === "number" ? e.score : "",
            typeof e.questionsAudited === "number" ? e.questionsAudited : "",
            typeof e.totalSuccess === "number" ? e.totalSuccess : "",
            e.recordId ? `${QB_PKG_URL}${e.recordId}` : "",
            e.findingId ? `/audit/report?id=${e.findingId}` : "",
            e.office ?? "",
            e.excellenceAuditor ?? "",
            e.guestName ?? "",
          ] as (string | number)[]);
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
    const { prevWeekWindow } = await import("@cron/mod-root.ts");
    const { since, until } = prevWeekWindow(new Date());
    // Reuse postToSheet which already validates Sheets creds + appends rows.
    const result = await this.postToSheet({ since, until, tabs: "cb,om,wire" } as any);
    return result;
  }
}
