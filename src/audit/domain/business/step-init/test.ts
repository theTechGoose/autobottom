/** step-init: the genie-download miss branch, and the `skipGenieRetry` flag the
 *  bulk Genie Retry tool sets.
 *
 *  A retryable genie whose recording can't be downloaded normally climbs a
 *  10-min × 4 retry ladder (up to ~40 min) before finalizing invalid. During a
 *  bulk re-run that clogs the 5 concurrency slots and the run appears stuck, so
 *  the tool stamps `skipGenieRetry` to make a miss finalize on the FIRST try.
 *  These pin both behaviours against the same stubbed "download always misses"
 *  world (Genie fetches fail → null; QStash enqueues are captured, not sent). */

import { assert, assertEquals } from "#assert";
import { stepInit } from "./mod.ts";
import { getFinding, saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueIds(tag: string): { orgId: OrgId; findingId: string } {
  const t = crypto.randomUUID().slice(0, 8);
  return { orgId: (`test-si-${tag}-${t}`) as unknown as OrgId, findingId: `f-si-${tag}-${t}` };
}

function setupEnv(): void {
  Deno.env.set("QSTASH_TOKEN", "test-stub-token");
  Deno.env.set("LOCAL_QUEUE", "");
  // Leave GENIE_* unset so every download attempt misses.
}

/** Capture QStash enqueues (by the /audit/step/<step> in the callback URL) and
 *  make every other fetch — the Genie login/search/download — a hard miss.
 *
 *  Also collapses setTimeout so the Genie module's internal exponential backoff
 *  (2+4+8+16s per role) fires instantly: without this the miss path takes ~60s
 *  of real sleeping, none of it exercising the branch under test. */
function installStubs(): { restore: () => void; steps: string[] } {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const steps: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    // Storage is real HTTP now — Firestore emulator (:8099), the S3 stand-in
    // (:9001) and the token stub (:9003). Let those through; answering them
    // from this stub hands Firestore an empty 200 and S3 a 500. The queue
    // (:9002) is deliberately NOT passed through: these tests assert on what
    // was enqueued, so the stub still has to capture it.
    if ([":8099", ":9001", ":9003"].some((port) => url.includes(port))) return originalFetch(input, init);
    const m = url.match(/\/audit\/step\/([a-z-]+)/);
    if (m) {
      steps.push(m[1]);
      return new Response(JSON.stringify({ messageId: "stub" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    // Genie (and anything else) fails → downloadRecording yields null.
    return new Response("", { status: 500 });
  }) as typeof globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
    originalSetTimeout(fn, 0, ...args)) as any;
  return {
    restore: () => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSetTimeout; },
    steps,
  };
}

function reqWith(body: Record<string, unknown>): Request {
  return new Request("https://test.local/audit/step/init", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

Deno.test("init — step function exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.stepInit === "function");
});

Deno.test({ name: "stepInit — skipGenieRetry makes a still-missing recording finalize on the first miss (no ladder)", ...kvOpts, fn: async () => {
  setupEnv();
  const { orgId, findingId } = uniqueIds("skip");
  const stub = installStubs();
  try {
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "pending",
      recordingId: "27624059", // 8-digit, starts with 2 → normally retryable
      record: { RecordId: "493900" },
      auditJobId: "job-si",
      skipGenieRetry: true,
    });

    await stepInit(reqWith({ findingId, orgId }));

    const after = (await getFinding(orgId, findingId))!;
    assertEquals(after.rawTranscript, "Invalid Genie", "finalized, not parked for retry");
    assertEquals(after.findingStatus, "finished");
    assertEquals(after.genieRetryAt, undefined, "no 10-min retry was scheduled");
    assert(stub.steps.includes("finalize"), "should hand off straight to finalize");
    assert(!stub.steps.includes("init"), "must NOT re-enqueue init for a delayed retry");
  } finally {
    stub.restore();
  }
}});

Deno.test({ name: "stepInit — WITHOUT the flag, the same miss schedules the normal retry ladder", ...kvOpts, fn: async () => {
  setupEnv();
  const { orgId, findingId } = uniqueIds("ladder");
  const stub = installStubs();
  try {
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "pending",
      recordingId: "27624059",
      record: { RecordId: "493900" },
      auditJobId: "job-si",
      // no skipGenieRetry
    });

    await stepInit(reqWith({ findingId, orgId }));

    const after = (await getFinding(orgId, findingId))!;
    assertEquals(after.genieAttempts, 1, "first retry attempt recorded");
    assert(typeof after.genieRetryAt === "number" && after.genieRetryAt > 0, "retry time set");
    assert(after.rawTranscript !== "Invalid Genie", "not finalized yet — it will retry");
    assert(stub.steps.includes("init"), "re-enqueues init for the delayed retry");
    assert(!stub.steps.includes("finalize"), "must not finalize while retries remain");
  } finally {
    stub.restore();
  }
}});
