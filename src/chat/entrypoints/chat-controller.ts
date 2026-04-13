/** Chat/messaging controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Chat — internal messaging between team members")
@Controller("api")
export class ChatController {

  @Post("messages")
  async sendMessage(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("messages/unread")
  async getUnread() { return { count: 0 }; }

  @Get("messages/conversations")
  async getConversations() { return { conversations: [] }; }

  @Get("users")
  async getOrgUsers() { return { users: [] }; }
}
