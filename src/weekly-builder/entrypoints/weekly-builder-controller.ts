/** Weekly report builder controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Weekly Builder — schedule and publish weekly email reports")
@Controller("admin/weekly-builder")
export class WeeklyBuilderController {

  @Get("data")
  async getData() { return { reports: [], schedules: [] }; }

  @Post("publish")
  async publish(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("test-send")
  async testSend(@Body() body: Record<string, any>) { return { ok: true }; }
}
