/** Chat/messaging controller — wired to real chat repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType } from "jsr:@danet/swagger@2/decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { sendMessage, getUnreadCount, getConversationList } from "@chat/domain/data/chat-repository/mod.ts";
import { listUsers } from "@core/domain/business/auth/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Chat — internal messaging between team members")
@Controller("api")
export class ChatController {

  @Post("messages") @ReturnedType(MessageSentResponse)
  async doSendMessage(@Body() body: { from: string; to: string; body: string }) {
    if (!body.from || !body.to || !body.body) return { error: "from, to, body required" };
    return sendMessage(ORG(), body.from, body.to, body.body);
  }

  @Get("messages/unread") @ReturnedType(UnreadCountResponse)
  async getUnread(@Query("email") email: string) {
    if (!email) return { count: 0 };
    return { count: await getUnreadCount(ORG(), email) };
  }

  @Get("messages/conversations") @ReturnedType(ConversationListResponse)
  async getConversations(@Query("email") email: string) {
    if (!email) return { conversations: [] };
    return { conversations: await getConversationList(ORG(), email) };
  }

  @Get("users") @ReturnedType(UserListResponse)
  async getOrgUsers() { return { users: await listUsers(ORG()) }; }
}
