/** Gamification controller — wired to real gamification repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, PackIdRequest } from "@core/dto/requests.ts";
import * as gam from "@gamification/domain/data/gamification-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Gamification — sound packs, badges, XP settings")
@Controller("gamification/api")
export class GamificationPageController {

  @Get("packs") @ReturnedType(SoundPackListResponse)
  async listPacks() { return { packs: await gam.listSoundPacks(ORG()) }; }

  @Post("pack") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async savePack(@Body() body: GenericBodyRequest) { await gam.saveSoundPack(ORG(), body as any); return { ok: true }; }

  @Post("pack/delete") @ReturnedType(OkResponse) @BodyType(PackIdRequest)
  async deletePack(@Body() body: { packId: string }) { await gam.deleteSoundPack(ORG(), body.packId); return { ok: true }; }

  @Post("upload-sound") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  async uploadSound(@Body() body: GenericBodyRequest) { return { ok: true, message: "upload requires S3 wiring" }; }

  @Post("seed") @ReturnedType(OkMessageResponse)
  async seedSoundPacks() { return { ok: true, message: "Sound pack seeding requires predefined pack data" }; }

  @Get("settings") @ReturnedType(GamificationSettingsResponse)
  async getSettings() { return (await gam.getGamificationSettings(ORG())) ?? {}; }

  @Post("settings") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async saveSettings(@Body() body: GenericBodyRequest) { await gam.saveGamificationSettings(ORG(), body as any); return { ok: true }; }
}
