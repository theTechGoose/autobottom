/** Gamification controller — wired to real gamification repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import * as gam from "@gamification/domain/data/gamification-repository/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Gamification — sound packs, badges, XP settings")
@Controller("gamification/api")
export class GamificationPageController {

  @Get("packs")
  async listPacks() { return { packs: await gam.listSoundPacks(ORG()) }; }

  @Post("pack")
  async savePack(@Body() body: Record<string, any>) { await gam.saveSoundPack(ORG(), body as any); return { ok: true }; }

  @Post("pack/delete")
  async deletePack(@Body() body: { packId: string }) { await gam.deleteSoundPack(ORG(), body.packId); return { ok: true }; }

  @Post("upload-sound")
  async uploadSound(@Body() body: Record<string, any>) { return { ok: true, message: "upload requires S3 wiring" }; }

  @Post("seed")
  async seedSoundPacks() { return { ok: true, message: "seed pending port" }; }

  @Get("settings")
  async getSettings() { return (await gam.getGamificationSettings(ORG())) ?? {}; }

  @Post("settings")
  async saveSettings(@Body() body: Record<string, any>) { await gam.saveGamificationSettings(ORG(), body as any); return { ok: true }; }
}
