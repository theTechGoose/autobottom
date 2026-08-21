/** Failed Audits API controller — failures-only analytics for the dashboard.
 *  Admin only (served under /admin/* like every other report). */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import {
  FailedFindingsResponse, FailureByQuestionResponse, FailureMatrixResponse, TopFailResponse,
  OkResponse, MessageResponse, WeeklyFailsResponse,
} from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import {
  getFailedFindings, getAppealedStillFailed, getFailureByQuestion, getFailureMatrix, getTopFailRanked,
} from "@reporting/domain/business/failed-audits-report/mod.ts";
import type { FailedFilters } from "@reporting/domain/business/failed-audits-report/mod.ts";
import {
  setQuestionFailureSource, writeFailedFindingRows, resetFailedFindingIndex,
} from "@audit/domain/data/failed-finding-repository/mod.ts";
import { normalizeQuestionKey } from "@audit/domain/data/question-stats-repository/mod.ts";
import { queryWeeklyFails, DEFAULT_LOOKBACK_DAYS } from "@reporting/domain/business/weekly-fails/mod.ts";
import { prevWeekWindow } from "@cron/domain/business/weekly-sheets/mod.ts";
import { getSelfUrl } from "@core/data/qstash/mod.ts";
import type { FailureSource } from "@core/dto/types.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

const VALID_SOURCES: FailureSource[] = ["autobot", "vo_app", "team_member", "unknown"];

function ms(v: string, fallback: number): number {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function filtersFrom(
  voName: string, department: string, shift: string, header: string, source: string,
): FailedFilters {
  const src = VALID_SOURCES.includes(source as FailureSource) ? (source as FailureSource) : undefined;
  return {
    voName: voName?.trim() || undefined,
    department: department?.trim() || undefined,
    shift: shift?.trim() || undefined,
    header: header?.trim() || undefined,
    failureSource: src,
  };
}

@SwaggerDescription("Failed Audits — failures-only analytics (line items, by-question, matrix, top-fail)")
@Controller("admin")
export class FailedAuditsController {

  /** View 1 — exact failed findings (line items), paginated. */
  @Get("failed-audits/findings") @ReturnedType(FailedFindingsResponse)
  async findings(
    @Query("since") since: string, @Query("until") until: string,
    @Query("voName") voName: string, @Query("department") department: string,
    @Query("shift") shift: string, @Query("header") header: string,
    @Query("source") source: string, @Query("page") page: string,
  ) {
    const from = ms(since, 0);
    const to = ms(until, Date.now());
    const pg = Math.max(1, parseInt(page || "1", 10) || 1);
    return getFailedFindings(ORG(), from, to, filtersFrom(voName, department, shift, header, source), pg, 100);
  }

  /** View 2 — appealed and still failed (appeal denied). */
  @Get("failed-audits/appealed") @ReturnedType(FailedFindingsResponse)
  async appealed(
    @Query("since") since: string, @Query("until") until: string,
    @Query("voName") voName: string, @Query("department") department: string,
    @Query("shift") shift: string, @Query("header") header: string,
    @Query("source") source: string, @Query("page") page: string,
  ) {
    const from = ms(since, 0);
    const to = ms(until, Date.now());
    const pg = Math.max(1, parseInt(page || "1", 10) || 1);
    return getAppealedStillFailed(ORG(), from, to, filtersFrom(voName, department, shift, header, source), pg, 100);
  }

  /** View 3 — failure by question (ranked). */
  @Get("failed-audits/by-question") @ReturnedType(FailureByQuestionResponse)
  async byQuestion(
    @Query("since") since: string, @Query("until") until: string,
    @Query("voName") voName: string, @Query("department") department: string,
    @Query("shift") shift: string, @Query("source") source: string,
  ) {
    const from = ms(since, 0);
    const to = ms(until, Date.now());
    return getFailureByQuestion(ORG(), from, to, filtersFrom(voName, department, shift, "", source));
  }

  /** View 4 — department x question matrix. */
  @Get("failed-audits/matrix") @ReturnedType(FailureMatrixResponse)
  async matrix(
    @Query("since") since: string, @Query("until") until: string,
    @Query("voName") voName: string, @Query("shift") shift: string,
    @Query("source") source: string,
  ) {
    const from = ms(since, 0);
    const to = ms(until, Date.now());
    return getFailureMatrix(ORG(), from, to, filtersFrom(voName, "", shift, "", source));
  }

  /** #1 fail drill-down (ranked with graceful filter degradation). */
  @Get("failed-audits/top-fail") @ReturnedType(TopFailResponse)
  async topFail(
    @Query("since") since: string, @Query("until") until: string,
    @Query("voName") voName: string, @Query("department") department: string,
    @Query("shift") shift: string, @Query("source") source: string,
  ) {
    const from = ms(since, 0);
    const to = ms(until, Date.now());
    return getTopFailRanked(ORG(), from, to, filtersFrom(voName, department, shift, "", source));
  }

  /** Prior-week fails: invalid genies + audits still failing after review.
   *
   *  Defaults to the last COMPLETE Mon 00:00 → Sun 23:59:59.999 in Eastern
   *  (same window the weekly sheet export uses), filtered on `doneAt` — when
   *  the audit settled, not when the bot finished. Override the window with
   *  ?since=&until= (epoch ms) for a one-off range.
   *
   *  ?lookbackDays= widens how far back the completedAt scan reaches to catch
   *  audits reviewed long after they were graded. */
  @Get("weekly-fails") @ReturnedType(WeeklyFailsResponse)
  async weeklyFails(
    @Query("since") since: string, @Query("until") until: string,
    @Query("lookbackDays") lookbackDays: string,
    @Query("questions") questions: string,
  ) {
    const week = prevWeekWindow(new Date());
    const from = ms(since, week.since);
    const to = ms(until, week.until);
    if (to < from) return { error: "until must not be before since" };
    return queryWeeklyFails(ORG(), from, to, {
      lookbackDays: ms(lookbackDays, DEFAULT_LOOKBACK_DAYS),
      includeQuestions: !/^(0|false|no)$/i.test((questions ?? "").trim()),
      selfUrl: getSelfUrl(),
    });
  }

  /** Manual admin override of a failed question's source. */
  @Post("failed-audits/source") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async setSource(@Body() body: GenericBodyRequest) {
    const b = body as { findingId?: string; questionKey?: string; header?: string; source?: string; by?: string };
    const source = b.source as FailureSource;
    const questionKey = b.questionKey || (b.header ? normalizeQuestionKey(String(b.header)) : "");
    if (!b.findingId || !questionKey || !VALID_SOURCES.includes(source)) {
      return { ok: false, error: "findingId, questionKey (or header), and a valid source required" };
    }
    return setQuestionFailureSource(ORG(), b.findingId, questionKey, source, b.by || "admin");
  }

  /** Backfill the failed-finding index from audit-done-idx over a date range.
   *  Idempotent (writeFailedFindingRows rebuilds per finding). */
  @Post("failed-audits/backfill") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async backfill(@Body() body: GenericBodyRequest) {
    const t0 = Date.now();
    const b = body as { sinceMs?: number; untilMs?: number };
    const from = Number(b.sinceMs ?? 0);
    const to = Number(b.untilMs ?? Date.now());
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return { ok: false, error: "sinceMs and untilMs (ms epoch) required, to > from" };
    }
    const orgId = ORG();
    const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
    const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
    const { getAppeal } = await import("@judge/domain/data/judge-repository/mod.ts");
    const { normalizeQuestionKey } = await import("@audit/domain/data/question-stats-repository/mod.ts");

    const entries = await listStoredByCompletedAt<{ findingId?: string; completedAt?: number }>(
      "audit-done-idx", orgId, from, to, { limit: 500_000 },
    );
    console.log(`[FAILED-BACKFILL] entries=${entries.length} range=[${new Date(from).toISOString()}, ${new Date(to).toISOString()}]`);

    let processed = 0, rowsWritten = 0, errors = 0;
    const CONCURRENCY = 20;
    const processOne = async (e: { findingId?: string; completedAt?: number }) => {
      if (!e.findingId) return;
      try {
        const finding = await getFinding(orgId, e.findingId);
        if (!finding) return;
        const answered = (finding as Record<string, any>).answeredQuestions as Array<Record<string, unknown>> | undefined;
        const appeal = await getAppeal(orgId, e.findingId).catch(() => null);
        // appealedQuestions are indices into answeredQuestions, not headers.
        const appealedKeys = new Set<string>();
        for (const idx of appeal?.appealedQuestions ?? []) {
          const h = answered?.[Number(idx)]?.header;
          if (h) appealedKeys.add(normalizeQuestionKey(String(h)));
        }
        // A denied appeal = a question that was appealed and whose fail was
        // upheld (judgeAction "uphold") and still answers "No".
        const deniedKeys = new Set<string>();
        for (const q of answered ?? []) {
          const key = normalizeQuestionKey(String(q.header ?? ""));
          if (appealedKeys.has(key) && q.judgeAction === "uphold") deniedKeys.add(key);
        }
        rowsWritten += await writeFailedFindingRows(orgId, finding as Record<string, any>, {
          appealedQuestionKeys: appealedKeys, deniedQuestionKeys: deniedKeys,
        });
        processed++;
      } catch (err) {
        errors++;
        console.warn(`[FAILED-BACKFILL] ${e.findingId} failed:`, err);
      }
    };
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      await Promise.all(entries.slice(i, i + CONCURRENCY).map(processOne));
    }
    const msg = `Backfilled ${rowsWritten} failure rows from ${processed} findings (${errors} errors) in ${Date.now() - t0}ms`;
    console.log(`✅ [FAILED-BACKFILL] ${msg}`);
    return { ok: true, message: msg };
  }

  /** Wipe the failed-finding index for the org (for a clean re-backfill). */
  @Post("failed-audits/reset") @ReturnedType(MessageResponse)
  async reset() {
    const removed = await resetFailedFindingIndex(ORG());
    return { ok: true, message: `Removed ${removed} failure rows` };
  }
}
