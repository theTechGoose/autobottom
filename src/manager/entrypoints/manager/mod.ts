/** Manager API controller — wired to real manager repository. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { ManagerQueueResponse, ManagerStatsResponse, OkResponse, OkMessageResponse, AgentListResponse, MessageResponse, FindingResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, RemediateRequest, CreateAgentRequest, DeleteEmailRequest, PrefabSubscriptionsRequest } from "@core/dto/requests.ts";
import { getManagerQueue, submitRemediation, getManagerStats } from "@manager/domain/data/manager-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { createUser, deleteUser, listUsers } from "@core/business/auth/mod.ts";
import { getPrefabSubscriptions, savePrefabSubscriptions } from "@events/domain/data/events-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Manager — failure remediation and team management")
@Controller("manager/api")
export class ManagerController {

  @Get("queue") @ReturnedType(ManagerQueueResponse) @Description("List manager queue items")
  async queueList() { return { items: await getManagerQueue(ORG()) }; }

  @Get("finding") @ReturnedType(FindingResponse) @Description("Get finding detail")
  async finding(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const f = await getFinding(ORG(), findingId);
    return f ?? { error: "not found" };
  }

  @Post("remediate") @ReturnedType(OkResponse) @Description("Submit failure remediation") @BodyType(RemediateRequest)
  async remediate(@Body() body: { findingId: string; notes: string; username: string }) {
    if (!body.findingId || !body.notes || !body.username) return { error: "findingId, notes, username required" };
    return submitRemediation(ORG(), body.findingId, body.notes, body.username);
  }

  @Get("stats") @ReturnedType(ManagerStatsResponse) @Description("Manager queue statistics")
  async stats() { return getManagerStats(ORG()); }

  // /manager/api/me and /manager/api/game-state are dispatched directly from
  // main.ts (AUTH_CONTEXT_HANDLERS) — they need the session cookie and danet's
  // @Req doesn't work via router.fetch. Same pattern as /admin/api/me.

  @Get("agents") @ReturnedType(AgentListResponse) @Description("List team agents")
  async listAgents() { return { agents: await listUsers(ORG(), "user") }; }

  @Post("agents") @ReturnedType(OkResponse) @BodyType(CreateAgentRequest)
  async createAgent(@Body() body: { email: string; password: string; supervisor?: string }) {
    if (!body.email || !body.password) return { error: "email, password required" };
    await createUser(ORG(), body.email, body.password, "user", body.supervisor);
    return { ok: true };
  }

  @Post("agents/delete") @ReturnedType(OkResponse) @Description("Delete agent account") @BodyType(DeleteEmailRequest)
  async deleteAgent(@Body() body: { email: string }) {
    if (!body.email) return { error: "email required" };
    await deleteUser(ORG(), body.email);
    return { ok: true };
  }

  @Post("backfill") @ReturnedType(OkMessageResponse) @Description("Backfill manager queue")
  async backfill() { const { backfillManagerQueueLegacy } = await import("@manager/domain/data/manager-repository/mod.ts"); await backfillManagerQueueLegacy(ORG()); return { ok: true }; }

  @Get("prefab-subscriptions") @ReturnedType(OkResponse) @Description("Get prefab subscriptions")
  async getPrefabs() { return getPrefabSubscriptions(ORG()); }

  @Post("prefab-subscriptions") @ReturnedType(OkResponse) @Description("Save prefab subscriptions") @BodyType(PrefabSubscriptionsRequest)
  async savePrefabs(@Body() body: Record<string, boolean>) {
    await savePrefabSubscriptions(ORG(), body);
    return { ok: true };
  }
}
