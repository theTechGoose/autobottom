/** Weekly report builder controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, QLConfigListResponse, QLConfigResponse, QLQuestionResponse, QLQuestionNamesResponse, BulkUpdateResponse, QLAssignmentsResponse, SoundPackListResponse, GamificationSettingsResponse, StoreItemListResponse, PurchaseResponse, BadgeListResponse, UnreadCountResponse, ConversationListResponse, UserListResponse, MessageSentResponse, EventsResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import { listEmailReportConfigs } from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/org-resolver.ts";
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

  @Post("publish") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async publish(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.id) return { error: "report config id required" };
    const { getEmailReportConfig } = await import("../../reporting/domain/data/email-repository/mod.ts");
    const config = await getEmailReportConfig(ORG(), b.id);
    if (!config) return { error: "config not found" };
    const { runReport } = await import("../../reporting/domain/business/email-report-engine/mod.ts");
    await runReport(ORG(), config as any);
    return { ok: true };
  }

  @Post("test-send") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async testSend(@Body() body: GenericBodyRequest) {
    const b = body as any;
    if (!b.id) return { error: "report config id required" };
    const { getEmailReportConfig } = await import("../../reporting/domain/data/email-repository/mod.ts");
    const config = await getEmailReportConfig(ORG(), b.id);
    if (!config) return { error: "config not found" };
    const testConfig = { ...config, recipients: b.recipients ?? config.recipients };
    const { runReport } = await import("../../reporting/domain/business/email-report-engine/mod.ts");
    await runReport(ORG(), testConfig as any);
    return { ok: true };
  }
}
