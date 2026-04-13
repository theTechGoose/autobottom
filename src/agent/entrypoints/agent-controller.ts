/** Agent (team member) controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { getGameState, purchaseStoreItem, listCustomStoreItems } from "@gamification/domain/data/gamification-repository/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Agent — team member dashboard, game state, store")
@Controller("agent/api")
export class AgentApiController {

  @Get("dashboard")
  async dashboardData() { return { message: "agent dashboard — requires auth email for personalized data" }; }

  @Get("me")
  async me() { return { message: "agent me — requires auth context" }; }

  @Get("game-state")
  async gameState() { return { message: "requires auth email" }; }

  @Get("store")
  async store() { return { items: await listCustomStoreItems(ORG()) }; }

  @Post("store/buy")
  async storeBuy(@Body() body: { email: string; itemId: string; price: number }) {
    if (!body.email || !body.itemId) return { error: "email, itemId required" };
    return purchaseStoreItem(ORG(), body.email, body.itemId, body.price ?? 0);
  }
}
