/** Tests for watchdog stuck-finding detection logic. */

import { assertEquals, assert } from "#assert";
import { resolveStep, runWatchdog, getStuckFindings, STUCK_THRESHOLD_MS } from "./mod.ts";
import { ACTIVE_REAP_MS } from "@audit/domain/data/stats-repository/mod.ts";
import { setStored, getStored, deleteStored, resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

interface StuckFinding {
  orgId: string; findingId: string; step: string; ts: number; ageMs: number;
}

/** Pure detection logic extracted for testing (no KV dependency). */
// One org per run — the emulator database outlives the process.
const WD_RUN = crypto.randomUUID().slice(0, 8);
const WD_ORG = `o1-${WD_RUN}`;
const WD_TERM_ORG = `wd-term-${WD_RUN}`;

function detectStuck(
  entries: Array<{ orgId: string; findingId: string; step: string; ts: number }>,
  now: number,
  thresholdMs: number,
): StuckFinding[] {
  return entries
    .map((e) => ({ ...e, ageMs: now - e.ts }))
    .filter((e) => e.ageMs > thresholdMs);
}

Deno.test("watchdog — detects stuck findings over threshold", () => {
  const now = Date.now();
  const entries = [
    { orgId: WD_ORG, findingId: "f1", step: "transcribe", ts: now - 35 * 60 * 1000 }, // 35 min old
    { orgId: WD_ORG, findingId: "f2", step: "ask-all", ts: now - 5 * 60 * 1000 },     // 5 min old (ok)
    { orgId: WD_ORG, findingId: "f3", step: "finalize", ts: now - 60 * 60 * 1000 },   // 60 min old
  ];
  const stuck = detectStuck(entries, now, 30 * 60 * 1000);
  assertEquals(stuck.length, 2);
  assertEquals(stuck[0].findingId, "f1");
  assertEquals(stuck[1].findingId, "f3");
});

Deno.test("watchdog — no stuck findings returns empty", () => {
  const now = Date.now();
  const entries = [
    { orgId: WD_ORG, findingId: "f1", step: "init", ts: now - 1000 },
  ];
  assertEquals(detectStuck(entries, now, 30 * 60 * 1000).length, 0);
});

Deno.test("watchdog — empty entries returns empty", () => {
  assertEquals(detectStuck([], Date.now(), 30 * 60 * 1000).length, 0);
});

Deno.test("watchdog — ageMs calculated correctly", () => {
  const now = 100_000;
  const entries = [{ orgId: WD_ORG, findingId: "f1", step: "init", ts: 50_000 }];
  const stuck = detectStuck(entries, now, 10_000);
  assertEquals(stuck[0].ageMs, 50_000);
});

Deno.test("watchdog — resolveStep maps non-step labels to init", () => {
  // "queued" (audit controller) and "genie-retry" (step-init) are display
  // labels, not dispatchable steps — they must re-publish as `init`.
  assertEquals(resolveStep("queued"), "init");
  assertEquals(resolveStep("genie-retry"), "init");
});

Deno.test("watchdog — resolveStep passes real steps through unchanged", () => {
  for (const step of ["init", "transcribe", "poll-transcript", "prepare", "ask-all", "finalize", "cleanup"]) {
    assertEquals(resolveStep(step), step);
  }
});

// Terminal-status guard: a stale active-tracking row on an already-finished
// finding must NOT be re-dispatched (that would re-prepare a done audit, flip it
// back to "asking-questions", and strand the reviewer). It must be cleared so it
// stops resurfacing every hour. getStuckFindings() scans every org, so these
// assertions are scoped to this test's own finding rather than to a globally
// empty database.
Deno.test({ name: "watchdog — skips + clears stale tracking for an already-terminal finding (no re-dispatch)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = WD_TERM_ORG as OrgId;
  const fid = "wd-finished-" + WD_RUN;
  // Finding already finished, but a stale active-tracking row was left behind
  // (40 min old) pointing at an early step.
  await saveFinding(ORG, { id: fid, findingStatus: "finished", answeredQuestions: [{ header: "Q1", answer: "Yes" }] });
  await setStored("active-tracking", ORG, [fid], { findingId: fid, step: "ask-all", ts: Date.now() - 40 * 60 * 1000 });

  const mine = async () => (await getStuckFindings()).filter((f) => f.findingId === fid);
  assertEquals((await mine()).length, 1, "pre-condition: watchdog sees it as stuck");

  const { recovered, skippedTerminal } = await runWatchdog();
  assertEquals(recovered, 0, "terminal finding must NOT be re-dispatched");
  assert(skippedTerminal >= 1, "terminal finding counted as skipped");

  assertEquals(await getStored("active-tracking", ORG, fid), null, "stale active-tracking row deleted");
  assertEquals((await mine()).length, 0, "no longer resurfaces as stuck");
}});

// Sanity: a genuinely stuck NON-terminal finding is still detected (not cleared).
Deno.test({ name: "watchdog — leaves a non-terminal stuck finding for re-dispatch", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = `wd-active-${WD_RUN}` as OrgId;
  const fid = "wd-stuck-" + WD_RUN;
  await saveFinding(ORG, { id: fid, findingStatus: "asking-questions", answeredQuestions: [] });
  await setStored("active-tracking", ORG, [fid], { findingId: fid, step: "ask-all", ts: Date.now() - 40 * 60 * 1000 });

  const stuck = (await getStuckFindings()).filter((f) => f.findingId === fid);
  assertEquals(stuck.length, 1, "non-terminal finding is detected as stuck");
  // (runWatchdog would publishStep here — that path needs QStash, so we only
  //  assert detection + that the row is NOT pre-emptively cleared.)
  assert((await getStored("active-tracking", ORG, fid)) !== null, "row preserved for re-dispatch");
  // Storage outlives the process now, and runWatchdog() scans every org: leave
  // this row behind and the NEXT run recovers it, breaking the sibling test's
  // "recovered === 0".
  await deleteStored("active-tracking", ORG, fid);
}});

// ── Recovery-window invariant + dual-store reads ────────────────────────────
// These pin the two defects that let QqzfObJYP5aibL_YT6AHX hang at
// "transcribing" for 4 days with zero recovery attempts.

Deno.test("watchdog — stuck threshold stays inside the dashboard's reap window", () => {
  // The dashboard stats read DELETES active-tracking rows older than
  // ACTIVE_REAP_MS. If that ever drops to (or below) STUCK_THRESHOLD_MS, the
  // watchdog's evidence is destroyed before it looks and stuck findings become
  // permanently unrecoverable — the exact production failure this guards.
  assert(
    STUCK_THRESHOLD_MS < ACTIVE_REAP_MS,
    `stuck threshold (${STUCK_THRESHOLD_MS}ms) must be < reap window (${ACTIVE_REAP_MS}ms)`,
  );
  // And at least one hourly tick must fit between them.
  assert(ACTIVE_REAP_MS - STUCK_THRESHOLD_MS >= 60 * 60 * 1000, "at least one hourly tick must fit in the window");
});

Deno.test({ name: "watchdog — recovers a finding whose primary row is gone but backup row survives", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = `wd-backup-${WD_RUN}` as OrgId;
  const fid = "wd-backup-only-" + WD_RUN;
  await saveFinding(ORG, { id: fid, findingStatus: "transcribing", answeredQuestions: [] });
  // No active-tracking row at all — simulates the dashboard reaping it early.
  // Only the GLOBAL watchdog-active backup remains. Before the fix the watchdog
  // read only active-tracking, so this finding was invisible forever.
  await setStored("watchdog-active", "" as OrgId, [fid], {
    orgId: ORG, findingId: fid, step: "transcribe", ts: Date.now() - 40 * 60 * 1000,
  });

  const mine = (await getStuckFindings()).filter((f) => f.findingId === fid);
  assertEquals(mine.length, 1, "backup-only row is detected as stuck");
  assertEquals(mine[0].orgId, ORG, "org comes from the backup row's value, not id parsing");
  assertEquals(mine[0].step, "transcribe");

  await deleteStored("watchdog-active", "" as OrgId, fid);
}});

Deno.test({ name: "watchdog — a finding in BOTH stores is reported once, not twice", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = `wd-dual-${WD_RUN}` as OrgId;
  const fid = "wd-dual-" + WD_RUN;
  const ts = Date.now() - 40 * 60 * 1000;
  await saveFinding(ORG, { id: fid, findingStatus: "transcribing", answeredQuestions: [] });
  await setStored("active-tracking", ORG, [fid], { findingId: fid, step: "transcribe", ts });
  await setStored("watchdog-active", "" as OrgId, [fid], { orgId: ORG, findingId: fid, step: "transcribe", ts });

  // Double-dispatch would re-run the same step twice in one tick.
  const mine = (await getStuckFindings()).filter((f) => f.findingId === fid);
  assertEquals(mine.length, 1, "deduped across the two stores");

  await deleteStored("active-tracking", ORG, fid);
  await deleteStored("watchdog-active", "" as OrgId, fid);
}});

Deno.test({ name: "watchdog — clearing a terminal finding removes BOTH tracking rows", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = `wd-clear2-${WD_RUN}` as OrgId;
  const fid = "wd-clear2-" + WD_RUN;
  const ts = Date.now() - 40 * 60 * 1000;
  await saveFinding(ORG, { id: fid, findingStatus: "finished", answeredQuestions: [{ header: "Q1", answer: "Yes" }] });
  await setStored("active-tracking", ORG, [fid], { findingId: fid, step: "ask-all", ts });
  await setStored("watchdog-active", "" as OrgId, [fid], { orgId: ORG, findingId: fid, step: "ask-all", ts });

  await runWatchdog();

  // Clearing only active-tracking would let the backup resurface this finished
  // finding on every hourly tick until its TTL expired.
  assertEquals(await getStored("active-tracking", ORG, fid), null, "primary row cleared");
  assertEquals(await getStored("watchdog-active", "" as OrgId, fid), null, "backup row cleared too");
  assertEquals((await getStuckFindings()).filter((f) => f.findingId === fid).length, 0, "does not resurface");
}});
