/** Email report config CRUD controller — wired to real repo. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "jsr:@danet/swagger@2/decorators";
import { ChargebackReportResponse, WireReportResponse, OkResponse, OkMessageResponse, EmailConfigListResponse, EmailPreviewResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import * as repo from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Email Reports — CRUD for scheduled email report configurations")
@Controller("admin/email-reports")
export class EmailReportController {

  @Get("") @ReturnedType(EmailConfigListResponse)
  async list() { return { configs: await repo.listEmailReportConfigs(ORG()) }; }

  @Post("") @ReturnedType(OkResponse)
  async save(@Body() body: GenericBodyRequest) {
    const config = await repo.saveEmailReportConfig(ORG(), body as any);
    return { ok: true, config };
  }

  @Post("delete") @ReturnedType(OkResponse)
  async doDelete(@Body() body: { id: string }) {
    await repo.deleteEmailReportConfig(ORG(), body.id);
    return { ok: true };
  }

  @Post("preview") @ReturnedType(EmailPreviewResponse)
  async preview(@Body() body: GenericBodyRequest) {
    // TODO: wire to report engine for rendering
    return { html: "", message: "preview rendering pending report engine port" };
  }

  @Post("preview-inline") @ReturnedType(EmailPreviewResponse)
  async previewInline(@Body() body: GenericBodyRequest) { return { html: "" }; }

  @Get("preview-view") @ReturnedType(EmailPreviewResponse)
  async previewView(@Query("configId") configId: string) {
    const preview = await repo.getEmailReportPreview(ORG(), configId);
    return preview ?? { html: "" };
  }

  @Post("send-now") @ReturnedType(OkMessageResponse)
  async sendNow(@Body() body: { id: string }) {
    // TODO: wire to runReport from report engine
    return { ok: true, message: "send-now pending report engine port" };
  }
}
