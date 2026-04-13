/** Review API controller — queue operations, decisions, stats. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { recordDecision, getReviewStats, getReviewedFindingIds, clearReviewQueue } from "@review/domain/business/review-queue/mod.ts";

@SwaggerDescription("Review — human-in-the-loop audit verification")
@Controller("review/api")
export class ReviewController {

  @Get("next")
  async next(@Query("types") types: string) {
    // TODO: port claimNextItem with full FIFO logic
    return { buffer: [], remaining: 0, message: "claimNextItem pending full port" };
  }

  @Post("decide")
  async decide(@Body() body: { findingId: string; questionIndex: number; decision: "confirm" | "flip"; reviewer: string }) {
    if (!body.findingId || body.questionIndex == null || !body.decision || !body.reviewer) {
      return { error: "findingId, questionIndex, decision, reviewer required" };
    }
    // TODO: need orgId from auth
    const orgId = "default";
    const result = await recordDecision(orgId, body.findingId, body.questionIndex, body.decision, body.reviewer);
    return { ok: true, ...result };
  }

  @Post("back")
  async back(@Body() body: { findingId: string; questionIndex: number; reviewer: string }) {
    // TODO: port undoDecision
    return { ok: true, message: "undoDecision pending port" };
  }

  @Get("stats")
  async stats() {
    const orgId = "default";
    return getReviewStats(orgId);
  }

  @Get("settings")
  async getSettings() {
    // TODO: port review settings
    return { message: "review settings pending port" };
  }

  @Post("settings")
  async saveSettings(@Body() body: Record<string, any>) {
    return { ok: true, message: "save settings pending port" };
  }

  @Get("me")
  async me() {
    return { message: "review me pending port" };
  }

  @Get("preview")
  async preview(@Query("findingId") findingId: string) {
    return { message: "preview pending port", findingId };
  }

  @Get("dashboard")
  async dashboardData() {
    return { message: "dashboard data pending port" };
  }

  @Get("gamification")
  async getGamification() {
    return { message: "gamification settings pending port" };
  }

  @Post("gamification")
  async saveGamification(@Body() body: Record<string, any>) {
    return { ok: true, message: "save gamification pending port" };
  }

  @Post("backfill")
  async backfill() {
    return { ok: true, message: "backfill pending port" };
  }
}
