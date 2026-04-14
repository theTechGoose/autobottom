/** Email report config CRUD controller — wired to real repo. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { ChargebackReportResponse, WireReportResponse, OkResponse, OkMessageResponse, EmailConfigListResponse, EmailPreviewResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, IdRequest } from "@core/dto/requests.ts";
import * as repo from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Email Reports — CRUD for scheduled email report configurations")
@Controller("admin/email-reports")
export class EmailReportController {

  @Get("") @ReturnedType(EmailConfigListResponse)
  async list() { return { configs: await repo.listEmailReportConfigs(ORG()) }; }

  @Post("") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async save(@Body() body: GenericBodyRequest) {
    const config = await repo.saveEmailReportConfig(ORG(), body as any);
    return { ok: true, config };
  }

  @Post("delete") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async doDelete(@Body() body: { id: string }) {
    await repo.deleteEmailReportConfig(ORG(), body.id);
    return { ok: true };
  }

  @Post("preview") @ReturnedType(EmailPreviewResponse) @BodyType(GenericBodyRequest)
  async preview(@Body() body: GenericBodyRequest) {
    const configId = (body as any).id ?? (body as any).configId;
    if (!configId) return { error: "id required" };
    const config = await repo.getEmailReportConfig(ORG(), configId);
    if (!config) return { error: "config not found" };
    const { queryReportData, renderSections, renderFullEmail } = await import("@reporting/domain/business/email-report-engine/mod.ts");
    const sections = await queryReportData(ORG(), config);
    const html = renderFullEmail(null, renderSections(sections), config.name);
    await repo.saveEmailReportPreview(ORG(), configId, html);
    return { html };
  }

  @Post("preview-inline") @ReturnedType(EmailPreviewResponse) @BodyType(GenericBodyRequest)
  async previewInline(@Body() body: GenericBodyRequest) { return { html: "" }; }

  @Get("preview-view") @ReturnedType(EmailPreviewResponse)
  async previewView(@Query("configId") configId: string) {
    const preview = await repo.getEmailReportPreview(ORG(), configId);
    return preview ?? { html: "" };
  }

  @Post("send-now") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async sendNow(@Body() body: { id: string }) {
    if (!body.id) return { error: "id required" };
    const config = await repo.getEmailReportConfig(ORG(), body.id);
    if (!config) return { error: "config not found" };
    const { runReport } = await import("@reporting/domain/business/email-report-engine/mod.ts");
    await runReport(ORG(), config as any);
    return { ok: true };
  }
}
