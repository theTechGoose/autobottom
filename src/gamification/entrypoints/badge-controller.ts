/** Badge editor + store controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType } from "jsr:@danet/swagger@2/decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem, getEarnedBadges, purchaseStoreItem } from "@gamification/domain/data/gamification-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Badges & Store — badge editor, cosmetics store, purchases")
@Controller("")
export class BadgeStoreController {

  @Get("admin/badge-editor/items") @ReturnedType(StoreItemListResponse)
  async listBadgeItems() { return { items: await listCustomStoreItems(ORG()) }; }

  @Post("admin/badge-editor/item") @ReturnedType(OkResponse)
  async saveBadgeItem(@Body() body: GenericBodyRequest) { await saveCustomStoreItem(ORG(), body as any); return { ok: true }; }

  @Post("admin/badge-editor/item/delete") @ReturnedType(OkResponse)
  async deleteBadgeItem(@Body() body: { id: string }) { await deleteCustomStoreItem(ORG(), body.id); return { ok: true }; }

  @Get("api/store") @ReturnedType(StoreItemListResponse)
  async getStore() { return { items: await listCustomStoreItems(ORG()) }; }

  @Post("api/store/buy") @ReturnedType(PurchaseResponse)
  async buyItem(@Body() body: { email: string; itemId: string; price: number }) {
    if (!body.email || !body.itemId) return { error: "email, itemId required" };
    return purchaseStoreItem(ORG(), body.email, body.itemId, body.price ?? 0);
  }

  @Post("api/equip") @ReturnedType(OkMessageResponse)
  async equip(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }

  @Get("api/badges") @ReturnedType(BadgeListResponse)
  async getBadges() { return { badges: [], message: "Requires auth context — not yet implemented" }; }
}
