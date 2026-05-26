/** Audit Counts background job — multi-tick deep KV scan with email delivery.
 *
 *  Why: the synchronous `/admin/audit-counts` endpoint walks
 *  `__audit-finding__` chunk-0 entries (the only KV source that gives us the
 *  package/date-leg split + raw recordIds), but at ~30KB per chunk-0 read ×
 *  ~25k findings, the scan exceeds Deno Deploy's 60s request budget and
 *  surfaces a `capped` partial result.
 *
 *  This module breaks the scan across multiple QStash-scheduled ticks. Each
 *  tick:
 *    1. loads the saved cursor + counts from Firestore
 *    2. walks `db.list({ prefix, cursor })` for up to ~45s
 *    3. updates the cursor + Sets in-place
 *    4. either schedules the next tick (more work to do) or finalizes (email)
 *
 *  Operator workflow:
 *    1. fills in optional Email field on the Audit Counts maintenance tool
 *    2. clicks Count audits → kicks off a job, modal shows "scan running,
 *       results coming to email"
 *    3. ~3 minutes later they get an email with the exact counts + a CSV
 *       attachment of every unique date-leg + package recordId
 *
 *  No daily cron, no shared state — each run is one-off and self-contained. */

import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { getKv } from "@core/data/deno-kv/mod.ts";
import { publishUrl } from "@core/data/qstash/mod.ts";
import { sendEmail } from "@reporting/domain/data/postmark/mod.ts";

const TICK_TIME_BUDGET_MS = 45_000;
const TICK_ROW_CAP = 500_000;
const TICK_DELAY_SECONDS = 5;

const RECORDING_FIELD_RE = /"recordingIdField"\s*:\s*"([^"]+)"/;
const RECORD_ID_RE = /"RecordId"\s*:\s*(\d+)/;

export interface AuditCountsJob {
  id: string;
  email: string;
  sinceMs: number;
  untilMs: number;
  status: "running" | "complete" | "error";
  startedAt: number;
  completedAt?: number;
  error?: string;
  ticks: number;

  // Deep-scan progress (resumed each tick)
  cursor: string;
  rowsScanned: number;
  chunkZeroSeen: number;
  packageRids: string[];
  dateLegRids: string[];

  // Fast-scan results captured once at start (don't re-run on every tick)
  firestore?: { packagesUnique: number; dateLegsUnique: number; recordsUnique: number; rowsScanned: number; tookMs: number };
  kvFindings?: { count: number; rowsScanned: number; tookMs: number };
  kvCompleted?: { packagesUnique: number; dateLegsUnique: number; recordsUnique: number; rowsScanned: number; tookMs: number };
}

function selfUrl(): string {
  return Deno.env.get("SELF_URL") ?? "http://localhost:3000";
}

export async function getAuditCountsJob(orgId: OrgId, jobId: string): Promise<AuditCountsJob | null> {
  return (await getStored<AuditCountsJob>("audit-counts-job", orgId, jobId)) ?? null;
}

async function saveJob(orgId: OrgId, job: AuditCountsJob): Promise<void> {
  await setStored("audit-counts-job", orgId, [job.id], job);
}

/** Kick off a new deep-scan job. Runs the fast scans inline (FS audit-done-idx,
 *  audit-job, completed-audit-stat) so the first email arrival has those
 *  totals baked in even if the deep scan is still ticking. Then schedules
 *  the first tick. */
export async function startAuditCountsJob(
  orgId: OrgId,
  opts: { email: string; sinceMs: number; untilMs: number },
): Promise<{ jobId: string }> {
  const jobId = nanoid();
  const job: AuditCountsJob = {
    id: jobId,
    email: opts.email,
    sinceMs: opts.sinceMs,
    untilMs: opts.untilMs,
    status: "running",
    startedAt: Date.now(),
    ticks: 0,
    cursor: "",
    rowsScanned: 0,
    chunkZeroSeen: 0,
    packageRids: [],
    dateLegRids: [],
  };

  // Fast scans run inline at start. Independently try/catch'd so a partial
  // failure still lets the deep scan proceed.
  job.firestore = await runFirestoreFast(orgId, opts.sinceMs, opts.untilMs).catch((err) => {
    console.error(`❌ [AUDIT-COUNTS-JOB:${jobId}] firestore fast scan failed:`, err);
    return undefined;
  });
  job.kvFindings = await runKvJobsFast(orgId).catch((err) => {
    console.error(`❌ [AUDIT-COUNTS-JOB:${jobId}] kv-jobs fast scan failed:`, err);
    return undefined;
  });
  job.kvCompleted = await runKvCompletedFast(orgId, opts.sinceMs, opts.untilMs).catch((err) => {
    console.error(`❌ [AUDIT-COUNTS-JOB:${jobId}] kv-completed fast scan failed:`, err);
    return undefined;
  });

  await saveJob(orgId, job);
  console.log(`🚀 [AUDIT-COUNTS-JOB:${jobId}] started — email=${opts.email} since=${opts.sinceMs} until=${opts.untilMs}`);

  // Schedule first deep-scan tick. Delay 0 — get going immediately.
  await publishUrl(`${selfUrl()}/admin/audit-counts/tick`, { jobId, orgId });
  return { jobId };
}

/** Resume the deep scan from saved cursor. Walks up to TICK_TIME_BUDGET_MS or
 *  TICK_ROW_CAP, then either schedules itself again or finalizes + emails. */
export async function tickAuditCountsJob(orgId: OrgId, jobId: string): Promise<void> {
  const job = await getAuditCountsJob(orgId, jobId);
  if (!job) {
    console.warn(`⚠️ [AUDIT-COUNTS-JOB:${jobId}] tick fired but job not found — dropping`);
    return;
  }
  if (job.status !== "running") {
    console.log(`[AUDIT-COUNTS-JOB:${jobId}] tick fired but status=${job.status} — dropping`);
    return;
  }

  const tickStart = Date.now();
  job.ticks += 1;
  const pkgSet = new Set<string>(job.packageRids);
  const dlSet = new Set<string>(job.dateLegRids);

  const db = await getKv();
  // Resume from saved cursor. Empty string = start from the beginning.
  const iter = db.list(
    { prefix: ["__audit-finding__", orgId] },
    job.cursor ? { cursor: job.cursor, batchSize: 500 } : { batchSize: 500 },
  );

  let rowsThisTick = 0;
  let chunkZeroThisTick = 0;
  let timedOut = false;

  try {
    for await (const entry of iter) {
      rowsThisTick += 1;
      if (rowsThisTick >= TICK_ROW_CAP) { timedOut = true; break; }
      if (Date.now() - tickStart > TICK_TIME_BUDGET_MS) { timedOut = true; break; }

      const key = entry.key as Deno.KvKey;
      if (key.length < 4) continue;
      const tail = key[key.length - 1];
      if (tail !== 0 && tail !== "0") continue;
      chunkZeroThisTick += 1;
      const raw = entry.value;
      if (typeof raw !== "string") continue;
      const fieldMatch = raw.match(RECORDING_FIELD_RE);
      const ridMatch = raw.match(RECORD_ID_RE);
      if (!ridMatch) continue;
      const rid = ridMatch[1].trim();
      if (!rid) continue;
      if (fieldMatch && fieldMatch[1] === "GenieNumber") pkgSet.add(rid);
      else dlSet.add(rid);
    }
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
    await saveJob(orgId, job);
    console.error(`❌ [AUDIT-COUNTS-JOB:${jobId}] tick ${job.ticks} threw:`, err);
    await sendErrorEmail(job).catch((e) => console.error(`❌ [AUDIT-COUNTS-JOB:${jobId}] error-email failed:`, e));
    return;
  }

  job.rowsScanned += rowsThisTick;
  job.chunkZeroSeen += chunkZeroThisTick;
  job.packageRids = [...pkgSet];
  job.dateLegRids = [...dlSet];
  job.cursor = iter.cursor;

  console.log(`[AUDIT-COUNTS-JOB:${jobId}] tick ${job.ticks} done — rows+${rowsThisTick} (total ${job.rowsScanned}), chunkZero+${chunkZeroThisTick} (total ${job.chunkZeroSeen}), pkgs=${pkgSet.size}, date-legs=${dlSet.size}, took=${Date.now() - tickStart}ms, cursor=${iter.cursor ? "more" : "done"}, timedOut=${timedOut}`);

  // If the iterator yielded a fresh cursor, there's more to walk → next tick.
  // If iter.cursor is empty and we DIDN'T time out, we exhausted the prefix.
  const moreWork = timedOut || iter.cursor;
  if (moreWork) {
    await saveJob(orgId, job);
    await publishUrl(`${selfUrl()}/admin/audit-counts/tick`, { jobId, orgId }, TICK_DELAY_SECONDS);
    return;
  }

  // Done — finalize.
  job.status = "complete";
  job.completedAt = Date.now();
  await saveJob(orgId, job);
  console.log(`✅ [AUDIT-COUNTS-JOB:${jobId}] complete after ${job.ticks} ticks — pkgs=${pkgSet.size}, date-legs=${dlSet.size}, rowsScanned=${job.rowsScanned}`);

  await sendCompletionEmail(job).catch((e) => {
    console.error(`❌ [AUDIT-COUNTS-JOB:${jobId}] completion email failed:`, e);
    job.error = `email failed: ${e instanceof Error ? e.message : String(e)}`;
    saveJob(orgId, job).catch(() => {});
  });
}

// ── Fast scans (run once at start) ─────────────────────────────────────────

async function runFirestoreFast(orgId: OrgId, sinceMs: number, untilMs: number) {
  const t0 = Date.now();
  const { listStoredByCompletedAt } = await import("@core/data/firestore/mod.ts");
  const entries = await listStoredByCompletedAt<{
    recordId?: string; isPackage?: boolean; findingId?: string;
  }>("audit-done-idx", orgId, sinceMs, untilMs, { limit: 500_000 });
  const pkgs = new Set<string>();
  const dls = new Set<string>();
  for (const e of entries) {
    const rid = String(e.recordId ?? "").trim();
    if (!rid) continue;
    if (e.isPackage) pkgs.add(rid); else dls.add(rid);
  }
  return {
    packagesUnique: pkgs.size,
    dateLegsUnique: dls.size,
    recordsUnique: pkgs.size + dls.size,
    rowsScanned: entries.length,
    tookMs: Date.now() - t0,
  };
}

async function runKvJobsFast(orgId: OrgId) {
  const t0 = Date.now();
  const db = await getKv();
  const findingIds = new Set<string>();
  let rows = 0;
  for await (const entry of db.list({ prefix: ["__audit-job__", orgId] })) {
    rows += 1;
    const key = entry.key as Deno.KvKey;
    const jobId = typeof key[2] === "string" ? key[2] : "";
    if (jobId) findingIds.add(jobId);
  }
  return { count: findingIds.size, rowsScanned: rows, tookMs: Date.now() - t0 };
}

async function runKvCompletedFast(orgId: OrgId, sinceMs: number, untilMs: number) {
  const t0 = Date.now();
  const db = await getKv();
  const pkgs = new Set<string>();
  const dls = new Set<string>();
  let rows = 0;
  for await (const entry of db.list({ prefix: ["__completed-audit-stat__", orgId] })) {
    rows += 1;
    const body = entry.value as { recordId?: string; isPackage?: boolean; ts?: number; startedAt?: number } | null;
    if (!body) continue;
    const ts = Number(body.ts ?? body.startedAt ?? 0);
    if (sinceMs > 0 && ts && ts < sinceMs) continue;
    if (untilMs < Date.now() && ts && ts > untilMs) continue;
    const rid = String(body.recordId ?? "").trim();
    if (!rid) continue;
    if (body.isPackage) pkgs.add(rid); else dls.add(rid);
  }
  return {
    packagesUnique: pkgs.size,
    dateLegsUnique: dls.size,
    recordsUnique: pkgs.size + dls.size,
    rowsScanned: rows,
    tookMs: Date.now() - t0,
  };
}

// ── Email delivery ─────────────────────────────────────────────────────────

function rangeLabel(job: AuditCountsJob): string {
  if (job.sinceMs <= 0 && job.untilMs >= Date.now() - 1000) return "All time";
  const from = job.sinceMs > 0 ? new Date(job.sinceMs).toISOString().slice(0, 10) : "epoch";
  const to = new Date(job.untilMs).toISOString().slice(0, 10);
  return `${from} → ${to}`;
}

function buildCsv(job: AuditCountsJob): string {
  const lines: string[] = ["type,recordId"];
  for (const rid of job.packageRids) lines.push(`package,${rid}`);
  for (const rid of job.dateLegRids) lines.push(`date-leg,${rid}`);
  return lines.join("\n");
}

function buildHtml(job: AuditCountsJob): string {
  const fmt = (n: number | undefined) => (n == null ? "—" : n.toLocaleString());
  const elapsedSec = job.completedAt ? Math.round((job.completedAt - job.startedAt) / 1000) : 0;
  const totalDeep = job.packageRids.length + job.dateLegRids.length;
  return `
    <div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#0a0e17;color:#e6edf3;">
      <h2 style="color:#58a6ff;margin:0 0 6px;">Audit Counts — Deep Scan Complete</h2>
      <p style="color:#8b949e;font-size:13px;margin:0 0 18px;">
        Range: <strong>${rangeLabel(job)}</strong> · Job <code>${job.id}</code> · ${job.ticks} ticks · ${elapsedSec}s total
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
        <tr style="border-bottom:1px solid #1c2433;">
          <th align="left" style="padding:8px;color:#8b949e;font-weight:600;">Source</th>
          <th align="right" style="padding:8px;color:#8b949e;font-weight:600;">Records</th>
          <th align="right" style="padding:8px;color:#8b949e;font-weight:600;">Packages</th>
          <th align="right" style="padding:8px;color:#8b949e;font-weight:600;">Date-legs</th>
        </tr>
        <tr style="border-bottom:1px solid #1c2433;">
          <td style="padding:8px;">Firestore (audit-done-idx)</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.firestore?.recordsUnique)}</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.firestore?.packagesUnique)}</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.firestore?.dateLegsUnique)}</td>
        </tr>
        <tr style="border-bottom:1px solid #1c2433;">
          <td style="padding:8px;">KV (audit-job — exact total)</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.kvFindings?.count)}</td>
          <td align="right" style="padding:8px;color:#8b949e;">—</td>
          <td align="right" style="padding:8px;color:#8b949e;">—</td>
        </tr>
        <tr style="border-bottom:1px solid #1c2433;">
          <td style="padding:8px;">KV (completed-audit-stat — finalize subset)</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.kvCompleted?.recordsUnique)}</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.kvCompleted?.packagesUnique)}</td>
          <td align="right" style="padding:8px;font-variant-numeric:tabular-nums;">${fmt(job.kvCompleted?.dateLegsUnique)}</td>
        </tr>
        <tr>
          <td style="padding:8px;color:#3fb950;font-weight:700;">KV (audit-finding deep — FULL)</td>
          <td align="right" style="padding:8px;color:#3fb950;font-weight:700;font-variant-numeric:tabular-nums;">${fmt(totalDeep)}</td>
          <td align="right" style="padding:8px;color:#3fb950;font-weight:700;font-variant-numeric:tabular-nums;">${fmt(job.packageRids.length)}</td>
          <td align="right" style="padding:8px;color:#3fb950;font-weight:700;font-variant-numeric:tabular-nums;">${fmt(job.dateLegRids.length)}</td>
        </tr>
      </table>

      <p style="color:#8b949e;font-size:12px;margin:0 0 6px;">
        Deep scan walked ${fmt(job.rowsScanned)} __audit-finding__ keys and decoded ${fmt(job.chunkZeroSeen)} chunk-0 bodies.
      </p>
      <p style="color:#8b949e;font-size:12px;margin:0;">
        Attached CSV (<code>audit-counts-${job.id}.csv</code>) lists every unique recordId from the deep scan, one per row.
      </p>
    </div>
  `;
}

async function sendCompletionEmail(job: AuditCountsJob): Promise<void> {
  const csv = buildCsv(job);
  const csvBase64 = btoa(csv);
  await sendEmail({
    to: job.email,
    subject: `Audit Counts deep scan complete — ${job.packageRids.length + job.dateLegRids.length} unique recordIds`,
    htmlBody: buildHtml(job),
    attachments: [{
      name: `audit-counts-${job.id}.csv`,
      content: csvBase64,
      contentType: "text/csv",
    }],
  });
  console.log(`📧 [AUDIT-COUNTS-JOB:${job.id}] completion email sent to ${job.email}`);
}

async function sendErrorEmail(job: AuditCountsJob): Promise<void> {
  await sendEmail({
    to: job.email,
    subject: `Audit Counts deep scan FAILED — ${job.id}`,
    htmlBody: `
      <div style="font-family:system-ui,sans-serif;padding:20px;">
        <h2 style="color:#f85149;">Audit Counts deep scan failed</h2>
        <p>Job <code>${job.id}</code> errored on tick ${job.ticks} after ${job.rowsScanned} rows.</p>
        <p style="color:#8b949e;font-size:12px;">Error: ${job.error ?? "unknown"}</p>
        <p style="color:#8b949e;font-size:12px;">Partial counts so far: packages=${job.packageRids.length}, date-legs=${job.dateLegRids.length}</p>
      </div>
    `,
  });
}
