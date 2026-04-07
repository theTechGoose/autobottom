import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import {
  handleJudgeGetGamification, handleJudgeSaveGamification,
  handleReviewerGetGamification, handleReviewerSaveGamification,
  handleBadgesApi,
  handleListPacks, handleSavePack, handleDeletePack,
  handleUploadSound, handleSeedSoundPacks,
  handleGamificationPageGetSettings, handleGamificationPageSaveSettings,
} from "../../../entrypoints/gamification.ts";

@Controller("gamification/api")
export class GamificationController {

  // -- Judge Gamification --

  @Get("judge/settings")
  getJudgeGamification(@Req() req: Request): Promise<Response> {
    return handleJudgeGetGamification(req);
  }

  @Post("judge/settings")
  saveJudgeGamification(@Req() req: Request): Promise<Response> {
    return handleJudgeSaveGamification(req);
  }

  // -- Reviewer Gamification --

  @Get("reviewer/settings")
  getReviewerGamification(@Req() req: Request): Promise<Response> {
    return handleReviewerGetGamification(req);
  }

  @Post("reviewer/settings")
  saveReviewerGamification(@Req() req: Request): Promise<Response> {
    return handleReviewerSaveGamification(req);
  }

  // -- Badges --

  @Get("badges")
  getBadges(@Req() req: Request): Promise<Response> {
    return handleBadgesApi(req);
  }

  // -- Sound Packs --

  @Get("packs")
  listPacks(@Req() req: Request): Promise<Response> {
    return handleListPacks(req);
  }

  @Post("pack")
  savePack(@Req() req: Request): Promise<Response> {
    return handleSavePack(req);
  }

  @Post("pack/delete")
  deletePack(@Req() req: Request): Promise<Response> {
    return handleDeletePack(req);
  }

  @Post("upload-sound")
  uploadSound(@Req() req: Request): Promise<Response> {
    return handleUploadSound(req);
  }

  @Post("seed")
  seedSoundPacks(@Req() req: Request): Promise<Response> {
    return handleSeedSoundPacks(req);
  }

  // -- Page Settings --

  @Get("settings")
  getPageSettings(@Req() req: Request): Promise<Response> {
    return handleGamificationPageGetSettings(req);
  }

  @Post("settings")
  savePageSettings(@Req() req: Request): Promise<Response> {
    return handleGamificationPageSaveSettings(req);
  }
}
