/** Tests for watchdog stuck-finding detection logic. */

import { assertEquals, assert } from "#assert";
import { resolveStep, runWatchdog, getStuckFindings } from "./mod.ts";
import { setStored, getStored, resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

interface StuckFinding {
  orgId: string; findingId: string; step: string; ts: number; ageMs: number;
}

/** Pure detection logic extracted for testing (no KV dependency). */
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
    { orgId: "o1", findingId: "f1", step: "transcribe", ts: now - 35 * 60 * 1000 }, // 35 min old
    { orgId: "o1", findingId: "f2", step: "ask-all", ts: now - 5 * 60 * 1000 },     // 5 min old (ok)
    { orgId: "o1", findingId: "f3", step: "finalize", ts: now - 60 * 60 * 1000 },   // 60 min old
  ];
  const stuck = detectStuck(entries, now, 30 * 60 * 1000);
  assertEquals(stuck.length, 2);
  assertEquals(stuck[0].findingId, "f1");
  assertEquals(stuck[1].findingId, "f3");
});

Deno.test("watchdog — no stuck findings returns empty", () => {
  const now = Date.now();
  const entries = [
    { orgId: "o1", findingId: "f1", step: "init", ts: now - 1000 },
  ];
  assertEquals(detectStuck(entries, now, 30 * 60 * 1000).length, 0);
});

Deno.test("watchdog — empty entries returns empty", () => {
  assertEquals(detectStuck([], Date.now(), 30 * 60 * 1000).length, 0);
});

Deno.test("watchdog — ageMs calculated correctly", () => {
  const now = 100_000;
  const entries = [{ orgId: "o1", findingId: "f1", step: "init", ts: 50_000 }];
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
// stops resurfacing every hour. Uses the in-memory Firestore fallback.
Deno.test({ name: "watchdog — skips + clears stale tracking for an already-terminal finding (no re-dispatch)", ...kvOpts, fn: async () => {
  resetFirestoreCredentials(); // in-mem, isolated from other suites
  const ORG = "wd-term" as OrgId;
  const fid = "wd-finished-1";
  // Finding already finished, but a stale active-tracking row was left behind
  // (40 min old) pointing at an early step.
  await saveFinding(ORG, { id: fid, findingStatus: "finished", answeredQuestions: [{ header: "Q1", answer: "Yes" }] });
  await setStored("active-tracking", ORG, [fid], { findingId: fid, step: "ask-all", ts: Date.now() - 40 * 60 * 1000 });

  assertEquals((await getStuckFindings()).length, 1, "pre-condition: watchdog sees it as stuck");

  const { recovered, skippedTerminal } = await runWatchdog();
  assertEquals(recovered, 0, "terminal finding must NOT be re-dispatched");
  assertEquals(skippedTerminal, 1, "terminal finding counted as skipped");

  assertEquals(await getStored("active-tracking", ORG, fid), null, "stale active-tracking row deleted");
  assertEquals((await getStuckFindings()).length, 0, "no longer resurfaces as stuck");
}});

// Sanity: a genuinely stuck NON-terminal finding is still detected (not cleared).
Deno.test({ name: "watchdog — leaves a non-terminal stuck finding for re-dispatch", ...kvOpts, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "wd-active" as OrgId;
  const fid = "wd-stuck-1";
  await saveFinding(ORG, { id: fid, findingStatus: "asking-questions", answeredQuestions: [] });
  await setStored("active-tracking", ORG, [fid], { findingId: fid, step: "ask-all", ts: Date.now() - 40 * 60 * 1000 });

  const stuck = await getStuckFindings();
  assertEquals(stuck.length, 1);
  assert(stuck[0].findingId === fid, "non-terminal finding is detected as stuck");
  // (runWatchdog would publishStep here — that path needs QStash, so we only
  //  assert detection + that the row is NOT pre-emptively cleared.)
  assert((await getStored("active-tracking", ORG, fid)) !== null, "row preserved for re-dispatch");
}});
