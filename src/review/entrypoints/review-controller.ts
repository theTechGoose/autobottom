/** Review API controller — wired to real review queue service. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "jsr:@danet/swagger@2/decorators";
import { ReviewBufferResponse, DecisionResponse, ReviewStatsResponse, OkResponse, OkMessageResponse, ReviewerConfigResponse, MessageResponse, GamificationSettingsResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { recordDecision, getReviewStats, getReviewedFindingIds, clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";
import { getReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Review — human-in-the-loop audit verification")
@Controller("review/api")
export class ReviewController {

  @Get("next") @ReturnedType(ReviewBufferResponse) @Description("Claim next review items (FIFO oldest audit first)")
  async next(@Query("types") types: string) {
    // TODO: wire to full claimNextItem with FIFO ordering + transcript enrichment
    return { buffer: [], remaining: 0, message: "Not yet implemented" };
  }

  @Post("decide") @ReturnedType(DecisionResponse) @Description("Confirm or flip a reviewed question")
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "confirm" | "flip"; reviewer: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.reviewer) {
      return { error: "findingId, questionIndex, decision, reviewer required" };
    }
    const result = await recordDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.reviewer);
    return { ok: true, ...result };
  }

  @Post("back") @ReturnedType(OkMessageResponse) @Description("Undo last decision")
  async back(@Body() body: { findingId: string; questionIndex: number; reviewer: string }) {
    // TODO: wire to undoDecision
    return { ok: true, message: "Not yet implemented" };
  }

  @Get("stats") @ReturnedType(ReviewStatsResponse) @Description("Review queue statistics")
  async stats() { return getReviewStats(ORG()); }

  @Get("settings") @ReturnedType(ReviewerConfigResponse) @Description("Get reviewer settings")
  async getSettings(@Query("email") email: string) {
    if (!email) return { error: "email required" };
    return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
  }

  @Post("settings") @ReturnedType(OkMessageResponse) @Description("Save reviewer settings")
  async saveSettings(@Body() body: GenericBodyRequest) {
    return { ok: true, message: "Not yet implemented" };
  }

  @Get("me") @ReturnedType(MessageResponse) @Description("Get current reviewer info")
  async me() { return { message: "Requires auth context — not yet implemented" }; }

  @Get("preview") @ReturnedType(MessageResponse) @Description("Preview a finding for review")
  async preview(@Query("findingId") findingId: string) {
    return { message: "Not yet implemented", findingId };
  }

  @Get("dashboard") @ReturnedType(ReviewStatsResponse) @Description("Review dashboard data")
  async dashboardData() { return getReviewStats(ORG()); }

  @Get("gamification") @ReturnedType(GamificationSettingsResponse) @Description("Get gamification settings")
  async getGamification() { return {}; }

  @Post("gamification") @ReturnedType(OkResponse) @Description("Save gamification settings")
  async saveGamification(@Body() body: GenericBodyRequest) { return { ok: true }; }

  @Post("backfill") @ReturnedType(OkMessageResponse) @Description("Backfill review queue")
  async backfill() { const { backfillFromFinished } = await import("../../../review/kv.ts"); await backfillFromFinished(ORG()); return { ok: true }; }
}
