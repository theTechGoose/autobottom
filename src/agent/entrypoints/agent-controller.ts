/** Agent (team member) controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Agent — team member dashboard, game state, store")
@Controller("agent/api")
export class AgentApiController {

  @Get("dashboard")
  async dashboardData() { return { message: "agent dashboard pending port" }; }

  @Get("me")
  async me() { return { message: "agent me pending port" }; }

  @Get("game-state")
  async gameState() { return {}; }

  @Get("store")
  async store() { return { items: [] }; }

  @Post("store/buy")
  async storeBuy(@Body() body: Record<string, any>) { return { ok: true }; }
}
