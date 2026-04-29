/** Weekly report builder controller — ports prod main:weekly-builder/handlers.ts.
 *  Three endpoints:
 *    GET  /admin/weekly-builder/data       returns the dept/shift tree, partner offices,
 *                                           bypass config + existing weekly configs so the
 *                                           UI can build trees and skip already-published
 *                                           items.
 *    POST /admin/weekly-builder/test-send  builds an ephemeral EmailReportConfig per
 *                                           staged item and sends to a single test address.
 *    POST /admin/weekly-builder/publish    persists one EmailReportConfig per staged item
 *                                           with auto-derived recipients (manager scopes
 *                                           or partner offices). Skips existing matches. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, BodyType } from "#danet/swagger-decorators";
import { OkResponse, WeeklyDataResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import {
  listEmailReportConfigs, saveEmailReportConfig,
} from "@reporting/domain/data/email-repository/mod.ts";
import {
  getPartnerDimensions, listManagerScopes, getOfficeBypassConfig, getAuditDimensions,
} from "@admin/domain/data/admin-repository/mod.ts";
import type { EmailReportConfig } from "@core/dto/types.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

interface StagedConfig {
  type: "internal" | "partner";
  department?: string;
  office?: string;
  shift?: string | null;
  name: string;
}

function buildTopLevelFilters(staged: StagedConfig) {
  const filters: { field: string; operator: string; value: string }[] = [];
  if (staged.type === "internal") {
    filters.push({ field: "auditType", operator: "equals", value: "internal" });
    if (staged.department) filters.push({ field: "department", operator: "equals", value: staged.department });
    if (staged.shift) filters.push({ field: "shift", operator: "equals", value: staged.shift });
  } else {
    filters.push({ field: "auditType", operator: "equals", value: "partner" });
    if (staged.office) filters.push({ field: "department", operator: "equals", value: staged.office });
  }
  filters.push({ field: "appealStatus", operator: "not_equals", value: "pending" });
  return filters;
}

function buildEphemeralConfig(staged: StagedConfig, recipients: string[]): EmailReportConfig {
  return {
    id: crypto.randomUUID(),
    name: staged.name,
    weeklyType: staged.type,
    dateRange: { mode: "weekly", startDay: 1 },
    onlyCompleted: true,
    schedule: { cron: "0 1 * * *" },
    reportSections: [{
      header: staged.name,
      columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"],
      criteria: [],
    }],
    recipients,
    // topLevelFilters is read by report-engine via (config as any).topLevelFilters
    ...(buildTopLevelFilters(staged).length > 0 ? { topLevelFilters: buildTopLevelFilters(staged) } : {}),
  } as unknown as EmailReportConfig;
}

function isDuplicate(staged: StagedConfig, existing: EmailReportConfig[]): boolean {
  return existing.some((c: any) => {
    if (!c.weeklyType) return false;
    if (staged.type === "internal") {
      return c.weeklyType === "internal" &&
        c.weeklyDepartment === staged.department &&
        (c.weeklyShift ?? null) === (staged.shift ?? null);
    }
    return c.weeklyType === "partner" && c.weeklyOffice === staged.office;
  });
}

@SwaggerDescription("Weekly Builder — schedule and publish weekly email reports")
@Controller("admin/weekly-builder")
export class WeeklyBuilderController {

  /** Returns everything the frontend needs to render the dept/office tree +
   *  highlight already-published items. */
  @Get("data") @ReturnedType(WeeklyDataResponse)
  async getData() {
    const org = ORG();
    const [partnerDims, managerScopes, bypassCfg, existingConfigs, auditDims] = await Promise.all([
      getPartnerDimensions(org),
      listManagerScopes(org),
      getOfficeBypassConfig(org),
      listEmailReportConfigs(org),
      getAuditDimensions(org),
    ]);
    return { partnerDims, managerScopes, bypassCfg, existingConfigs, auditDims };
  }

  /** Send an ephemeral report to a single test address — no persistence. */
  @Post("test-send") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async testSend(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const testEmail = String(b?.testEmail ?? "").trim();
    const configs = (b?.configs ?? []) as StagedConfig[];
    if (!testEmail) return { error: "testEmail required" };
    if (!Array.isArray(configs) || configs.length === 0) return { error: "no configs" };

    const { runReport } = await import("@reporting/domain/business/email-report-engine/mod.ts");
    const org = ORG();

    const results = await Promise.allSettled(
      configs.map((staged) => {
        const ephemeral = buildEphemeralConfig(staged, [testEmail]);
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout after 55s")), 55_000),
        );
        return Promise.race([runReport(org, ephemeral), timeout]);
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const errors = results
      .map((r, i) => r.status === "rejected"
        ? `${configs[i].name}: ${(r as PromiseRejectedResult).reason?.message ?? r.reason}`
        : null)
      .filter(Boolean) as string[];

    return { ok: true, sent, errors };
  }

  /** Persist one EmailReportConfig per staged item with auto-derived recipients. */
  @Post("publish") @ReturnedType(OkResponse) @BodyType(GenericBodyRequest)
  async publish(@Body() body: GenericBodyRequest) {
    const b = body as any;
    const configs = (b?.configs ?? []) as StagedConfig[];
    if (!Array.isArray(configs) || configs.length === 0) return { error: "no configs" };

    const org = ORG();
    const [partnerDims, managerScopes, existingConfigs] = await Promise.all([
      getPartnerDimensions(org),
      listManagerScopes(org),
      listEmailReportConfigs(org),
    ]);

    // Invert manager scopes: dept -> [emails]
    const deptEmails: Record<string, string[]> = {};
    for (const [email, scope] of Object.entries(managerScopes)) {
      for (const dept of (scope?.departments ?? [])) {
        if (!deptEmails[dept]) deptEmails[dept] = [];
        if (!deptEmails[dept].includes(email)) deptEmails[dept].push(email);
      }
    }

    let created = 0;
    const skipped: string[] = [];
    for (const staged of configs) {
      if (isDuplicate(staged, existingConfigs)) { skipped.push(staged.name); continue; }

      const recipients = staged.type === "internal"
        ? (deptEmails[staged.department ?? ""] ?? [])
        : ((partnerDims.offices ?? {})[staged.office ?? ""] ?? []);

      // Save with extra weekly-builder fields persisted alongside the canonical
      // EmailReportConfig shape. Matches prod's persistence layout.
      await saveEmailReportConfig(org, {
        name: staged.name,
        recipients,
        reportSections: [{
          header: staged.name,
          columns: ["finalizedAt", "voName", "department", "score", "recordId", "findingId"],
          criteria: [],
        }],
        dateRange: { mode: "weekly", startDay: 1 },
        onlyCompleted: true,
        weeklyType: staged.type,
        schedule: { cron: "0 1 * * *" },
        // Persist the staged metadata + filters so the cron + rerun knows what to filter.
        ...({
          weeklyDepartment: staged.department,
          weeklyShift: staged.shift ?? undefined,
          weeklyOffice: staged.office,
          topLevelFilters: buildTopLevelFilters(staged),
        } as any),
      } as any);

      created++;
    }

    return { ok: true, created, skipped };
  }
}
