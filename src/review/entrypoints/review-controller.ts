/** Review API controller — wired to real review queue service. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { recordDecision, getReviewStats, getReviewedFindingIds, clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";
import { getReviewerConfig } from "@admin/domain/data/admin-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Review — human-in-the-loop audit verification")
@Controller("review/api")
export class ReviewController {

  @Get("next")
  async next(@Query("types") types: string) {
    // TODO: wire to full claimNextItem with FIFO ordering + transcript enrichment
    return { buffer: [], remaining: 0, message: "claimNextItem pending full port (requires transcript enrichment)" };
  }

  @Post("decide")
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "confirm" | "flip"; reviewer: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.reviewer) {
      return { error: "findingId, questionIndex, decision, reviewer required" };
    }
    const result = await recordDecision(ORG(), body.findingId, body.questionIndex, body.decision, body.reviewer);
    return { ok: true, ...result };
  }

  @Post("back")
  async back(@Body() body: { findingId: string; questionIndex: number; reviewer: string }) {
    // TODO: wire to undoDecision
    return { ok: true, message: "undoDecision pending port" };
  }

  @Get("stats")
  async stats() { return getReviewStats(ORG()); }

  @Get("settings")
  async getSettings(@Query("email") email: string) {
    if (!email) return { error: "email required" };
    return (await getReviewerConfig(ORG(), email)) ?? { allowedTypes: ["date-leg", "package"] };
  }

  @Post("settings")
  async saveSettings(@Body() body: Record<string, any>) {
    return { ok: true, message: "save settings pending port" };
  }

  @Get("me")
  async me() { return { message: "review me — requires auth context" }; }

  @Get("preview")
  async preview(@Query("findingId") findingId: string) {
    return { message: "preview pending port (requires transcript loading)", findingId };
  }

  @Get("dashboard")
  async dashboardData() { return getReviewStats(ORG()); }

  @Get("gamification")
  async getGamification() { return {}; }

  @Post("gamification")
  async saveGamification(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("backfill")
  async backfill() { return { ok: true, message: "backfill pending port" }; }
}
