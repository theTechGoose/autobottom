/** Webhook receiver + email template controller. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";

@SwaggerDescription("Webhooks & Email Templates — inbound webhook handlers and template CRUD")
@Controller("")
export class WebhookController {

  // -- Inbound webhooks --
  @Post("webhooks/audit-complete")
  async auditComplete(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("webhooks/appeal-filed")
  async appealFiled(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("webhooks/appeal-decided")
  async appealDecided(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("webhooks/manager-review")
  async managerReview(@Body() body: Record<string, any>) { return { ok: true }; }

  // -- Email templates --
  @Get("admin/email-templates")
  async listTemplates() { return { templates: [] }; }

  @Get("admin/email-templates/get")
  async getTemplate(@Query("id") id: string) { return { id, template: null }; }

  @Post("admin/email-templates")
  async saveTemplate(@Body() body: Record<string, any>) { return { ok: true }; }

  @Post("admin/email-templates/delete")
  async deleteTemplate(@Body() body: { id: string }) { return { ok: true }; }
}
