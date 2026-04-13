/** Judge API controller — appeal decisions, reviewer management. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Judge — appeal review and reviewer management")
@Controller("judge/api")
export class JudgeController {

  @Get("next")
  async next() { return { buffer: [], remaining: 0 }; }

  @Post("decide")
  async decide(@Body() body: Record<string, any>) { return { ok: true, message: "judge decide pending port" }; }

  @Post("back")
  async back(@Body() body: Record<string, any>) { return { ok: true, message: "judge back pending port" }; }

  @Get("stats")
  async stats() { return { pending: 0, active: 0, decided: 0 }; }

  @Get("me")
  async me() { return { message: "judge me pending port" }; }

  @Get("reviewers")
  async listReviewers() { return { reviewers: [] }; }

  @Post("reviewers")
  async createReviewer(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("reviewers/delete")
  async deleteReviewer(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("reviewer-config")
  async getReviewerConfig(@Query("email") email: string) { return { email, config: null }; }

  @Post("reviewer-config")
  async saveReviewerConfig(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("dismiss-finding")
  async dismissFinding(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("dismiss-appeal")
  async dismissAppeal(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("dashboard")
  async dashboardData() { return { message: "judge dashboard pending port" }; }

  @Get("gamification")
  async getGamification() { return {}; }

  @Post("gamification")
  async saveGamification(@Body() body: Record<string, any>) { return { ok: true }; }
}
