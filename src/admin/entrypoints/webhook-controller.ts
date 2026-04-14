/** Webhook receiver + email template controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "jsr:@danet/swagger@2/decorators";
import { OkResponse, OkMessageResponse, MessageResponse, UserListResponse, EmailTemplateListResponse, DashboardDataResponse, AuditsDataResponse, ReviewStatsResponse } from "@core/dto/responses.ts";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import * as emailRepo from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/domain/business/auth/org-resolver.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Webhooks & Email Templates — inbound webhook handlers and template CRUD")
@Controller("")
export class WebhookController {

  @Post("webhooks/audit-complete") @ReturnedType(OkResponse)
  async auditComplete(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "terminate", body);
    return { ok: true };
  }

  @Post("webhooks/appeal-filed") @ReturnedType(OkResponse)
  async appealFiled(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "appeal", body);
    return { ok: true };
  }

  @Post("webhooks/appeal-decided") @ReturnedType(OkResponse)
  async appealDecided(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "judge", body);
    return { ok: true };
  }

  @Post("webhooks/manager-review") @ReturnedType(OkResponse)
  async managerReview(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "manager", body);
    return { ok: true };
  }

  @Get("admin/email-templates") @ReturnedType(EmailTemplateListResponse)
  async listTemplates() { return { templates: await emailRepo.listEmailTemplates(ORG()) }; }

  @Get("admin/email-templates/get") @ReturnedType(OkResponse)
  async getTemplate(@Query("id") id: string) {
    return { template: await emailRepo.getEmailTemplate(ORG(), id) };
  }

  @Post("admin/email-templates") @ReturnedType(OkResponse)
  async saveTemplate(@Body() body: Record<string, any>) {
    const template = await emailRepo.saveEmailTemplate(ORG(), body as any);
    return { ok: true, template };
  }

  @Post("admin/email-templates/delete") @ReturnedType(OkResponse)
  async deleteTemplate(@Body() body: { id: string }) {
    await emailRepo.deleteEmailTemplate(ORG(), body.id);
    return { ok: true };
  }
}
