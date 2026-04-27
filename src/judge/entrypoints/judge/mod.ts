/** Judge API controller — wired to real judge repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { JudgeStatsResponse, ReviewBufferResponse, DecisionResponse, OkResponse, OkMessageResponse, ReviewerListResponse, ReviewerConfigResponse, DismissResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, JudgeDecideRequest, DeleteEmailRequest, ReviewerConfigRequest, FindingIdRequest } from "@core/dto/requests.ts";
import { recordJudgeDecision, getJudgeStats, getAppeal, dismissFindingFromJudgeQueue, clearJudgeQueue, deleteAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { getReviewerConfig, saveReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { listUsers } from "@core/business/auth/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Judge — appeal review and reviewer management")
@Controller("judge/api")
export class JudgeController {

  @Get("next") @ReturnedType(ReviewBufferResponse) @Description("Claim next judge items")
  async next(@Query("judge") judge: string) {
    if (!judge) return { error: "judge query param required" };
    const { claimNextItemLegacy: claimNextItem } = await import("@judge/domain/data/judge-repository/mod.ts");
    return claimNextItem(ORG(), judge);
  }

  @Post("decide") @ReturnedType(DecisionResponse) @Description("Uphold or overturn an appealed question") @BodyType(JudgeDecideRequest)
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "uphold" | "overturn"; judge: string; reason?: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.judge) {
      return { error: "findingId, questionIndex, decision, judge required" };
    }
    const result = await recordJudgeDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.judge, body.reason);
    return { ok: true, ...result };
  }

  @Post("back") @ReturnedType(ReviewBufferResponse) @Description("Undo last judge decision") @BodyType(GenericBodyRequest)
  async back(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.judge) return { error: "judge required" };
    const { undoDecisionLegacy: undoDecision } = await import("@judge/domain/data/judge-repository/mod.ts");
    return undoDecision(ORG(), b.judge);
  }

  @Get("stats") @ReturnedType(JudgeStatsResponse) @Description("Judge queue statistics")
  async stats() { return getJudgeStats(ORG()); }

  // /judge/api/me is dispatched directly from main.ts (AUTH_CONTEXT_HANDLERS)
  // — needs the session cookie, danet's @Req doesn't work via router.fetch.

  @Get("reviewers") @ReturnedType(ReviewerListResponse) @Description("List all reviewers")
  async listReviewers() {
    const users = await listUsers(ORG(), "reviewer");
    return { reviewers: users };
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
    return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
  }

  @Post("reviewer-config") @ReturnedType(OkResponse) @Description("Save reviewer type config") @BodyType(ReviewerConfigRequest)
  async saveRevConfig(@Body() body: { email: string; config: { allowedTypes: string[] } }) {
    await saveReviewerConfig(ORG(), body.email, body.config as any);
    return { ok: true };
  }

  @Post("dismiss-finding") @ReturnedType(DismissResponse) @Description("Dismiss finding from judge queue") @BodyType(FindingIdRequest)
  async dismissFinding(@Body() body: { findingId: string }) {
    return dismissFindingFromJudgeQueue(ORG(), body.findingId);
  }

  @Post("dismiss-appeal") @ReturnedType(OkResponse) @Description("Dismiss appeal — clears queue, deletes appeal record, fires dismissal webhook if a reason is supplied") @BodyType(GenericBodyRequest)
  async dismissAppeal(@Body() body: { findingId: string; dismissalReason?: string; judge?: string }) {
    if (!body.findingId) return { error: "findingId required" };
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
  }

  @Get("dashboard") @ReturnedType(JudgeStatsResponse) @Description("Judge dashboard data")
  async dashboardData() { return getJudgeStats(ORG()); }

  @Get("gamification") @ReturnedType(OkResponse) @Description("Get gamification settings")
  async getGamification() { return {}; }

  @Post("gamification") @ReturnedType(OkResponse) @Description("Save gamification settings") @BodyType(GenericBodyRequest)
  async saveGamification(@Body() body: GenericBodyRequest) { return { ok: true }; }
}
