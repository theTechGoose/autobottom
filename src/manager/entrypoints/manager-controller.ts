/** Manager API controller — wired to real manager repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { getManagerQueue, submitRemediation, getManagerStats } from "@manager/domain/data/manager-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { createUser, deleteUser, listUsers } from "@core/domain/business/auth/mod.ts";
import { getGameState } from "@gamification/domain/data/gamification-repository/mod.ts";
import { getPrefabSubscriptions, savePrefabSubscriptions } from "@events/domain/data/events-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Manager — failure remediation and team management")
@Controller("manager/api")
export class ManagerController {

  @Get("queue")
  async queueList() { return { items: await getManagerQueue(ORG()) }; }

  @Get("finding")
  async finding(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const f = await getFinding(ORG(), findingId);
    return f ?? { error: "not found" };
  }

  @Post("remediate")
  async remediate(@Body() body: { findingId: string; notes: string; username: string }) {
    if (!body.findingId || !body.notes || !body.username) return { error: "findingId, notes, username required" };
    return submitRemediation(ORG(), body.findingId, body.notes, body.username);
  }

  @Get("stats")
  async stats() { return getManagerStats(ORG()); }

  @Get("me")
  async me() { return { message: "manager me — requires auth context" }; }

  @Get("game-state")
  async gameState() { return { message: "requires auth email" }; }

  @Get("agents")
  async listAgents() { return { agents: await listUsers(ORG(), "user") }; }

  @Post("agents")
  async createAgent(@Body() body: { email: string; password: string; supervisor?: string }) {
    if (!body.email || !body.password) return { error: "email, password required" };
    await createUser(ORG(), body.email, body.password, "user", body.supervisor);
    return { ok: true };
  }

  @Post("agents/delete")
  async deleteAgent(@Body() body: { email: string }) {
    if (!body.email) return { error: "email required" };
    await deleteUser(ORG(), body.email);
    return { ok: true };
  }

  @Post("backfill")
  async backfill() { return { ok: true, message: "manager backfill pending port" }; }

  @Get("prefab-subscriptions")
  async getPrefabs() { return getPrefabSubscriptions(ORG()); }

  @Post("prefab-subscriptions")
  async savePrefabs(@Body() body: Record<string, boolean>) {
    await savePrefabSubscriptions(ORG(), body);
    return { ok: true };
  }
}
