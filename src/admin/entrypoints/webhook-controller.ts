/** Webhook receiver + email template controller — wired to real repos. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { fireWebhook } from "@admin/domain/data/admin-repository/mod.ts";
import * as emailRepo from "@reporting/domain/data/email-repository/mod.ts";

const ORG = () => "default";

@SwaggerDescription("Webhooks & Email Templates — inbound webhook handlers and template CRUD")
@Controller("")
export class WebhookController {

  @Post("webhooks/audit-complete")
  async auditComplete(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "terminate", body);
    return { ok: true };
  }

  @Post("webhooks/appeal-filed")
  async appealFiled(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "appeal", body);
    return { ok: true };
  }

  @Post("webhooks/appeal-decided")
  async appealDecided(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "judge", body);
    return { ok: true };
  }

  @Post("webhooks/manager-review")
  async managerReview(@Body() body: Record<string, any>) {
    await fireWebhook(ORG(), "manager", body);
    return { ok: true };
  }

  @Get("admin/email-templates")
  async listTemplates() { return { templates: await emailRepo.listEmailTemplates(ORG()) }; }

  @Get("admin/email-templates/get")
  async getTemplate(@Query("id") id: string) {
    return { template: await emailRepo.getEmailTemplate(ORG(), id) };
  }

  @Post("admin/email-templates")
  async saveTemplate(@Body() body: Record<string, any>) {
    const template = await emailRepo.saveEmailTemplate(ORG(), body as any);
    return { ok: true, template };
  }

  @Post("admin/email-templates/delete")
  async deleteTemplate(@Body() body: { id: string }) {
    await emailRepo.deleteEmailTemplate(ORG(), body.id);
    return { ok: true };
  }
}
