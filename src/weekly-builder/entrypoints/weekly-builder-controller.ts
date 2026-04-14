/** Weekly report builder controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType } from "jsr:@danet/swagger@2/decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { listEmailReportConfigs } from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Weekly Builder — schedule and publish weekly email reports")
@Controller("admin/weekly-builder")
export class WeeklyBuilderController {

  @Get("data") @ReturnedType(WeeklyDataResponse)
  async getData() {
    const configs = await listEmailReportConfigs(ORG());
    const weekly = configs.filter((c) => c.weeklyType);
    return { reports: weekly, schedules: weekly.map((c) => ({ id: c.id, name: c.name, schedule: c.schedule })) };
  }

  @Post("publish") @ReturnedType(OkMessageResponse)
  async publish(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }

  @Post("test-send") @ReturnedType(OkMessageResponse)
  async testSend(@Body() body: GenericBodyRequest) { return { ok: true, message: "Not yet implemented" }; }
}
