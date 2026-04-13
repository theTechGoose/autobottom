/** Badge editor + store controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem, getEarnedBadges, purchaseStoreItem } from "@gamification/domain/data/gamification-repository/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Badges & Store — badge editor, cosmetics store, purchases")
@Controller("")
export class BadgeStoreController {

  @Get("admin/badge-editor/items")
  async listBadgeItems() { return { items: await listCustomStoreItems(ORG()) }; }

  @Post("admin/badge-editor/item")
  async saveBadgeItem(@Body() body: Record<string, any>) { await saveCustomStoreItem(ORG(), body as any); return { ok: true }; }

  @Post("admin/badge-editor/item/delete")
  async deleteBadgeItem(@Body() body: { id: string }) { await deleteCustomStoreItem(ORG(), body.id); return { ok: true }; }

  @Get("api/store")
  async getStore() { return { items: await listCustomStoreItems(ORG()) }; }

  @Post("api/store/buy")
  async buyItem(@Body() body: { email: string; itemId: string; price: number }) {
    if (!body.email || !body.itemId) return { error: "email, itemId required" };
    return purchaseStoreItem(ORG(), body.email, body.itemId, body.price ?? 0);
  }

  @Post("api/equip")
  async equip(@Body() body: Record<string, any>) { return { ok: true, message: "equip pending cosmetics port" }; }

  @Get("api/badges")
  async getBadges() { return { badges: [], message: "requires auth email for user-specific badges" }; }
}
