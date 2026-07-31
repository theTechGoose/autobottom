/** Email report config CRUD controller — wired to real repo. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType, Description } from "#danet/swagger-decorators";
import { ChargebackReportResponse, WireReportResponse, OkResponse, OkMessageResponse, EmailConfigListResponse, EmailPreviewResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest, IdRequest } from "@core/dto/requests.ts";
import * as repo from "@reporting/domain/data/email-repository/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

/** Soft-fallback helper — same pattern as the review/judge controllers.
 *  Catches FS aborts so a slow runQuery never propagates to the browser
 *  as a 500. The /admin/email-reports list endpoint was hitting the 60s
 *  foreground-lane timeout and 500ing the entire admin Email Reports tab. */
function softFail<T>(ctx: string, err: unknown, fallback: T): T {
  console.warn(`⚠️ [EMAIL-REPORTS] ${ctx} failed — soft fallback:`, err);
  return fallback;
}

@SwaggerDescription("Email Reports — CRUD for scheduled email report configurations")
@Controller("admin/email-reports")
export class EmailReportController {

  @Get("") @ReturnedType(EmailConfigListResponse)
  async list() {
    try { return { configs: await repo.listEmailReportConfigs(ORG()) }; }
    catch (err) { return softFail("list", err, { configs: [] }); }
  }

  @Post("") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async save(@Body() body: GenericBodyRequest) {
    try {
      const config = await repo.saveEmailReportConfig(ORG(), body as any);
      return { ok: true, config };
    } catch (err) {
      return softFail("save", err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  @Post("delete") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async doDelete(@Body() body: { id: string }) {
    try {
      await repo.deleteEmailReportConfig(ORG(), body.id);
      return { ok: true };
    } catch (err) {
      return softFail(`delete ${body.id}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  @Post("preview") @ReturnedType(EmailPreviewResponse) @BodyType(GenericBodyRequest)
  async preview(@Body() body: GenericBodyRequest) {
    const configId = (body as any).id ?? (body as any).configId;
    if (!configId) return { error: "id required" };
    try {
      const config = await repo.getEmailReportConfig(ORG(), configId);
      if (!config) return { error: "config not found" };
      const { queryReportData, renderReportEmailHtml } = await import("@reporting/domain/business/email-report-engine/mod.ts");
      const sections = await queryReportData(ORG(), config);
      const html = await renderReportEmailHtml(ORG(), config, sections);
      await repo.saveEmailReportPreview(ORG(), configId, html);
      return { html };
    } catch (err) {
      return softFail(`preview ${configId}`, err, { html: "", retry: true, error: "Server busy, please retry" });
    }
  }

  @Post("preview-inline") @ReturnedType(EmailPreviewResponse) @BodyType(GenericBodyRequest)
  async previewInline(@Body() body: GenericBodyRequest) {
    // Inline preview — render against the form's current state without
    // saving the config or stashing the HTML in the preview KV cache.
    const b = body as any;
    const config = {
      id: b.id ?? "preview-inline",
      name: b.name ?? "Preview",
      recipients: Array.isArray(b.recipients) ? b.recipients : [],
      cc: Array.isArray(b.cc) ? b.cc : undefined,
      bcc: Array.isArray(b.bcc) ? b.bcc : undefined,
      reportSections: Array.isArray(b.reportSections) ? b.reportSections : [],
      topLevelFilters: Array.isArray(b.topLevelFilters) ? b.topLevelFilters : undefined,
      dateRange: b.dateRange ?? undefined,
      onlyCompleted: b.onlyCompleted ?? true,
      failedOnly: b.failedOnly ?? undefined,
      weeklyType: b.weeklyType ?? undefined,
      templateId: b.templateId ?? undefined,
    };
    try {
      const { queryReportData, renderReportEmailHtml } = await import("@reporting/domain/business/email-report-engine/mod.ts");
      const sections = await queryReportData(ORG(), config as any);
      const html = await renderReportEmailHtml(ORG(), config as any, sections);
      return { html };
    } catch (err) {
      return softFail("previewInline", err, { html: "", retry: true, error: "Server busy, please retry" });
    }
  }

  @Get("preview-view") @ReturnedType(EmailPreviewResponse)
  async previewView(@Query("configId") configId: string) {
    try {
      const preview = await repo.getEmailReportPreview(ORG(), configId);
      return preview ?? { html: "" };
    } catch (err) {
      return softFail(`previewView ${configId}`, err, { html: "" });
    }
  }

  @Post("send-now") @ReturnedType(OkResponse) @BodyType(IdRequest)
  async sendNow(@Body() body: { id: string }) {
    if (!body.id) return { error: "id required" };
    try {
      const config = await repo.getEmailReportConfig(ORG(), body.id);
      if (!config) return { error: "config not found" };
      const { runReport } = await import("@reporting/domain/business/email-report-engine/mod.ts");
      await runReport(ORG(), config as any);
      return { ok: true };
    } catch (err) {
      return softFail(`sendNow ${body.id}`, err, { ok: false, retry: true, error: "Server busy, please retry" });
    }
  }

  /** Last-run status for a single config — backs the editor's status badge.
   *  Lives in a separate Firestore doc (`email-report-status`) written only
   *  by the cron tick, so the editor can read it without racing operator
   *  saves of the parent config. Returns `null` shape if never run. */
  @Get("status") @ReturnedType(MessageResponse)
  async status(@Query("configId") configId: string) {
    if (!configId) return { error: "configId required" };
    try {
      const { getStored } = await import("@core/data/firestore/mod.ts");
      const s = await getStored<Record<string, unknown>>("email-report-status", ORG(), configId);
      return s ?? {};
    } catch (err) {
      return softFail(`status ${configId}`, err, {});
    }
  }

  /** Kill-switch read — the cron tick reads this with a 60s in-isolate cache.
   *  Returns { enabled: true } if the flag is missing (safe default). */
  @Get("killswitch") @ReturnedType(MessageResponse)
  async killswitchGet() {
    try {
      const { getStored } = await import("@core/data/firestore/mod.ts");
      const flag = await getStored<{ enabled?: boolean }>("system-flag", "" as any, "email-reports-enabled");
      return { enabled: flag?.enabled !== false };
    } catch (err) {
      return softFail("killswitch get", err, { enabled: true });
    }
  }

  /** Kill-switch flip — operator sets `enabled` true/false. The new value
   *  propagates to every isolate within ≤60s (the cron tick's cache TTL). */
  @Post("killswitch") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  async killswitchSet(@Body() body: GenericBodyRequest) {
    const b = (body ?? {}) as { enabled?: boolean };
    const enabled = b.enabled === true;
    try {
      const { setStored } = await import("@core/data/firestore/mod.ts");
      await setStored("system-flag", "" as any, ["email-reports-enabled"], { enabled });
      // Invalidate the local isolate's cache so the same operator's next
      // read reflects the change without waiting for TTL expiry.
      const { _resetKillSwitchCacheForTests } = await import("@reporting/domain/business/email-reports-tick/mod.ts");
      _resetKillSwitchCacheForTests();
      console.log(`🛑 [EMAIL-REPORT] killswitch set enabled=${enabled} by admin`);
      return { ok: true, enabled };
    } catch (err) {
      return softFail("killswitch set", err, { ok: false, error: "Server busy, please retry" });
    }
  }

  /** Bulk status lookup — returns { [configId]: EmailReportStatus } for every
   *  status doc belonging to this org. Used by the list view to render
   *  per-row "last ran" pills without N round-trips. */
  @Get("all-status") @ReturnedType(MessageResponse)
  async allStatus() {
    try {
      const { listStoredWithKeys } = await import("@core/data/firestore/mod.ts");
      const rows = await listStoredWithKeys<Record<string, unknown>>("email-report-status", ORG());
      const out: Record<string, Record<string, unknown>> = {};
      for (const { value } of rows) {
        const cid = value?.configId as string | undefined;
        if (cid) out[cid] = value;
      }
      return { statuses: out };
    } catch (err) {
      return softFail("allStatus", err, { statuses: {} });
    }
  }
}
