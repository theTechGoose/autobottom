/** Judge API controller — wired to real judge repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { JudgeStatsResponse, ReviewBufferResponse, DecisionResponse, OkResponse, OkMessageResponse, ReviewerListResponse, ReviewerConfigResponse, DismissResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, JudgeDecideRequest, DeleteEmailRequest, ReviewerConfigRequest, FindingIdRequest } from "@core/dto/requests.ts";
import { recordJudgeDecision, getJudgeStats, getAppeal, dismissFindingFromJudgeQueue, clearJudgeQueue, deleteAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { getReviewerLeaderboard } from "@review/domain/business/review-stats/mod.ts";
import { getMyJudgeStats } from "@judge/domain/business/judge-analytics/mod.ts";
import { getReviewerConfig, saveReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

/** Soft-fallback helper — same pattern as the review controller's softFail.
 *  Every FS-touching judge endpoint catches and returns a safe response so
 *  a Firestore abort never propagates as a 5xx. */
function softFail<T>(ctx: string, err: unknown, fallback: T): T {
  console.warn(`⚠️ [JUDGE] ${ctx} failed — soft fallback:`, err);
  return fallback;
}

@SwaggerDescription("Judge — appeal review and reviewer management")
@Controller("judge/api")
export class JudgeController {

  @Get("next") @ReturnedType(ReviewBufferResponse) @Description("Claim next judge items")
  async next(@Query("judge") judge: string) {
    if (!judge) return { error: "judge query param required" };
    try {
      const { claimNextItemLegacy: claimNextItem } = await import("@judge/domain/data/judge-repository/mod.ts");
      return await claimNextItem(ORG(), judge);
    } catch (err) {
      return softFail(`next ${judge}`, err, { buffer: [], remaining: 0, retry: true });
    }
  }

  @Post("decide") @ReturnedType(DecisionResponse) @Description("Uphold or overturn an appealed question") @BodyType(JudgeDecideRequest)
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "uphold" | "overturn"; judge: string; reason?: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.judge) {
      return { error: "findingId, questionIndex, decision, judge required" };
    }
    try {
      const result = await recordJudgeDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.judge, body.reason);
      return { ok: true, ...result };
    } catch (err) {
      return softFail(`decide ${body.findingId}/${body.questionIndex}`, err, {
        ok: false, retry: true, remaining: 0, auditComplete: false,
        error: "Server busy, please retry",
      });
    }
  }

  @Post("back") @ReturnedType(ReviewBufferResponse) @Description("Undo last judge decision") @BodyType(GenericBodyRequest)
  async back(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.judge) return { error: "judge required" };
    try {
      const { undoDecisionLegacy: undoDecision } = await import("@judge/domain/data/judge-repository/mod.ts");
      return await undoDecision(ORG(), b.judge);
    } catch (err) {
      return softFail(`back ${b.judge}`, err, { buffer: [], remaining: 0, retry: true });
    }
  }

  @Get("stats") @ReturnedType(JudgeStatsResponse) @Description("Judge queue statistics")
  async stats() {
    try { return await getJudgeStats(ORG()); }
    catch (err) {
      return softFail("stats", err, { pending: 0, decided: 0, pendingAuditCount: 0 } as any);
    }
  }

  // /judge/api/me is dispatched directly from main.ts (AUTH_CONTEXT_HANDLERS)
  // — needs the session cookie, danet's @Req doesn't work via router.fetch.

  @Get("reviewers") @ReturnedType(ReviewerListResponse) @Description("List all reviewers")
  async listReviewers() {
    try {
      const users = await listUsers(ORG(), "reviewer");
      return { reviewers: users };
    } catch (err) {
      return softFail("listReviewers", err, { reviewers: [] });
    }
  }

  @Post("reviewers") @ReturnedType(OkMessageResponse) @Description("Create reviewer account") @BodyType(GenericBodyRequest)
  async createReviewer(@Body() body: { email: string; password: string }) {
    // User creation handled via admin/users endpoint
    return { ok: true, message: "use POST /admin/users to create reviewer accounts" };
  }

  @Post("reviewers/delete") @ReturnedType(OkResponse) @Description("Delete reviewer account") @BodyType(DeleteEmailRequest)
  async deleteReviewer(@Body() body: { email: string }) {
    return { ok: true, message: "use POST /admin/users/delete to remove accounts" };
  }

  @Get("reviewer-config") @ReturnedType(ReviewerConfigResponse) @Description("Get reviewer type config")
  async getRevConfig(@Query("email") email: string) {
    try {
      return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
    } catch (err) {
      return softFail(`getRevConfig ${email}`, err, { allowedTypes: ["date-leg", "package"] });
    }
  }

  @Post("reviewer-config") @ReturnedType(OkResponse) @Description("Save reviewer type config") @BodyType(ReviewerConfigRequest)
  async saveRevConfig(@Body() body: { email: string; config: { allowedTypes: string[] } }) {
    try {
      await saveReviewerConfig(ORG(), body.email, body.config as any);
      return { ok: true };
    } catch (err) {
      return softFail(`saveRevConfig ${body.email}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  @Post("dismiss-finding") @ReturnedType(DismissResponse) @Description("Dismiss finding from judge queue") @BodyType(FindingIdRequest)
  async dismissFinding(@Body() body: { findingId: string }) {
    try {
      return await dismissFindingFromJudgeQueue(ORG(), body.findingId);
    } catch (err) {
      return softFail(`dismissFinding ${body.findingId}`, err, { ok: false, retry: true, error: "Server busy, please retry" } as any);
    }
  }

  @Post("dismiss-appeal") @ReturnedType(OkResponse) @Description("Dismiss appeal — clears queue, deletes appeal record, fires dismissal webhook if a reason is supplied") @BodyType(GenericBodyRequest)
  async dismissAppeal(@Body() body: { findingId: string; dismissalReason?: string; judge?: string }) {
    if (!body.findingId) return { error: "findingId required" };
    try {
      const orgId = ORG();
      // Best-effort load before we tear the appeal down — webhook needs the
      // finding for recipient resolution + template variables.
      const { getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
      const finding = await getFinding(orgId, body.findingId).catch(() => null);

      await dismissFindingFromJudgeQueue(orgId, body.findingId);
      await deleteAppeal(orgId, body.findingId);

      if (finding && body.dismissalReason) {
        const { fireWebhook } = await import("@admin/domain/data/admin-repository/mod.ts");
        fireWebhook(orgId, "judge", {
          findingId: body.findingId,
          finding,
          judgedBy: body.judge ?? "",
          dismissalReason: body.dismissalReason,
        }).catch((err) => console.error(`[JUDGE-DISMISS] ${body.findingId}: fireWebhook failed:`, err));
      }
      return { ok: true };
    } catch (err) {
      return softFail(`dismissAppeal ${body.findingId}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  @Get("dashboard") @ReturnedType(JudgeStatsResponse) @Description("Judge dashboard data")
  async dashboardData() {
    try { return await getJudgeStats(ORG()); }
    catch (err) {
      return softFail("dashboardData", err, { pending: 0, decided: 0, pendingAuditCount: 0 } as any);
    }
  }

  @Get("leaderboard") @ReturnedType(OkResponse) @Description("Per-reviewer rollup over an optional date range (defaults to trailing 365d)")
  async leaderboard(@Query("from") from: string, @Query("to") to: string) {
    const fromMs = from ? Number(from) : undefined;
    const toMs = to ? Number(to) : undefined;
    const opts = (Number.isFinite(fromMs) || Number.isFinite(toMs))
      ? { from: Number.isFinite(fromMs) ? fromMs : undefined, to: Number.isFinite(toMs) ? toMs : undefined }
      : undefined;
    try {
      const rows = await getReviewerLeaderboard(ORG(), opts);
      return { rows };
    } catch (err) {
      return softFail("leaderboard", err, { rows: [], stale: true });
    }
  }

  @Get("my-stats") @ReturnedType(OkResponse) @Description("Per-judge stats over an optional date range")
  async myStats(@Query("email") email: string, @Query("from") from: string, @Query("to") to: string) {
    if (!email) return { error: "email required" };
    const fromMs = from ? Number(from) : undefined;
    const toMs = to ? Number(to) : undefined;
    const opts = (Number.isFinite(fromMs) || Number.isFinite(toMs))
      ? { from: Number.isFinite(fromMs) ? fromMs : undefined, to: Number.isFinite(toMs) ? toMs : undefined }
      : undefined;
    try {
      return await getMyJudgeStats(ORG(), email, opts);
    } catch (err) {
      return softFail(`my-stats ${email}`, err, {
        range: { from: 0, to: Date.now() },
        decided: 0, overturned: 0, upheld: 0, overturnRate: 0,
        lastInRangeAt: null, lastDecidedAt: null, stale: true,
      });
    }
  }

  @Get("gamification") @ReturnedType(OkResponse) @Description("Get judge gamification override (or empty if none set)")
  async getGamification(@Query("email") email: string) {
    if (!email) return {};
    try {
      const { getJudgeGamificationOverride } = await import("@gamification/domain/data/gamification-repository/mod.ts");
      return (await getJudgeGamificationOverride(ORG(), email)) ?? {};
    } catch (err) {
      return softFail(`getGamification ${email}`, err, {});
    }
  }

  @Post("gamification") @ReturnedType(OkResponse) @Description("Save judge gamification override") @BodyType(GenericBodyRequest)
  async saveGamification(@Body() body: GenericBodyRequest) {
    const b = body as { email?: string; settings?: Record<string, unknown> };
    if (!b.email) return { error: "email required" };
    try {
      const { saveJudgeGamificationOverride } = await import("@gamification/domain/data/gamification-repository/mod.ts");
      await saveJudgeGamificationOverride(ORG(), b.email, (b.settings ?? {}) as any);
      return { ok: true };
    } catch (err) {
      return softFail(`saveGamification ${b.email}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }
}
