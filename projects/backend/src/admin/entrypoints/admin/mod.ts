import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import {
  handleDashboardData, handleAdminMe,
  handleBadgeEditorItems, handleBadgeEditorSave, handleBadgeEditorDelete,
  handleAdminGetSettings, handleAdminSaveSettings,
  handleAdminListUsers, handleAdminAddUser,
  handleGetPipelineConfig, handleSetPipelineConfig,
  handleAdminGetGamification, handleAdminSaveGamification,
  handleGetQueues, handleSetQueue, handleGetParallelism, handleSetParallelism,
  handleListEmailReports, handleSaveEmailReport, handleDeleteEmailReport,
  handleTokenUsage, handleForceNos,
  handleSeedDryRun, handleSeed,
  handleResetFinding, handleWipeKv,
} from "../../../entrypoints/admin.ts";

@Controller("admin")
export class AdminController {

  // -- Dashboard --

  @Get("dashboard/data")
  dashboardData(@Req() req: Request): Promise<Response> {
    return handleDashboardData(req);
  }

  @Get("api/me")
  me(@Req() req: Request): Promise<Response> {
    return handleAdminMe(req);
  }

  // -- Badge Editor --

  @Get("badge-editor/items")
  badgeEditorItems(@Req() req: Request): Promise<Response> {
    return handleBadgeEditorItems(req);
  }

  @Post("badge-editor/item")
  badgeEditorSave(@Req() req: Request): Promise<Response> {
    return handleBadgeEditorSave(req);
  }

  @Post("badge-editor/item/delete")
  badgeEditorDelete(@Req() req: Request): Promise<Response> {
    return handleBadgeEditorDelete(req);
  }

  // -- Settings (terminate, appeal, manager, review, judge, judge-finish) --

  @Get("settings/terminate")
  getSettingsTerminate(@Req() req: Request): Promise<Response> {
    return handleAdminGetSettings(req);
  }

  @Post("settings/terminate")
  saveSettingsTerminate(@Req() req: Request): Promise<Response> {
    return handleAdminSaveSettings(req);
  }

  @Get("settings/appeal")
  getSettingsAppeal(@Req() req: Request): Promise<Response> {
    return handleAdminGetSettings(req);
  }

  @Post("settings/appeal")
  saveSettingsAppeal(@Req() req: Request): Promise<Response> {
    return handleAdminSaveSettings(req);
  }

  @Get("settings/manager")
  getSettingsManager(@Req() req: Request): Promise<Response> {
    return handleAdminGetSettings(req);
  }

  @Post("settings/manager")
  saveSettingsManager(@Req() req: Request): Promise<Response> {
    return handleAdminSaveSettings(req);
  }

  @Get("settings/review")
  getSettingsReview(@Req() req: Request): Promise<Response> {
    return handleAdminGetSettings(req);
  }

  @Post("settings/review")
  saveSettingsReview(@Req() req: Request): Promise<Response> {
    return handleAdminSaveSettings(req);
  }

  @Get("settings/judge")
  getSettingsJudge(@Req() req: Request): Promise<Response> {
    return handleAdminGetSettings(req);
  }

  @Post("settings/judge")
  saveSettingsJudge(@Req() req: Request): Promise<Response> {
    return handleAdminSaveSettings(req);
  }

  @Get("settings/judge-finish")
  getSettingsJudgeFinish(@Req() req: Request): Promise<Response> {
    return handleAdminGetSettings(req);
  }

  @Post("settings/judge-finish")
  saveSettingsJudgeFinish(@Req() req: Request): Promise<Response> {
    return handleAdminSaveSettings(req);
  }

  // -- Gamification Settings --

  @Get("settings/gamification")
  getGamification(@Req() req: Request): Promise<Response> {
    return handleAdminGetGamification(req);
  }

  @Post("settings/gamification")
  saveGamification(@Req() req: Request): Promise<Response> {
    return handleAdminSaveGamification(req);
  }

  // -- Users --

  @Get("users")
  listUsers(@Req() req: Request): Promise<Response> {
    return handleAdminListUsers(req);
  }

  @Post("users")
  addUser(@Req() req: Request): Promise<Response> {
    return handleAdminAddUser(req);
  }

  // -- Pipeline Config --

  @Get("pipeline-config")
  getPipelineConfig(@Req() req: Request): Promise<Response> {
    return handleGetPipelineConfig(req);
  }

  @Post("pipeline-config")
  setPipelineConfig(@Req() req: Request): Promise<Response> {
    return handleSetPipelineConfig(req);
  }

  // -- Queues --

  @Get("queues")
  getQueues(@Req() req: Request): Promise<Response> {
    return handleGetQueues(req);
  }

  @Post("queues")
  setQueue(@Req() req: Request): Promise<Response> {
    return handleSetQueue(req);
  }

  // -- Parallelism --

  @Get("parallelism")
  getParallelism(@Req() req: Request): Promise<Response> {
    return handleGetParallelism(req);
  }

  @Post("parallelism")
  setParallelism(@Req() req: Request): Promise<Response> {
    return handleSetParallelism(req);
  }

  // -- Email Reports --

  @Get("email-reports")
  listEmailReports(@Req() req: Request): Promise<Response> {
    return handleListEmailReports(req);
  }

  @Post("email-reports")
  saveEmailReport(@Req() req: Request): Promise<Response> {
    return handleSaveEmailReport(req);
  }

  @Post("email-reports/delete")
  deleteEmailReport(@Req() req: Request): Promise<Response> {
    return handleDeleteEmailReport(req);
  }

  // -- Token Usage --

  @Get("token-usage")
  tokenUsage(@Req() req: Request): Promise<Response> {
    return handleTokenUsage(req);
  }

  // -- Force Nos --

  @Post("force-nos")
  forceNos(@Req() req: Request): Promise<Response> {
    return handleForceNos(req);
  }

  // -- Seed --

  @Get("seed")
  seedDryRun(@Req() req: Request): Promise<Response> {
    return handleSeedDryRun(req);
  }

  @Post("seed")
  seed(@Req() req: Request): Promise<Response> {
    return handleSeed(req);
  }

  // -- Reset Finding --

  @Post("reset-finding")
  resetFinding(@Req() req: Request): Promise<Response> {
    return handleResetFinding(req);
  }

  // -- Wipe KV --

  @Post("wipe-kv")
  wipeKv(@Req() req: Request): Promise<Response> {
    return handleWipeKv(req);
  }
}
