/** Agent (team member) controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, PurchaseRequest } from "@core/dto/requests.ts";
import { getGameState, purchaseStoreItem, listCustomStoreItems } from "@gamification/domain/data/gamification-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Agent — team member dashboard, game state, store")
@Controller("agent/api")
export class AgentApiController {

  @Get("dashboard") @ReturnedType(MessageResponse)
  async dashboardData() { return { message: "Requires auth context — not yet implemented" }; }

  @Get("me") @ReturnedType(MessageResponse)
  async me() { return { message: "Requires auth context — not yet implemented" }; }

  @Get("game-state") @ReturnedType(MessageResponse)
  async gameState() { return { message: "Requires auth context — not yet implemented" }; }

  @Get("store") @ReturnedType(StoreItemListResponse)
  async store() { return { items: await listCustomStoreItems(ORG()) }; }

  @Post("store/buy") @ReturnedType(PurchaseResponse) @BodyType(PurchaseRequest)
  async storeBuy(@Body() body: { email: string; itemId: string; price: number }) {
    if (!body.email || !body.itemId) return { error: "email, itemId required" };
    return purchaseStoreItem(ORG(), body.email, body.itemId, body.price ?? 0);
  }
}
