/** Email report config CRUD controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Email Reports — CRUD for scheduled email report configurations")
@Controller("admin/email-reports")
export class EmailReportController {

  @Get("")
  async list() { return { configs: [] }; }

  @Post("")
  async save(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("delete")
  async delete(@Body() body: { id: string }) { return { ok: true }; }

  @Post("preview")
  async preview(@Body() body: Record<string, any>) { return { html: "" }; }

  @Post("preview-inline")
  async previewInline(@Body() body: Record<string, any>) { return { html: "" }; }

  @Get("preview-view")
  async previewView(@Query("configId") configId: string) { return { html: "" }; }

  @Post("send-now")
  async sendNow(@Body() body: { id: string }) { return { ok: true }; }
}
