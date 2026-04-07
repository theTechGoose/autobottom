import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import {
  handleSSE, handleSendMessage, handleGetConversation,
  handleGetUnread, handleGetConversations, handleGetOrgUsers,
} from "../../../entrypoints/messaging.ts";

@Controller("api")
export class MessagingController {

  /**
   * SSE endpoint for real-time events.
   * Returns a ReadableStream wrapped in a raw Response.
   */
  @Get("events")
  events(@Req() req: Request): Promise<Response> {
    return handleSSE(req);
  }

  // -- Messaging --

  @Post("messages")
  sendMessage(@Req() req: Request): Promise<Response> {
    return handleSendMessage(req);
  }

  @Get("messages/unread")
  getUnread(@Req() req: Request): Promise<Response> {
    return handleGetUnread(req);
  }

  @Get("messages/conversations")
  getConversations(@Req() req: Request): Promise<Response> {
    return handleGetConversations(req);
  }

  /**
   * Dynamic route: GET /api/messages/:email
   * Retrieves conversation with a specific user.
   */
  @Get("messages/:email")
  getConversation(@Req() req: Request): Promise<Response> {
    return handleGetConversation(req);
  }

  // -- Users --

  @Get("users")
  getOrgUsers(@Req() req: Request): Promise<Response> {
    return handleGetOrgUsers(req);
  }
}
