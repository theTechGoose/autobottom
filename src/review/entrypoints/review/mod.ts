/** Review API controller — wired to real review queue service. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { ReviewBufferResponse, DecisionResponse, ReviewStatsResponse, OkResponse, OkMessageResponse, ReviewerConfigResponse, MessageResponse, GamificationSettingsResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, ReviewDecideRequest, ReviewBackRequest } from "@core/dto/requests.ts";
import { recordDecision, finalizeReviewedAudit, getReviewStats, getReviewedFindingIds, clearReviewQueue, getFailedQuestionsForFinding, getDecisionsByFinding } from "@review/domain/business/review-queue/mod.ts";
import { getReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Review — human-in-the-loop audit verification")
@Controller("review/api")
export class ReviewController {

  @Get("next") @ReturnedType(ReviewBufferResponse) @Description("Claim next review items (FIFO oldest audit first)")
  async next(@Query("types") types: string, @Query("reviewer") reviewer: string) {
    if (!reviewer) return { error: "reviewer query param required" };
    const { claimNextItemLegacy: claimNextItem } = await import("@review/domain/business/review-queue/mod.ts");
    const allowedTypes = types ? types.split(",").map((t: string) => t.trim()) : undefined;
    const result = await claimNextItem(ORG(), reviewer, allowedTypes);
    const fid = result.buffer[0]?.findingId;
    if (!fid) return { ...result, fullBuffer: [], decisions: {} };
    const [fullBuffer, decisions] = await Promise.all([
      getFailedQuestionsForFinding(ORG(), fid),
      getDecisionsByFinding(ORG(), fid),
    ]);
    return { ...result, fullBuffer, decisions };
  }

  @Post("decide") @ReturnedType(DecisionResponse) @Description("Confirm or flip a reviewed question") @BodyType(ReviewDecideRequest)
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "confirm" | "flip"; reviewer: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.reviewer) {
      return { error: "findingId, questionIndex, decision, reviewer required" };
    }
    const result = await recordDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.reviewer);
    const [fullBuffer, decisions] = await Promise.all([
      getFailedQuestionsForFinding(ORG(), body.findingId),
      getDecisionsByFinding(ORG(), body.findingId),
    ]);
    return {
      ok: true,
      ...result,
      xpGained: body.decision === "flip" ? 15 : 10,
      newBadges: [] as string[],
      fullBuffer,
      decisions,
    };
  }

  @Post("finalize") @ReturnedType(OkResponse) @Description("Finalize a reviewed audit — apply flips, recompute score, fire terminate webhook") @BodyType(GenericBodyRequest)
  async finalize(@Body() body: GenericBodyRequest) {
    const b = body as { findingId?: string; reviewer?: string };
    if (!b.findingId || !b.reviewer) return { error: "findingId and reviewer required" };
    try {
      const r = await finalizeReviewedAudit(ORG(), b.findingId, b.reviewer);
      return { ok: true, score: r.score, alreadyFinalized: r.alreadyFinalized ?? false };
    } catch (err) {
      console.error(`❌ [REVIEW] finalize failed for ${b.findingId}:`, err);
      return { ok: false, error: String(err) };
    }
  }

  @Post("back") @ReturnedType(ReviewBufferResponse) @Description("Undo last decision") @BodyType(ReviewBackRequest)
  async back(@Body() body: { findingId: string; questionIndex: number; reviewer: string }) {
    if (!body.reviewer) return { error: "reviewer required" };
    const { undoDecisionLegacy: undoDecision } = await import("@review/domain/business/review-queue/mod.ts");
    return undoDecision(ORG(), body.reviewer);
  }

  @Get("stats") @ReturnedType(ReviewStatsResponse) @Description("Review queue statistics")
  async stats() { return getReviewStats(ORG()); }

  @Get("settings") @ReturnedType(ReviewerConfigResponse) @Description("Get reviewer settings")
  async getSettings(@Query("email") email: string) {
    if (!email) return { error: "email required" };
    return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
  }

  @Post("settings") @ReturnedType(OkResponse) @Description("Save reviewer settings") @BodyType(GenericBodyRequest)
  async saveSettings(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.email || !b.config) return { error: "email and config required" };
    const { saveReviewerConfig } = await import("@admin/domain/data/admin-repository/mod.ts");
    await saveReviewerConfig(ORG(), b.email, b.config);
    return { ok: true };
  }

  // /review/api/me is dispatched directly from main.ts (AUTH_CONTEXT_HANDLERS)
  // — needs the session cookie, danet's @Req doesn't work via router.fetch.

  @Get("preview") @ReturnedType(ReviewBufferResponse) @Description("Preview a finding for review")
  async preview(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const { previewFindingLegacy: previewFinding } = await import("@review/domain/business/review-queue/mod.ts");
    const items = await previewFinding(ORG(), findingId);
    return { buffer: items ?? [], remaining: 0 };
  }

  @Get("dashboard") @ReturnedType(ReviewStatsResponse) @Description("Review dashboard data")
  async dashboardData() { return getReviewStats(ORG()); }

  @Get("gamification") @ReturnedType(GamificationSettingsResponse) @Description("Get reviewer gamification override (or empty if none set)")
  async getGamification(@Query("email") email: string) {
    if (!email) return {};
    const { getReviewerGamificationOverride } = await import("@gamification/domain/data/gamification-repository/mod.ts");
    return (await getReviewerGamificationOverride(ORG(), email)) ?? {};
  }

  @Post("gamification") @ReturnedType(OkResponse) @Description("Save reviewer gamification override") @BodyType(GenericBodyRequest)
  async saveGamification(@Body() body: GenericBodyRequest) {
    const b = body as { email?: string; settings?: Record<string, unknown> };
    if (!b.email) return { error: "email required" };
    const { saveReviewerGamificationOverride } = await import("@gamification/domain/data/gamification-repository/mod.ts");
    await saveReviewerGamificationOverride(ORG(), b.email, (b.settings ?? {}) as any);
    return { ok: true };
  }

  @Post("backfill") @ReturnedType(OkMessageResponse) @Description("Backfill review queue")
  async backfill() { const { backfillFromFinishedLegacy: backfillFromFinished } = await import("@review/domain/business/review-queue/mod.ts"); await backfillFromFinished(ORG()); return { ok: true }; }
}
