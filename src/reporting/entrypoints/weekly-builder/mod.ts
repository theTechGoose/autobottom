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
import { queryAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

import { defaultOrgId, listUsers } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

/** Manager scopes with super-managers (the president role) removed, so the
 *  Weekly Builder never auto-adds an all-departments super-manager to every
 *  department's report. Their address can still be added deliberately via the
 *  global "every report" field on the page. */
async function managerScopesNoSuper(org: OrgId): Promise<Awaited<ReturnType<typeof listManagerScopes>>> {
  const [scopes, supers] = await Promise.all([
    listManagerScopes(org),
    listUsers(org, "super-manager"),
  ]);
  const superEmails = new Set(supers.map((u) => u.email.toLowerCase()));
  const out: Awaited<ReturnType<typeof listManagerScopes>> = {};
  for (const [email, scope] of Object.entries(scopes)) {
    if (!superEmails.has(email.toLowerCase())) out[email] = scope;
  }
  return out;
}

const COVERAGE_WINDOW_DAYS = 60;

/** Derive which shifts each department actually runs, straight from the audit
 *  index (department + shift are ON the index entry — NO per-finding hydration,
 *  which is the read pattern that previously wedged prod). The window is
 *  day-rounded so queryAuditDoneIndex's SWR cache key is stable (one cold scan
 *  per day). Soft-fails to {} so a slow/failed read never breaks the page — the
 *  UI then just offers all shifts as before. */
async function computeDeptShifts(org: OrgId): Promise<Record<string, string[]>> {
  try {
    const day = 86_400_000;
    const to = Math.floor(Date.now() / day) * day;
    const from = to - COVERAGE_WINDOW_DAYS * day;
    const entries = await queryAuditDoneIndex(org, from, to);
    const map: Record<string, Set<string>> = {};
    for (const e of entries) {
      if (!e.department || !e.shift) continue;
      (map[e.department] ??= new Set<string>()).add(e.shift);
    }
    const out: Record<string, string[]> = {};
    for (const [dept, shifts] of Object.entries(map)) out[dept] = [...shifts].sort();
    return out;
  } catch (err) {
    console.warn("⚠️ [weekly-builder] deptShifts coverage failed — UI falls back to all shifts:", err);
    return {};
  }
}

interface StagedConfig {
  type: "internal" | "partner";
  department?: string;
  office?: string;
  shift?: string | null;
  config: EmailReportConfig;
}

// The staged config — including any per-report customizations made in the
// staging editor (recipients, sections, schedule, filters) — is built
// client-side and sent whole. The controller below just dedupes and persists
// it; there is no server-side config construction anymore.

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

const WEEKLY_TZ = "America/New_York";
const WEEKLY_BASE_HOUR = 21;       // 9:00 PM Eastern (21:00) — the global base send time
const WEEKLY_STAGGER_MINUTES = 10; // each report fires 10 min after the previous
const DEFAULT_WEEKLY_CRON = `0 ${WEEKLY_BASE_HOUR} * * *`;

/** Cron for the Nth staggered weekly slot: slot 0 = 9:00, 1 = 9:10, … rolling
 *  into later hours. Spreads sends so the every-minute tick handles ~1 report
 *  per slot instead of a 9 PM pile-up. */
function staggeredWeeklyCron(slotIndex: number): string {
  const total = WEEKLY_BASE_HOUR * 60 + slotIndex * WEEKLY_STAGGER_MINUTES;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${mm} ${hh} * * *`;
}

@SwaggerDescription("Weekly Builder — schedule and publish weekly email reports")
@Controller("admin/weekly-builder")
export class WeeklyBuilderController {

  /** Returns everything the frontend needs to render the dept/office tree +
   *  highlight already-published items. */
  @Get("data") @ReturnedType(WeeklyDataResponse)
  async getData() {
    const org = ORG();
    const [partnerDims, managerScopes, bypassCfg, existingConfigs, auditDims, deptShifts] = await Promise.all([
      getPartnerDimensions(org),
      managerScopesNoSuper(org),
      getOfficeBypassConfig(org),
      listEmailReportConfigs(org),
      getAuditDimensions(org),
      computeDeptShifts(org),
    ]);
    return { partnerDims, managerScopes, bypassCfg, existingConfigs, auditDims, deptShifts };
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
        const cfg = { ...staged.config, recipients: [testEmail] } as EmailReportConfig;
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout after 55s")), 55_000),
        );
        return Promise.race([runReport(org, cfg), timeout]);
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const errors = results
      .map((r, i) => r.status === "rejected"
        ? `${configs[i].config?.name ?? "report"}: ${(r as PromiseRejectedResult).reason?.message ?? r.reason}`
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
      managerScopesNoSuper(org),
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

    // Stagger send times so reports don't all fire in the same minute. New
    // reports continue from however many weekly reports already exist (10 min
    // apart off the 9 PM base). A report keeps its own time if it was given a
    // custom one in the editor — i.e. its cron differs from the default.
    let slot = (existingConfigs as Array<{ weeklyType?: string }>).filter((c) => c.weeklyType).length;
    let created = 0;
    const skipped: string[] = [];
    for (const staged of configs) {
      if (isDuplicate(staged, existingConfigs)) { skipped.push(staged.config?.name ?? ""); continue; }

      const cfg = staged.config;
      // Fall back to manager-scope / office recipients and weekly defaults only
      // when the client left a field empty; otherwise persist the customized
      // config as-is (sections, filters, recipients all come through).
      const fallbackRecipients = staged.type === "internal"
        ? (deptEmails[staged.department ?? ""] ?? [])
        : ((partnerDims.offices ?? {})[staged.office ?? ""] ?? []);

      const isCustomTime = !!cfg.schedule?.cron && cfg.schedule.cron !== DEFAULT_WEEKLY_CRON;
      const schedule = isCustomTime ? cfg.schedule! : { cron: staggeredWeeklyCron(slot++), tz: WEEKLY_TZ };

      await saveEmailReportConfig(org, {
        ...cfg,
        recipients: cfg.recipients?.length ? cfg.recipients : fallbackRecipients,
        weeklyType: cfg.weeklyType ?? staged.type,
        enabled: cfg.enabled ?? true,
        schedule,
        ...({
          weeklyDepartment: cfg.weeklyDepartment ?? staged.department,
          weeklyShift: cfg.weeklyShift ?? (staged.shift ?? undefined),
          weeklyOffice: cfg.weeklyOffice ?? staged.office,
        } as any),
      } as any);

      created++;
    }

    return { ok: true, created, skipped };
  }
}
