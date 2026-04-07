import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { handleChatMe, handleChatCosmetics, handleEquip } from "../../../entrypoints/chat.ts";

@Controller("chat/api")
export class ChatController {

  @Get("me")
  me(@Req() req: Request): Promise<Response> {
    return handleChatMe(req);
  }

  @Get("cosmetics")
  cosmetics(@Req() req: Request): Promise<Response> {
    return handleChatCosmetics(req);
  }

  @Post("equip")
  equip(@Req() req: Request): Promise<Response> {
    return handleEquip(req);
  }
}
