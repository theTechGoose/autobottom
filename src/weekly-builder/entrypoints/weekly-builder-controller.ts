/** Weekly report builder controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { listEmailReportConfigs } from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Weekly Builder — schedule and publish weekly email reports")
@Controller("admin/weekly-builder")
export class WeeklyBuilderController {

  @Get("data")
  async getData() {
    const configs = await listEmailReportConfigs(ORG());
    const weekly = configs.filter((c) => c.weeklyType);
    return { reports: weekly, schedules: weekly.map((c) => ({ id: c.id, name: c.name, schedule: c.schedule })) };
  }

  @Post("publish")
  async publish(@Body() body: Record<string, any>) { return { ok: true, message: "publish pending report engine wiring" }; }

  @Post("test-send")
  async testSend(@Body() body: Record<string, any>) { return { ok: true, message: "test-send pending report engine wiring" }; }
}
