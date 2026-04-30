/** Migration controller — orchestrates KV → Firestore migration jobs from
 *  the Data Maintenance modal. All endpoints assume admin scope (the modal is
 *  admin-only on the frontend). */
import "npm:reflect-metadata@0.1.13";
import { Controller, Get, Post, Body, Query } from "@danet/core";
import { SwaggerDescription } from "@mrg-keystone/danet";
import { ReturnedType, Description, BodyType } from "#danet/swagger-decorators";
import { OkMessageResponse, MessageResponse } from "@core/dto/responses.ts";
import { GenericBodyRequest } from "@core/dto/requests.ts";
import {
  inventoryProdKv, ensureProdKvConfigured, startMigration, getJob, listJobs,
  cancelJob, captureSnapshot, verifyMigration, GLOBAL_TYPES, SKIP_TYPES,
  type RunOpts, type JobState, type InventoryRow, type Snapshot, type VerifyReport,
} from "@admin/domain/business/migration/mod.ts";

@SwaggerDescription("Migration — KV → Firestore data migration tooling")
@Controller("admin/migration")
export class MigrationController {

  @Get("config-check") @ReturnedType(MessageResponse)
  @Description("Check whether PROD_KV_URL + KV_ACCESS_TOKEN are set and look valid")
  configCheck() {
    const r = ensureProdKvConfigured();
    if (!r.ok) return { ok: false, message: r.error };
    return { ok: true, message: "configured", url: maskUrl() };
  }

  @Get("inventory") @ReturnedType(MessageResponse)
  @Description("Walk prod KV and count entries per (org, type)")
  async inventory() {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    try {
      const rows: InventoryRow[] = await inventoryProdKv();
      const totalSimple = rows.reduce((s, r) => s + r.count, 0);
      const totalChunked = rows.reduce((s, r) => s + r.chunkedCount, 0);
      return {
        ok: true,
        rows,
        totalSimple, totalChunked,
        skipTypes: [...SKIP_TYPES],
        globalTypes: [...GLOBAL_TYPES],
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  @Post("run") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Start an async migration job. Body: {types?, since?, until?, dryRun?, sinceVersionstamp?}")
  run(@Body() body: GenericBodyRequest) {
    const ck = ensureProdKvConfigured();
    if (!ck.ok) return { ok: false, error: ck.error };
    const opts = parseRunOpts(body);
    const jobId = startMigration(opts);
    return { ok: true, jobId, message: `started ${jobId}`, opts };
  }

  @Get("status") @ReturnedType(MessageResponse)
  @Description("Poll job state by jobId. Query: ?jobId=…")
  status(@Query("jobId") jobId: string) {
    if (!jobId) return { ok: false, error: "jobId required" };
    const job = getJob(jobId);
    if (!job) return { ok: false, error: `job ${jobId} not found (lost across isolate restart?)` };
    return { ok: true, job: shallowJob(job) };
  }

  @Get("jobs") @ReturnedType(MessageResponse)
  @Description("List recent jobs")
  jobs() {
    return { ok: true, jobs: listJobs().map(shallowJob) };
  }

  @Post("cancel") @ReturnedType(OkMessageResponse) @BodyType(GenericBodyRequest)
  @Description("Request cancellation of a running job. Body: {jobId}")
  cancel(@Body() body: GenericBodyRequest) {
    const jobId = (body as unknown as Record<string, unknown>).jobId as string | undefined;
    if (!jobId) return { ok: false, error: "jobId required" };
    const ok = cancelJob(jobId);
    return { ok, message: ok ? "cancellation requested" : "job not running" };
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
  const sinceN = Number(b.since);
  const untilN = Number(b.until);
  return {
    types: types && types.length > 0 ? types : undefined,
    since: Number.isFinite(sinceN) && sinceN > 0 ? sinceN : undefined,
    until: Number.isFinite(untilN) && untilN > 0 ? untilN : undefined,
    dryRun: b.dryRun === true || b.dryRun === "true",
    sinceVersionstamp: typeof b.sinceVersionstamp === "string" && b.sinceVersionstamp ? b.sinceVersionstamp : undefined,
  };
}

function shallowJob(j: JobState) {
  return {
    jobId: j.jobId,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    status: j.status,
    cancelled: j.cancelled,
    scanned: j.scanned,
    written: j.written,
    writtenChunked: j.writtenChunked,
    skipped: j.skipped,
    errorCount: j.errors.length,
    errors: j.errors.slice(-10),
    message: j.message,
    opts: j.opts,
    elapsedMs: (j.endedAt ?? Date.now()) - j.startedAt,
  };
}

function maskUrl(): string {
  const u = Deno.env.get("PROD_KV_URL") ?? "";
  return u.replace(/databases\/([0-9a-f-]+)/i, (_, id) => `databases/${id.slice(0, 8)}…`);
}
