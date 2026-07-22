/** Tests for the retroactive Transcript Repair sweep.
 *
 *  The load-bearing guarantees, in order of how much damage getting them wrong
 *  would do:
 *    1. `scan` mode NEVER writes — it is the "how many are impacted?" button and
 *       the operator must be able to press it without changing anything.
 *    2. `repair` extracts the real transcript out of a commentary reply rather
 *       than nuking it back to raw (the 4oL3fw_Coxvzpx7El_qip incident).
 *    3. Clean transcripts are left completely alone.
 *    4. It is idempotent — a repaired row classifies `clean` on the next pass.
 *
 *  Firestore falls back to in-memory via resetFirestoreCredentials(). */

import { assert, assertEquals } from "#assert";
import { listTranscriptRepairFids, processTranscriptRepairBatch } from "./mod.ts";
import { resetFirestoreCredentials, setStored } from "@core/data/firestore/mod.ts";
import { getTranscript, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

function uniqueOrg(): OrgId {
  return ("test-trepair-" + crypto.randomUUID().slice(0, 8)) as unknown as OrgId;
}

const TURNS = [
  "[AGENT]: All right, I am back on that recorded line. Give me one second while I pull up your script.",
  "[CUSTOMER]: Sure, take your time.",
  "[AGENT]: And you are arriving August first and departing August fourth, is that correct?",
  "[CUSTOMER]: Yes, that is correct.",
  "[AGENT]: Can you verify your street address for me?",
  "[CUSTOMER]: It is 412 Willow Lane, Springfield.",
  "[AGENT]: Are you married or single?",
  "[CUSTOMER]: I am married.",
  "[AGENT]: Are you a United States or Canadian citizen?",
  "[CUSTOMER]: Yes, United States.",
  "[AGENT]: Before I let you go, how was my service today?",
  "[CUSTOMER]: It was great, thank you.",
].join("\n");

const RAW = TURNS.replace(/^\[(?:AGENT|CUSTOMER)\]:\s*/gm, "");

const F = "```";

/** The production shape: a markdown critique wrapping the real transcript. */
const COMMENTARY = [
  "**Review of the original transcription**",
  "",
  "| # | Original line | Issue identified |",
  "|---|---|---|",
  "| 1 | **[CUSTOMER]** All right. | This is actually the agent's opening statement. |",
  "",
  "**Summary of problems**",
  "",
  "1. **Mis-labelled opening line** - should be **[AGENT]**.",
  "",
  "## Corrected transcription",
  "",
  "Below is a revised version that obeys the required format:",
  "",
  F,
  TURNS,
  F,
  "",
  "### What was changed / added",
  "1. **Opening line** re-labelled as **[AGENT]**.",
].join("\n");

Deno.test({
  name: "transcript-repair — scan mode counts the damage and writes NOTHING",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await saveTranscript(orgId, "bad-1", RAW, COMMENTARY);
    await saveTranscript(orgId, "good-1", RAW, TURNS);

    const r = await processTranscriptRepairBatch(orgId, ["bad-1", "good-1"], "scan");
    assertEquals(r.scanned, 2);
    assertEquals(r.contaminated, 1);
    assertEquals(r.clean, 1);
    assertEquals(r.fenced, 1);
    assertEquals(r.repaired, 0, "scan mode must never write");

    // The offending text is still on disk, untouched, so a scan can be re-run.
    const stored = await getTranscript(orgId, "bad-1");
    assertEquals(stored?.diarized, COMMENTARY);
  },
});

Deno.test({
  name: "transcript-repair — scan surfaces an excerpt + fidelity for the operator",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await saveTranscript(orgId, "bad-1", RAW, COMMENTARY);

    const r = await processTranscriptRepairBatch(orgId, ["bad-1"], "scan");
    assertEquals(r.samples.length, 1);
    const s = r.samples[0];
    assertEquals(s.findingId, "bad-1");
    assertEquals(s.method, "fenced");
    assertEquals(s.storedLen, COMMENTARY.length);
    assert(s.repairedLen < s.storedLen, "the repaired text is the commentary minus the commentary");
    assert(s.excerpt.startsWith("**Review of the original transcription**"));
    assert((s.precision ?? 0) > 0, "fidelity is reported so the floors can be tuned on real data");
  },
});

Deno.test({
  name: "transcript-repair — repair lifts the transcript out of the commentary (4oL3fw… regression)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await saveTranscript(orgId, "bad-1", RAW, COMMENTARY);

    const r = await processTranscriptRepairBatch(orgId, ["bad-1"], "repair");
    assertEquals(r.contaminated, 1);
    assertEquals(r.repaired, 1);

    const stored = await getTranscript(orgId, "bad-1");
    assertEquals(stored?.diarized, TURNS, "the speaker turns survive — we do NOT nuke back to raw");
    assertEquals(stored?.raw, RAW, "the raw transcript is left alone");
    assert(!stored!.diarized.includes("Summary of problems"));
    assert(!stored!.diarized.includes("Corrected transcription"));
    assert(!stored!.diarized.includes("|"));
    assert(!stored!.diarized.includes("#"));
  },
});

Deno.test({
  name: "transcript-repair — repair is idempotent; a repaired row reads clean next pass",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await saveTranscript(orgId, "bad-1", RAW, COMMENTARY);

    await processTranscriptRepairBatch(orgId, ["bad-1"], "repair");
    const second = await processTranscriptRepairBatch(orgId, ["bad-1"], "repair");
    assertEquals(second.contaminated, 0);
    assertEquals(second.clean, 1);
    assertEquals(second.repaired, 0);
  },
});

Deno.test({
  name: "transcript-repair — a clean transcript is never rewritten",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    await saveTranscript(orgId, "good-1", RAW, TURNS);
    // diarized === raw is the existing raw-fallback shape — also already fine.
    await saveTranscript(orgId, "raw-fallback-1", RAW, RAW);

    const r = await processTranscriptRepairBatch(orgId, ["good-1", "raw-fallback-1"], "repair");
    assertEquals(r.clean, 2);
    assertEquals(r.contaminated, 0);
    assertEquals(r.repaired, 0);
    assertEquals((await getTranscript(orgId, "good-1"))?.diarized, TURNS);
  },
});

Deno.test({
  name: "transcript-repair — findings with no stored transcript are counted, not errors",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    const r = await processTranscriptRepairBatch(orgId, ["never-transcribed"], "scan");
    assertEquals(r.missing, 1);
    assertEquals(r.errors, 0);
    assertEquals(r.contaminated, 0);
  },
});

Deno.test({
  name: "transcript-repair — list dedupes an audit's multiple index rows, keeping the newest",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const orgId = uniqueOrg();
    const t1 = 1_700_000_000_000;
    const t2 = t1 + 60_000;
    const pad = (ts: number) => String(ts).padStart(15, "0");
    // Same audit indexed twice: once on completion, once after review.
    await setStored("audit-done-idx", orgId, [pad(t1), "fid-a"], { findingId: "fid-a", completedAt: t1, score: 96 });
    await setStored("audit-done-idx", orgId, [pad(t2), "fid-a"], { findingId: "fid-a", completedAt: t2, score: 100, reviewedBy: "mkelly@monsterrg.com" });
    await setStored("audit-done-idx", orgId, [pad(t1), "fid-b"], { findingId: "fid-b", completedAt: t1, score: 88 });

    const got = await listTranscriptRepairFids(orgId, t1 - 1000, t2 + 1000);
    assertEquals(got.length, 2, "one entry per audit, not per index row");
    const a = got.find((c) => c.findingId === "fid-a");
    assertEquals(a?.score, 100, "newest row wins");
    assertEquals(a?.reviewedBy, "mkelly@monsterrg.com", "so already-reviewed audits are visible in the scan");
  },
});
