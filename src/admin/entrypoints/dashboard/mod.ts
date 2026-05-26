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
import { getStats, getRecentCompleted, queryAuditDoneIndex, findAuditsByRecordId, writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import { getReviewStats, getReviewedFindingIds } from "@review/domain/business/review-queue/mod.ts";
import { getOfficeBypassConfig, isPipelinePaused } from "@admin/domain/data/admin-repository/mod.ts";
import { isOfficeBypassed } from "@audit/domain/business/chargeback-engine/mod.ts";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

import { defaultOrgId } from "@core/business/auth/mod.ts";
const ORG = defaultOrgId;

@SwaggerDescription("Dashboard — admin analytics data, audit history, review queue data")
@Controller("admin")
export class DashboardController {

  /** Dashboard summary endpoint — does a 5-way parallel fan-out
   *  (getStats internally pages 100 recent completed-stat docs, plus
   *  errors/retries; getRecentCompleted pulls 100 more; review-stats,
   *  bypass-config, paused-flag) for ~10 Firestore round-trips per call.
   *
   *  Multiple admin panels poll their own endpoints every 10s and several
   *  end up indirectly relying on this same data, so under load the
   *  isolate ends up running this fan-out many times per second and
   *  bottlenecking the whole process — to the point that the dashboard
   *  itself starts 503'ing while the audit pipeline runs fine.
   *
   *  Per-isolate 5s memo collapses any burst into a single real fan-out.
   *  Stale-by-5s is fine for an at-a-glance dashboard. */
  @Get("dashboard/data") @ReturnedType(DashboardDataResponse)
  async dashboardData() {
    const orgId = ORG();
    const now = Date.now();
    const cached = DashboardController._dashCache.get(orgId);

    // Stale-while-revalidate. Three paths:
    //   1) Fresh cache → return immediately, no work.
    //   2) Stale cache → return stale value NOW, kick off background
    //      refresh that updates the cache when it lands. Concurrent
    //      requests reuse the same in-flight promise.
    //   3) No cache (cold start) → race the fan-out against a 5s
    //      budget. If fan-out wins, return real data. If 5s wins,
    //      return zeroed placeholder and let the fan-out complete
    //      in the background — the *next* request gets real data.
    //
    // This guarantees dashboard/data NEVER blocks longer than 5s on
    // Firestore lag, even when audit handlers are saturating FS.
    // Worst case the dashboard shows ~5s-stale data; previous worst
    // case was a 60s isolate timeout → 503 → page won't load at all.
    if (cached && cached.expiresAt > now) return cached.value;

    let pending = DashboardController._dashPending.get(orgId);
    if (!pending) {
      // CRITICAL: this promise must NEVER reject. We store it and let
      // background callers ignore the result, so an unhandled rejection
      // here would crash the isolate (→ 500 INTERNAL_SERVER_ERROR on
      // every request landing on it). Catch all errors inside, log,
      // and resolve to null instead of throwing.
      pending = (async () => {
        try {
          console.log(`📊 [DASH] dashboard/data orgId=${orgId}`);
          const [pipelineStats, reviewStats, recentRaw, bypassCfg, paused] = await Promise.all([
            getStats(orgId),
            getReviewStats(orgId),
            getRecentCompleted(orgId, 100),
            getOfficeBypassConfig(orgId),
            isPipelinePaused(orgId),
          ]);
          const patterns = bypassCfg.patterns ?? [];
          const recent = (patterns.length === 0
            ? recentRaw
            : recentRaw.filter((r) => !isOfficeBypassed(String((r as Record<string, unknown>).department ?? ""), patterns))
          ).slice(0, 25);
          const result = { pipeline: { ...pipelineStats, paused }, review: reviewStats, recentCompleted: recent };
          DashboardController._dashCache.set(orgId, { value: result, expiresAt: Date.now() + 5_000 });
          return result;
        } catch (err) {
          console.error(`❌ [DASH] background refresh failed orgId=${orgId}:`, err);
          return null;
        } finally {
          DashboardController._dashPending.delete(orgId);
        }
      })();
      DashboardController._dashPending.set(orgId, pending);
    }

    // Stale cache available → serve it now, refresh continues in background.
    if (cached) return cached.value;

    // Cold start → race fan-out against 5s, fall back to empty placeholder.
    const placeholder = {
      pipeline: { active: [], completedCount: 0, errors: [], retries: [], completedTs: [], errorsTs: [], retriesTs: [], paused: false },
      review: { pending: 0, completed: 0, total: 0 },
      recentCompleted: [],
    };
    const result = await Promise.race([
      pending,
      new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
    ]);
    return result ?? placeholder;
  }
  // 5s result cache + in-flight promise dedup. With stale-while-
  // revalidate, the cache value can outlive expiresAt — it's served
  // while a background refresh runs.
  private static _dashCache = new Map<string, { value: unknown; expiresAt: number }>();
  private static _dashPending = new Map<string, Promise<unknown>>();

  // NOTE: the SWR cache for queryAuditDoneIndex used to live here
  // (DashboardController._cachedQueryAuditDoneIndex). It moved to the
  // repository function itself so /admin/audits/data, /admin/unreviewed-audits
  // (bulk-flip), and any future caller share the cache. See
  // src/audit/domain/data/stats-repository/mod.ts:queryAuditDoneIndex.

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
    @Query("scoreState") scoreState: string,
    @Query("page") page: string,
    @Query("limit") limit: string,
    @Query("format") format: string,
  ) {
    const orgId = ORG();
    try {
    const s = parseInt(since || "0", 10) || 0;
    const u = parseInt(until || String(Date.now()), 10) || Date.now();
    const t = type || "all";
    const sMin = Math.max(0, Math.min(100, parseInt(scoreMin || "0", 10) || 0));
    const sMax = Math.max(0, Math.min(100, parseInt(scoreMax || "100", 10) || 100));
    const pg = Math.max(1, parseInt(page || "1", 10) || 1);
    const lim = Math.min(100, Math.max(10, parseInt(limit || "50", 10) || 50));

    console.log(`[AUDIT-HISTORY] ▶ START orgId=${orgId} since=${s} until=${u} type=${t} page=${pg} limit=${lim}`);
    let indexEntries: AuditDoneIndexEntry[];
    let reviewedIds: Set<string>;
    try {
      // queryAuditDoneIndex now owns its own SWR cache (was previously
      // wrapped by _cachedQueryAuditDoneIndex on this controller).
      indexEntries = await queryAuditDoneIndex(orgId, s, u);
      console.log(`[AUDIT-HISTORY] queryAuditDoneIndex returned ${indexEntries.length} entries`);
    } catch (err) {
      console.error(`[AUDIT-HISTORY] ❌ queryAuditDoneIndex threw: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[AUDIT-HISTORY] ❌ stack: ${err instanceof Error && err.stack ? err.stack : "<no stack>"}`);
      throw err;
    }
    try {
      console.log(`[AUDIT-HISTORY] calling getReviewedFindingIds...`);
      reviewedIds = await getReviewedFindingIds(orgId);
      console.log(`[AUDIT-HISTORY] getReviewedFindingIds returned ${reviewedIds.size} ids`);
    } catch (err) {
      console.error(`[AUDIT-HISTORY] ❌ getReviewedFindingIds threw: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[AUDIT-HISTORY] ❌ stack: ${err instanceof Error && err.stack ? err.stack : "<no stack>"}`);
      throw err;
    }
    // Hide bypassed offices (e.g. JAY) from the admin Audit History — same
    // gate already applied to chargeback reports + unreviewed list.
    const bypassCfg = await getOfficeBypassConfig(orgId);
    const bypassPatterns = bypassCfg.patterns ?? [];
    type AuditRow = AuditDoneIndexEntry & { ts: number };
    const windowEntries: AuditRow[] = indexEntries
      .filter((e) => bypassPatterns.length === 0 || !isOfficeBypassed(String(e.department ?? ""), bypassPatterns))
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
      // Score state: "no-score" → only rows where finalize wrote no score
      // (0/0 questions answered — pipeline completed but produced no result).
      // Reaudit + dashboard Re-run drain the audit-done-idx entry, so a row
      // present here with score==null is also "not yet retried." Perfect for
      // operator bulk-retry workflow.
      //
      // "invalid-genie" → reason === "invalid_genie" (finalize path that
      //   fired when the recording couldn't be downloaded). These typically
      //   have score==0, NOT null — hence the dedicated branch.
      // "no-score-or-invalid-genie" → catches both above. Operator's
      //   "show me every broken audit" filter.
      if (scoreState === "no-score" && c.score != null) return false;
      if (scoreState === "has-score" && c.score == null) return false;
      if (scoreState === "invalid-genie" && c.reason !== "invalid_genie") return false;
      if (scoreState === "no-score-or-invalid-genie" && c.score != null && c.reason !== "invalid_genie") return false;
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
    //
    // Also hydrates `recordingId` (genie #) — never written by the pipeline
    // historically. After hydrate, we fire-and-forget a writeAuditDoneIndex
    // for any row we newly enriched so the index is self-healing: next read
    // finds the recordingId already present, no finding fetch needed.
    async function hydrateMissing(rows: AuditRow[]): Promise<AuditRow[]> {
      const needs = rows.filter((r) =>
        (r.voName === undefined && r.owner === undefined) || !r.recordingId
      );
      if (needs.length === 0) return rows;
      const findings = await Promise.all(needs.map((r) => getFinding(orgId, r.findingId).catch(() => null)));
      const findingMap = new Map<string, Record<string, unknown>>();
      findings.forEach((f, i) => { if (f) findingMap.set(needs[i].findingId, f as Record<string, unknown>); });
      const backfill: AuditDoneIndexEntry[] = [];
      const hydrated = rows.map((r) => {
        const f = findingMap.get(r.findingId);
        if (!f) return r;
        const rec = f.record as Record<string, unknown> | undefined;
        const isPkg = f.recordingIdField === "GenieNumber";
        const rawVo = String(rec?.VoName ?? "");
        const vo = rawVo.includes(" - ") ? rawVo.split(" - ").slice(1).join(" - ").trim() : rawVo.trim();
        const recordingId = String((f as Record<string, unknown>).recordingId ?? "").trim() || undefined;
        const next: AuditRow = {
          ...r,
          isPackage: r.isPackage ?? isPkg,
          voName: r.voName ?? (vo || undefined),
          owner: r.owner ?? (f.owner as string | undefined),
          department: r.department ?? (String(isPkg ? (rec?.OfficeName ?? "") : (rec?.ActivatingOffice ?? "")) || undefined),
          shift: r.shift ?? (isPkg ? undefined : (String(rec?.Shift ?? "") || undefined)),
          startedAt: r.startedAt ?? (f.startedAt as number | undefined),
          recordingId: r.recordingId ?? recordingId,
        };
        // Queue write-back only if we actually added recordingId (the most
        // common gap). Old rows with voName/owner already present but no
        // recordingId still get backfilled this way.
        if (!r.recordingId && next.recordingId) {
          // Strip the AuditRow-only `ts` field before persisting.
          // deno-lint-ignore no-explicit-any
          const { ts: _ts, ...entry } = next as any;
          backfill.push(entry as AuditDoneIndexEntry);
        }
        return next;
      });
      if (backfill.length > 0) {
        // Fire-and-forget. Each writeAuditDoneIndex is one small Firestore
        // write; failures are non-fatal (next hydrate will retry the same
        // entry). Wrapped in Promise.allSettled so one bad write doesn't
        // abort the rest.
        Promise.allSettled(backfill.map((e) => writeAuditDoneIndex(orgId, e)))
          .then((results) => {
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) console.warn(`[AUDIT-HISTORY] ⚠️ ${failed}/${backfill.length} index back-fills failed`);
            else console.log(`[AUDIT-HISTORY] 🔧 back-filled recordingId on ${backfill.length} audit-done-idx entries`);
          })
          .catch(() => {});
      }
      return hydrated;
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
    // Clamp the requested page so a stale ?page=N (left over from a wider
    // window that had more pages) never returns an empty slice + non-zero
    // total. Without this, switching from 7d→3d while on page 2 produced
    // "27 audits in window" + "No audits match the current filters."
    const effectivePg = Math.min(Math.max(1, pg), pages);
    const pageItems = filtered.slice((effectivePg - 1) * lim, effectivePg * lim);
    console.log(`[AUDIT-HISTORY] hydrating ${pageItems.length} page rows (effectivePg=${effectivePg}/${pages})...`);
    let hydratedPage: AuditRow[];
    try {
      hydratedPage = await hydrateMissing(pageItems);
      console.log(`[AUDIT-HISTORY] hydrated ${hydratedPage.length} rows`);
    } catch (err) {
      console.error(`[AUDIT-HISTORY] ❌ hydrateMissing threw: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[AUDIT-HISTORY] ❌ stack: ${err instanceof Error && err.stack ? err.stack : "<no stack>"}`);
      throw err;
    }
    console.log(`[AUDIT-HISTORY] fetching ${hydratedPage.length} appeal records...`);
    let appeals: Array<{ status?: string } | null>;
    try {
      appeals = await Promise.all(hydratedPage.map((c) => getAppeal(orgId, c.findingId))) as Array<{ status?: string } | null>;
      console.log(`[AUDIT-HISTORY] fetched ${appeals.length} appeal records`);
    } catch (err) {
      console.error(`[AUDIT-HISTORY] ❌ getAppeal threw: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[AUDIT-HISTORY] ❌ stack: ${err instanceof Error && err.stack ? err.stack : "<no stack>"}`);
      throw err;
    }
      const items = hydratedPage.map((c, i) => ({
        ...c,
        reviewed: reviewedIds.has(c.findingId),
        appealStatus: appeals[i] ? appeals[i]!.status : null,
      }));

      console.log(`[AUDIT-HISTORY] ✅ DONE total=${total}/${windowEntries.length} page=${effectivePg}/${pages} type=${t} owner=${owner || "all"} dept=${department || "all"}`);
      return { items, total, pages, page: effectivePg, owners, departments, shifts, reviewers };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? err.stack : "<no stack>";
      console.error(`[AUDIT-HISTORY] ❌ FATAL handler error: ${msg}`);
      console.error(`[AUDIT-HISTORY] ❌ stack: ${stack}`);
      throw err;
    }
  }

  @Get("review-queue/data") @ReturnedType(ReviewStatsResponse)
  async reviewQueueData() { return getReviewStats(ORG()); }

  @Get("delete-finding") @ReturnedType(OkMessageResponse)
  async deleteFinding(@Query("findingId") findingId: string) {
    if (!findingId) return { error: "findingId required" };
    try {
      const { adminDeleteFindingLegacy } = await import("@judge/domain/data/judge-repository/mod.ts");
      await adminDeleteFindingLegacy(ORG(), findingId);
      return { ok: true, findingId };
    } catch (err) {
      console.warn(`⚠️ [DELETE-FINDING] ${findingId} failed — soft fallback:`, err);
      return { ok: false, retry: true, findingId, error: "Server busy, please retry" };
    }
  }

  @Get("audits-by-record") @ReturnedType(AuditsDataResponse)
  async auditsByRecord(@Query("recordId") recordId: string) {
    if (!recordId) return { error: "recordId required" };
    // Soft-fallback: returns empty list instead of 500. The frontend
    // [find-by-record.tsx] renders this as "no audits found", which is the
    // same shape as a legitimate empty result — graceful degradation.
    // Dispatch-catch in main.ts would also catch this, but the empty-list
    // shape is friendlier than a generic { retry: true } body for this UI.
    try {
      return { audits: await findAuditsByRecordId(ORG(), recordId) };
    } catch (err) {
      console.warn(`⚠️ [AUDITS-BY-RECORD] ${recordId} failed — soft fallback:`, err);
      return { audits: [], retry: true };
    }
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
