import "reflect-metadata";
import { Controller, Get, Post, Req } from "@danet/core";
import { handleBadgesApi } from "../../../entrypoints/gamification.ts";
import { handleEquip } from "../../../entrypoints/chat.ts";
import { handleGetPrefabSubscriptions, handleSavePrefabSubscriptions } from "../../../entrypoints/store.ts";

@Controller("api")
export class StoreController {

  @Get("badges")
  badges(@Req() req: Request): Promise<Response> {
    return handleBadgesApi(req);
  }

  @Post("equip")
  equip(@Req() req: Request): Promise<Response> {
    return handleEquip(req);
  }

  @Get("prefab-subscriptions")
  getPrefabSubscriptions(@Req() req: Request): Promise<Response> {
    return handleGetPrefabSubscriptions(req);
  }

  @Post("prefab-subscriptions")
  savePrefabSubscriptions(@Req() req: Request): Promise<Response> {
    return handleSavePrefabSubscriptions(req);
  }
}
