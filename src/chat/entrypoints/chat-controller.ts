/** Chat/messaging controller — wired to real chat repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { sendMessage, getUnreadCount, getConversationList } from "@chat/domain/data/chat-repository/mod.ts";
import { listUsers } from "@core/domain/business/auth/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Chat — internal messaging between team members")
@Controller("api")
export class ChatController {

  @Post("messages")
  async doSendMessage(@Body() body: { from: string; to: string; body: string }) {
    if (!body.from || !body.to || !body.body) return { error: "from, to, body required" };
    return sendMessage(ORG(), body.from, body.to, body.body);
  }

  @Get("messages/unread")
  async getUnread(@Query("email") email: string) {
    if (!email) return { count: 0 };
    return { count: await getUnreadCount(ORG(), email) };
  }

  @Get("messages/conversations")
  async getConversations(@Query("email") email: string) {
    if (!email) return { conversations: [] };
    return { conversations: await getConversationList(ORG(), email) };
  }

  @Get("users")
  async getOrgUsers() { return { users: await listUsers(ORG()) }; }
}
