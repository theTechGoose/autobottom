/** Badge editor + store controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Badges & Store — badge editor, cosmetics store, purchases")
@Controller("")
export class BadgeStoreController {

  // -- Badge editor --
  @Get("admin/badge-editor/items")
  async listBadgeItems() { return { items: [] }; }

  @Post("admin/badge-editor/item")
  async saveBadgeItem(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("admin/badge-editor/item/delete")
  async deleteBadgeItem(@Body() body: { id: string }) { return { ok: true }; }

  // -- Store --
  @Get("api/store")
  async getStore() { return { items: [] }; }

  @Post("api/store/buy")
  async buyItem(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("api/equip")
  async equip(@Body() body: Record<string, any>) { return { ok: true }; }

  @Get("api/badges")
  async getBadges() { return { badges: [] }; }
}
