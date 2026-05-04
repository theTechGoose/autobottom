/** Migration controller — orchestrates KV → Firestore migration jobs from
 *  the Data Maintenance modal. All endpoints assume admin scope (the modal is
 *  admin-only on the frontend).
 *
 *  Driver-mode: /run creates a Firestore-backed job and returns its jobId
 *  immediately (no background work). /status BOTH advances the job by one
 *  tick AND returns the rendered state — so each frontend poll moves work
 *  forward, surviving any number of isolate recycles. */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { OkMessageResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import {
  inventoryProdKv, ensureProdKvConfigured, createJob, getJob, listJobs,
  cancelJob, forceCancelJob, killAllRunningJobs, resumeJob, skipToPhase, tickJob,
  captureSnapshot, verifyMigration, computeScanPrefixes, orphanCheck,
  GLOBAL_TYPES, SKIP_TYPES,
  type RunOpts, type PersistedJob, type InventoryRow, type Snapshot, type VerifyReport,
  type OrphanReport,
} from "@admin/domain/business/migration/mod.ts";

@SwaggerDescription("Migration — KV → Firestore data migration tooling")
@Controller("admin/migration")
export class MigrationController {

  @Get("config-check") @ReturnedType(MessageResponse)
  @Description("Check whether PROD_EXPORT_BASE_URL + KV_EXPORT_SECRET are set and look valid")
  configCheck() {
    const r = ensureProdKvConfigured();
    if (!r.ok) return { ok: false, message: r.error };
    return { ok: true, message: "configured", url: maskUrl() };
  }

  @Get("inventory") @ReturnedType(MessageResponse)
  @Description("Walk prod KV via paginated /admin/kv-inventory and return per-(org, type) counts")
  async inventory() {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    try {
      const { rows, partial, scanned } = await inventoryProdKv();
      const totalSimple = rows.reduce((s, r) => s + r.count, 0);
      const totalChunked = rows.reduce((s, r) => s + r.chunkedCount, 0);
      return {
        ok: true,
        rows,
        totalSimple, totalChunked,
        partial, scanned,
        skipTypes: [...SKIP_TYPES],
        globalTypes: [...GLOBAL_TYPES],
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  @Post("run") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Start an async migration job. Body: {types?, since?, until?, dryRun?, sinceVersionstamp?}")
  async run(@Body() body: GenericBodyRequest) {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    const opts = parseRunOpts(body);
    try {
      const jobId = await createJob(opts);
      return { ok: true, jobId, message: `started ${jobId}`, opts };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  @Post("tick-now") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  @Description("Manually drive one tick on a running job. For when cron isn't firing. Body: {jobId}")
  async tickNow(@Body() body: GenericBodyRequest) {
    const jobId = (body as unknown as Record<string, unknown>).jobId as string | undefined;
    if (!jobId) return { ok: false, error: "jobId required" };
    console.log(`👆 [MIGRATION:TICK-NOW:${jobId.slice(-6)}] manual tick triggered`);
    try {
      const job = await tickJob(jobId);
      if (!job) return { ok: false, error: `job ${jobId} not found` };
      return { ok: true, job: shallowJob(job) };
    } catch (err) {
      return { ok: false, error: `tick failed: ${String(err).slice(0, 200)}` };
    }
  }

  @Get("status") @ReturnedType(MessageResponse)
  @Description("Poll job state by jobId. Read-only — cron is the single writer. Query: ?jobId=…")
  async status(@Query("jobId") jobId: string) {
    if (!jobId) return { ok: false, error: "jobId required" };
    // READ-ONLY. Originally /status drove the job forward each poll, but
    // when the cron-tick driver was added, two concurrent ticks (one from
    // /status polls every 2s, one from cron every minute) raced — both
    // would read state, both would make progress, the second writer's
    // save would overwrite the first. State (phase, cursor, logTail) got
    // clobbered. Cron is now the single writer; /status just reads.
    const job = await getJob(jobId);
    if (!job) return { ok: false, error: `job ${jobId} not found` };
    return { ok: true, job: shallowJob(job) };
  }

  @Get("jobs") @ReturnedType(MessageResponse)
  @Description("List recent jobs")
  async jobs() {
    const all = await listJobs();
    return { ok: true, jobs: all.map(shallowJob) };
  }

  @Post("cancel") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Request graceful cancellation of a running job. Body: {jobId}")
  async cancel(@Body() body: GenericBodyRequest) {
    const jobId = (body as unknown as Record<string, unknown>).jobId as string | undefined;
    if (!jobId) return { ok: false, error: "jobId required" };
    const ok = await cancelJob(jobId);
    return { ok, message: ok ? "cancellation requested" : "job not running" };
  }

  @Post("force-cancel") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Immediately mark a running job as cancelled (no tick wait). Body: {jobId}")
  async forceCancel(@Body() body: GenericBodyRequest) {
    const jobId = (body as unknown as Record<string, unknown>).jobId as string | undefined;
    if (!jobId) return { ok: false, error: "jobId required" };
    const ok = await forceCancelJob(jobId);
    return { ok, message: ok ? "force-cancelled" : "job not running" };
  }

  @Post("skip-phase") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Manually advance a verify-repair job's phase. Body: {jobId, phase}")
  async skipPhase(@Body() body: GenericBodyRequest) {
    const b = body as unknown as Record<string, unknown>;
    const jobId = b.jobId as string | undefined;
    const phase = b.phase as string | undefined;
    if (!jobId) return { ok: false, error: "jobId required" };
    if (!phase) return { ok: false, error: "phase required" };
    const ok = await skipToPhase(jobId, phase as never);
    return { ok, message: ok ? `advanced to ${phase}` : "job not found or not verify-repair" };
  }

  @Post("resume") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Re-arm an errored job so the cron driver picks it back up. Body: {jobId}")
  async resume(@Body() body: GenericBodyRequest) {
    const jobId = (body as unknown as Record<string, unknown>).jobId as string | undefined;
    if (!jobId) return { ok: false, error: "jobId required" };
    const ok = await resumeJob(jobId);
    return { ok, message: ok ? "resumed — cron will tick within 1 min" : "job not found or not in error state" };
  }

  @Post("kill-all") @ReturnedType(OkMessageResponse)
  @Description("Mark every running migration job as cancelled. Big red button.")
  async killAll() {
    const killed = await killAllRunningJobs();
    return { ok: true, killed, message: `killed ${killed} running job(s)` };
  }

  @Post("snapshot") @ReturnedType(MessageResponse)
  @Description("Capture a versionstamp high-water mark for cutover delta migration")
  async snapshot() {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    try {
      const snap: Snapshot = await captureSnapshot();
      return { ok: true, snapshot: snap };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  @Post("orphan-check") @ReturnedType(MessageResponse)
  @Description("List findings in __audit-finding__ that lack an audit-done-idx entry — diagnostic for the index-driven path")
  async orphanCheck() {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    try {
      const report: OrphanReport = await orphanCheck();
      return { ok: true, ...report };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  @Post("verify") @ReturnedType(MessageResponse) @BodyType(GenericBodyRequest)
  @Description("Sample N random prod KV entries and compare against Firestore. Body: {sample?}")
  async verify(@Body() body: GenericBodyRequest) {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    const sample = Number((body as unknown as Record<string, unknown>).sample ?? 50);
    try {
      const report: VerifyReport = await verifyMigration(sample);
      return { ok: true, report };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRunOpts(body: unknown): RunOpts {
  const b = (body ?? {}) as Record<string, unknown>;
  const types = Array.isArray(b.types) ? (b.types as unknown[]).map(String).filter(Boolean) : undefined;
  const since = parseDateOrMs(b.since, false);
  const until = parseDateOrMs(b.until, true);
  const mode = b.mode === "index-driven" ? "index-driven" as const
    : b.mode === "scan" ? "scan" as const
    : b.mode === "verify-repair" ? "verify-repair" as const
    : undefined;
  return {
    types: types && types.length > 0 ? types : undefined,
    since: since ?? undefined,
    until: until ?? undefined,
    dryRun: b.dryRun === true || b.dryRun === "true",
    sinceVersionstamp: typeof b.sinceVersionstamp === "string" && b.sinceVersionstamp ? b.sinceVersionstamp : undefined,
    mode,
    deepCompare: b.deepCompare === true || b.deepCompare === "true",
  };
}

/** YYYY-MM-DD or ms-since-epoch → ms. endOfDay=true → last ms of that day. */
function parseDateOrMs(v: unknown, endOfDay: boolean): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(ms)) return null;
  return endOfDay ? ms + 24 * 60 * 60 * 1000 - 1 : ms;
}

function shallowJob(j: PersistedJob) {
  return {
    jobId: j.jobId,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    status: j.status,
    cancelled: j.cancelled,
    phase: j.phase,
    scanned: j.scanned,
    written: j.written,
    writtenChunked: j.writtenChunked,
    skipped: j.skipped,
    chunkedQueueSize: j.chunkedQueueSize,
    chunkedQueueProcessed: j.chunkedQueueProcessed,
    byType: j.byType ?? {},
    knownOrgs: j.knownOrgs ?? [],
    scanPrefixesTotal: computeScanPrefixes(j.opts.types, j.knownOrgs ?? []).length,
    scanPrefixIdx: j.scanPrefixIdx ?? 0,
    errorCount: j.errors.length,
    errors: j.errors.slice(-10),
    message: j.message,
    opts: j.opts,
    elapsedMs: (j.endedAt ?? Date.now()) - j.startedAt,
    lastTickAt: j.lastTickAt,
    // Verify-repair fields (undefined for other modes — frontend conditional)
    verifyBuckets: j.verifyBuckets,
    verifyMatched: j.verifyMatched,
    verifyRepaired: j.verifyRepaired,
    prodScanPageNum: j.prodScanPageNum,
    // Rolling activity log — last 200 lines (newest last)
    logTail: j.logTail ?? [],
  };
}

function maskUrl(): string {
  return Deno.env.get("PROD_EXPORT_BASE_URL") ?? "";
}
