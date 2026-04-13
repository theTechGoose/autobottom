/** Judge API controller — wired to real judge repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { recordJudgeDecision, getJudgeStats, getAppeal, dismissFindingFromJudgeQueue, clearJudgeQueue } from "@judge/domain/data/judge-repository/mod.ts";
import { getReviewerConfig, saveReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { listUsers } from "@core/domain/business/auth/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Judge — appeal review and reviewer management")
@Controller("judge/api")
export class JudgeController {

  @Get("next")
  async next() {
    // TODO: wire to full claimNextItem with transcript enrichment
    return { buffer: [], remaining: 0, message: "judge claimNextItem pending full port" };
  }

  @Post("decide")
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "uphold" | "overturn"; judge: string; reason?: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.judge) {
      return { error: "findingId, questionIndex, decision, judge required" };
    }
    const result = await recordJudgeDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.judge, body.reason);
    return { ok: true, ...result };
  }

  @Post("back")
  async back(@Body() body: Record<string, any>) { return { ok: true, message: "judge back pending port" }; }

  @Get("stats")
  async stats() { return getJudgeStats(ORG()); }

  @Get("me")
  async me() { return { message: "judge me — requires auth context" }; }

  @Get("reviewers")
  async listReviewers() {
    const users = await listUsers(ORG(), "reviewer");
    return { reviewers: users };
  }

  @Post("reviewers")
  async createReviewer(@Body() body: { email: string; password: string }) {
    // User creation handled via admin/users endpoint
    return { ok: true, message: "use POST /admin/users to create reviewer accounts" };
  }

  @Post("reviewers/delete")
  async deleteReviewer(@Body() body: { email: string }) {
    return { ok: true, message: "use POST /admin/users/delete to remove accounts" };
  }

  @Get("reviewer-config")
  async getRevConfig(@Query("email") email: string) {
    return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
  }

  @Post("reviewer-config")
  async saveRevConfig(@Body() body: { email: string; config: { allowedTypes: string[] } }) {
    await saveReviewerConfig(ORG(), body.email, body.config as any);
    return { ok: true };
  }

  @Post("dismiss-finding")
  async dismissFinding(@Body() body: { findingId: string }) {
    return dismissFindingFromJudgeQueue(ORG(), body.findingId);
  }

  @Post("dismiss-appeal")
  async dismissAppeal(@Body() body: { findingId: string }) {
    await dismissFindingFromJudgeQueue(ORG(), body.findingId);
    return { ok: true };
  }

  @Get("dashboard")
  async dashboardData() { return getJudgeStats(ORG()); }

  @Get("gamification")
  async getGamification() { return {}; }

  @Post("gamification")
  async saveGamification(@Body() body: Record<string, any>) { return { ok: true }; }
}
