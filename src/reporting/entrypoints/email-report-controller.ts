/** Email report config CRUD controller — wired to real repo. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import * as repo from "@reporting/domain/data/email-repository/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Email Reports — CRUD for scheduled email report configurations")
@Controller("admin/email-reports")
export class EmailReportController {

  @Get("")
  async list() { return { configs: await repo.listEmailReportConfigs(ORG()) }; }

  @Post("")
  async save(@Body() body: Record<string, any>) {
    const config = await repo.saveEmailReportConfig(ORG(), body as any);
    return { ok: true, config };
  }

  @Post("delete")
  async doDelete(@Body() body: { id: string }) {
    await repo.deleteEmailReportConfig(ORG(), body.id);
    return { ok: true };
  }

  @Post("preview")
  async preview(@Body() body: Record<string, any>) {
    // TODO: wire to report engine for rendering
    return { html: "", message: "preview rendering pending report engine port" };
  }

  @Post("preview-inline")
  async previewInline(@Body() body: Record<string, any>) { return { html: "" }; }

  @Get("preview-view")
  async previewView(@Query("configId") configId: string) {
    const preview = await repo.getEmailReportPreview(ORG(), configId);
    return preview ?? { html: "" };
  }

  @Post("send-now")
  async sendNow(@Body() body: { id: string }) {
    // TODO: wire to runReport from report engine
    return { ok: true, message: "send-now pending report engine port" };
  }
}
