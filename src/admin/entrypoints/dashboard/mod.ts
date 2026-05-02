/** Admin dashboard data controller — wired to stats + review repos.
 *  NOTE on orgId: danet's @Req decorator does NOT work when the controller is
 *  reached via router.fetch() (the pattern used by our unified main.ts entry).
 *  So we resolve orgId via defaultOrgId() which reads env (DEFAULT_ORG_ID /
 *  CHARGEBACKS_ORG_ID). The audit controller uses the same mechanism so both
 *  agree on which org's data to read/write. For true multi-org we'd need to
 *  migrate main.ts to bypass routes that need per-request org context. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description } from "#danet/swagger-decorators";
import { OkResponse, OkMessageResponse, MessageResponse, UserListResponse, EmailTemplateListResponse, DashboardDataResponse, AuditsDataResponse, ReviewStatsResponse } from "@core/dto/responses.ts";
import { getStats, getRecentCompleted, queryAuditDoneIndex, findAuditsByRecordId } from "@audit/domain/data/stats-repository/mod.ts";
import { getReviewStats, getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
import { isPipelinePaused } from "@admin/domain/data/admin-repository/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Dashboard — admin analytics data, audit history, review queue data")
@Controller("admin")
export class DashboardController {

  @Get("dashboard/data") @ReturnedType(DashboardDataResponse)
  async dashboardData() {
    const orgId = ORG();
    console.log(`📊 [DASH] dashboard/data orgId=${orgId}`);
    const [pipelineStats, reviewStats, recent, paused] = await Promise.all([
      getStats(orgId),
      getReviewStats(orgId),
      getRecentCompleted(orgId, 25),
      isPipelinePaused(orgId),
    ]);
    return { pipeline: { ...pipelineStats, paused }, review: reviewStats, recentCompleted: recent };
  }

  @Get("dashboard/section") @ReturnedType(OkResponse)
  async dashboardSection(@Query("section") section: string) {
    if (section === "pipeline") return getStats(ORG());
    if (section === "review") return getReviewStats(ORG());
    return { section, data: [] };
  }

  /** Audit history data — supports filtering, pagination, and CSV export.
   *  Mirrors prod's /admin/audits/data shape (main:main.ts:730).
   *  When format=csv, returns text/csv with all filtered rows (no pagination). */
  @Get("audits/data") @ReturnedType(AuditsDataResponse)
  async auditsData(
    @Query("since") since: string,
    @Query("until") until: string,
    @Query("type") type: string,
    @Query("owner") owner: string,
    @Query("department") department: string,
    @Query("shift") shift: string,
    @Query("reviewed") reviewed: string,
    @Query("auditor") auditor: string,
    @Query("scoreMin") scoreMin: string,
    @Query("scoreMax") scoreMax: string,
    @Query("page") page: string,
    @Query("limit") limit: string,
    @Query("format") format: string,
  ) {
    const orgId = ORG();
    const s = parseInt(since || "0", 10) || 0;
    const u = parseInt(until || String(Date.now()), 10) || Date.now();
    const t = type || "all";
    const sMin = Math.max(0, Math.min(100, parseInt(scoreMin || "0", 10) || 0));
    const sMax = Math.max(0, Math.min(100, parseInt(scoreMax || "100", 10) || 100));
    const pg = Math.max(1, parseInt(page || "1", 10) || 1);
    const lim = Math.min(100, Math.max(10, parseInt(limit || "50", 10) || 50));

    const [indexEntries, reviewedIds] = await Promise.all([
      queryAuditDoneIndex(orgId, s, u),
      getReviewedFindingIds(orgId),
    ]);

    type AuditRow = AuditDoneIndexEntry & { ts: number };
    const windowEntries: AuditRow[] = indexEntries
      .map((e) => ({ ...e, ts: e.completedAt }))
      .sort((a, b) => b.ts - a.ts);

    const matchesBase = (c: AuditRow) => {
      if (t === "date-leg" && c.isPackage) return false;
      if (t === "package" && !c.isPackage) return false;
      if (c.score != null && (c.score < sMin || c.score > sMax)) return false;
      return true;
    };

    const filtered = windowEntries.filter((c) => {
      if (!matchesBase(c)) return false;
      if (owner && (c.voName || c.owner) !== owner) return false;
      if (department && c.department !== department) return false;
      if (shift && c.shift !== shift) return false;
      if (auditor && c.reviewedBy !== auditor) return false;
      if (reviewed === "yes" && !reviewedIds.has(c.findingId)) return false;
      if (reviewed === "no" && (reviewedIds.has(c.findingId) || c.reason === "perfect_score" || c.reason === "invalid_genie")) return false;
      if (reviewed === "auto" && c.reason !== "perfect_score" && c.reason !== "invalid_genie") return false;
      if (reviewed === "invalid_genie" && c.reason !== "invalid_genie") return false;
      return true;
    });

    // Cross-filtered dropdown options: each dimension excludes its own filter
    // so user always sees what's still valid given the OTHER active filters.
    const owners = [...new Set(
      windowEntries.filter((c) => matchesBase(c) && (!department || c.department === department) && (!shift || c.shift === shift))
        .map((c) => c.voName || c.owner).filter(Boolean),
    )].sort() as string[];
    const departments = [...new Set(
      windowEntries.filter((c) => matchesBase(c) && (!owner || (c.voName || c.owner) === owner) && (!shift || c.shift === shift))
        .map((c) => c.department).filter(Boolean),
    )].sort() as string[];
    const shifts = [...new Set(
      windowEntries.filter((c) => matchesBase(c) && (!owner || (c.voName || c.owner) === owner) && (!department || c.department === department))
        .map((c) => c.shift).filter(Boolean),
    )].sort() as string[];
    const reviewers = [...new Set(
      windowEntries.map((c) => c.reviewedBy).filter(Boolean),
    )].sort() as string[];

    // Hydrate missing extended fields from finding doc — page items only.
    // Old audit-done-idx entries lacked voName/owner/department/shift; the
    // current writer fills them in but historical data needs the lookup.
    async function hydrateMissing(rows: AuditRow[]): Promise<AuditRow[]> {
      const needs = rows.filter((r) => r.voName === undefined && r.owner === undefined);
      if (needs.length === 0) return rows;
      const findings = await Promise.all(needs.map((r) => getFinding(orgId, r.findingId)));
      const findingMap = new Map<string, Record<string, unknown>>();
      findings.forEach((f, i) => { if (f) findingMap.set(needs[i].findingId, f); });
      return rows.map((r) => {
        if (r.voName !== undefined || r.owner !== undefined) return r;
        const f = findingMap.get(r.findingId);
        if (!f) return r;
        const rec = f.record as Record<string, unknown> | undefined;
        const isPkg = f.recordingIdField === "GenieNumber";
        const rawVo = String(rec?.VoName ?? "");
        const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
        return {
          ...r,
          isPackage: isPkg,
          voName: vo || undefined,
          owner: f.owner as string | undefined,
          department: String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? "")) || undefined,
          shift: isPkg ? undefined : (String(rec?.Shift ?? "") || undefined),
          startedAt: f.startedAt as number | undefined,
        };
      });
    }

    if (format === "csv") {
      const hydratedAll = await hydrateMissing(filtered);
      const appeals = await Promise.all(hydratedAll.map((c) => getAppeal(orgId, c.findingId)));
      const headers = ["Finding ID", "Record ID", "Type", "Team Member", "Auditor", "Score", "Started", "Finished", "Duration", "Reviewed", "Appeal Status"];
      const rows = [headers.join(",")];
      hydratedAll.forEach((c, i) => {
        const isReviewed = reviewedIds.has(c.findingId);
        const appealStatus = appeals[i] ? appeals[i]!.status : null;
        rows.push([
          c.findingId || "",
          c.recordId || "",
          c.isPackage ? "Partner" : "Internal",
          '"' + (c.voName || "").replace(/"/g, '""') + '"',
          '"' + (c.reviewedBy || c.owner || "api").replace(/"/g, '""') + '"',
          c.score != null ? c.score + "%" : "",
          c.startedAt ? new Date(c.startedAt).toISOString() : "",
          c.ts ? new Date(c.ts).toISOString() : "",
          c.durationMs ? Math.round(c.durationMs / 1000) + "s" : "",
          isReviewed ? "Reviewed" : (c.reason === "perfect_score" || c.reason === "invalid_genie" ? "Auto" : ""),
          appealStatus === "pending" ? "Pending" : (appealStatus === "complete" ? "Complete" : ""),
        ].join(","));
      });
      console.log(`📥 [AUDITS] CSV export ${hydratedAll.length} rows`);
      return new Response(rows.join("\n"), {
        headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=audit-history.csv" },
      });
    }

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / lim));
    const pageItems = filtered.slice((pg - 1) * lim, pg * lim);
    const hydratedPage = await hydrateMissing(pageItems);
    const appeals = await Promise.all(hydratedPage.map((c) => getAppeal(orgId, c.findingId)));
    const items = hydratedPage.map((c, i) => ({
      ...c,
      reviewed: reviewedIds.has(c.findingId),
      appealStatus: appeals[i] ? appeals[i]!.status : null,
    }));

    console.log(`🔍 [AUDITS] ${total}/${windowEntries.length} in window page=${pg}/${pages} type=${t} owner=${owner || "all"} dept=${department || "all"}`);
    return { items, total, pages, page: pg, owners, departments, shifts, reviewers };
  }

  @Get("review-queue/data") @ReturnedType(ReviewStatsResponse)
  async reviewQueueData() { return getReviewStats(ORG()); }

  @Get("delete-finding") @ReturnedType(OkMessageResponse)
  async deleteFinding(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    const { adminDeleteFindingLegacy } = await import("@judge/domain/data/judge-repository/mod.ts");
    await adminDeleteFindingLegacy(ORG(), findingId);
    return { ok: true, findingId };
  }

  @Get("audits-by-record") @ReturnedType(AuditsDataResponse)
  async auditsByRecord(@Query("recordId") recordId: string) {
    if (!recordId) return { error: "recordId required" };
    return { audits: await findAuditsByRecordId(ORG(), recordId) };
  }

  /** Debug: confirms the "step dispatch moved to main.ts" fix shipped. If the
   *  deployment serving THIS endpoint also has the main.ts step dispatch, then
   *  /audit/step/* will never reach danet. */
  @Get("debug/step-dispatch") @ReturnedType(OkResponse)
  debugStepDispatch() {
    return { ok: true, stepDispatchMovedToMain: true };
  }

  /** Debug: confirms API_URL is localhost (unified process) instead of an
   *  external deployment hostname. If this ever returns inProcess=false, the
   *  frontend SSR is crossing deployments and the pipeline can't be traced. */
  @Get("debug/api-url") @ReturnedType(OkResponse)
  debugApiUrl() {
    const apiUrl = Deno.env.get("API_URL") ?? null;
    return {
      apiUrl,
      expected: `http://localhost:${Deno.env.get("PORT") ?? 3000}`,
      inProcess: apiUrl?.startsWith("http://localhost") === true,
    };
  }

  /** Debug: the effective SELF_URL for the current request. This is what
   *  QStash callback URLs will use. Must match the CURRENT deployment's origin
   *  (not whatever .env has) for audits to actually run on branch previews. */
  @Get("debug/self-url") @ReturnedType(OkResponse)
  async debugSelfUrl() {
    const { getSelfUrl, getSelfUrlSources } = await import("@core/data/qstash/mod.ts");
    const sources = getSelfUrlSources();
    const effective = getSelfUrl();
    let source: string;
    if (sources.scopedOrigin && !sources.scopedIsLocalhost) source = "async-local-storage";
    else if (sources.knownPublicOrigin) source = "known-public-origin-cache";
    else if (sources.deploymentId) source = "deno-deployment-id";
    else if (sources.envSelfUrl) source = "env";
    else source = "fallback-localhost";
    return {
      selfUrl: effective,
      envSelfUrl: sources.envSelfUrl,
      source,
      sources,
    };
  }

  /** Debug: dump active-tracking + completed-audit-stat KV entries for the current org.
   *  Useful for diagnosing "I started an audit and it disappeared" — shows what's
   *  actually stored vs what the dashboard is rendering. */
  @Get("debug/kv-state") @ReturnedType(OkResponse)
  async debugKvState() {
    const { listStoredWithKeys } = await import("@core/data/firestore/mod.ts");
    const orgId = ORG();
    const active = await listStoredWithKeys("active-tracking", orgId);
    const completed = await listStoredWithKeys("completed-audit-stat", orgId);
    const errors = await listStoredWithKeys("error-tracking", orgId);
    // For chunked findings: header docs have key.length===1; chunks have key.length>1.
    // Count distinct finding IDs by collecting the first key part of the header.
    const findingDocs = await listStoredWithKeys("audit-finding", orgId);
    const findingIds = new Set<string>();
    for (const { key } of findingDocs) {
      if (key.length === 1) findingIds.add(String(key[0]));
    }
    return {
      orgId,
      active,
      activeCount: active.length,
      completedCount: completed.length,
      recentCompletedSample: completed.slice(0, 5),
      errors: errors.slice(0, 5),
      findingCount: findingIds.size,
      findingSample: Array.from(findingIds).slice(0, 10),
    };
  }
}
