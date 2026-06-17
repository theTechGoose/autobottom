/** Smoke tests for email-engagement — sign/verify, prefetch filter, dedup,
 *  tally math. Uses the in-memory Firestore fallback (no creds = in-mem). */

import { assertEquals, assert } from "#assert";
import {
  signFinding, verifyFinding, stampSent, recordOpen, recordClick, classifyUa,
  tallyEngagement, mapWithConcurrency, getEmailEngagement,
  OPEN_PREFETCH_WINDOW_MS, TRANSPARENT_GIF, type EmailMark,
} from "./mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = ("email-eng-" + crypto.randomUUID().slice(0, 8)) as OrgId;
const req = (ua?: string) =>
  new Request("https://example.test/track", ua ? { headers: { "user-agent": ua } } : undefined);

async function markOf(fid: string): Promise<EmailMark | null> {
  return getStored<EmailMark>("audit-email-mark", ORG, fid);
}

Deno.test("TRANSPARENT_GIF — valid gif header", () => {
  assertEquals(String.fromCharCode(...TRANSPARENT_GIF.slice(0, 6)), "GIF89a");
});

Deno.test("signFinding/verifyFinding — round-trips, rejects tampered sig", async () => {
  Deno.env.set("TRACK_LINK_SECRET", "test-secret-123");
  try {
    const sig = await signFinding("finding-abc");
    assert(await verifyFinding("finding-abc", sig), "valid sig accepted");
    assert(!(await verifyFinding("finding-abc", sig + "00")), "tampered sig rejected");
    assert(!(await verifyFinding("other-finding", sig)), "sig for different fid rejected");
  } finally {
    Deno.env.delete("TRACK_LINK_SECRET");
  }
});

Deno.test("verifyFinding — degrades to true when secret unset", async () => {
  Deno.env.delete("TRACK_LINK_SECRET");
  assert(await verifyFinding("any", "whatever"), "unset secret → permissive");
});

Deno.test({ name: "recordOpen — human open (Δ ≥ window) sets openedAt", ...kvOpts, fn: async () => {
  const fid = "f-open-human";
  await setStored("audit-email-mark", ORG, [fid], { findingId: fid, sentAt: Date.now() - (OPEN_PREFETCH_WINDOW_MS + 60_000) });
  await recordOpen(ORG, fid, req());
  const m = await markOf(fid);
  assert(m?.openedAt, "openedAt set for human open");
  assertEquals(m?.openPrefetchAt, undefined);
}});

Deno.test({ name: "recordOpen — prefetch (Δ < window) sets openPrefetchAt, not openedAt", ...kvOpts, fn: async () => {
  const fid = "f-open-prefetch";
  await setStored("audit-email-mark", ORG, [fid], { findingId: fid, sentAt: Date.now() - 2_000 });
  await recordOpen(ORG, fid, req());
  const m = await markOf(fid);
  assert(m?.openPrefetchAt, "openPrefetchAt set");
  assertEquals(m?.openedAt, undefined, "openedAt NOT set for prefetch");
}});

Deno.test({ name: "recordOpen — first open wins (dedup)", ...kvOpts, fn: async () => {
  const fid = "f-open-dedup";
  await setStored("audit-email-mark", ORG, [fid], { findingId: fid, sentAt: Date.now() - 100_000 });
  await recordOpen(ORG, fid, req());
  const first = (await markOf(fid))!.openedAt;
  await new Promise((r) => setTimeout(r, 5));
  await recordOpen(ORG, fid, req());
  assertEquals((await markOf(fid))!.openedAt, first, "openedAt unchanged on second open");
}});

Deno.test({ name: "recordClick — sets firstClickAt once", ...kvOpts, fn: async () => {
  const fid = "f-click";
  await stampSent(ORG, fid);
  await recordClick(ORG, fid, req());
  const first = (await markOf(fid))!.firstClickAt;
  assert(first, "firstClickAt set");
  await new Promise((r) => setTimeout(r, 5));
  await recordClick(ORG, fid, req());
  assertEquals((await markOf(fid))!.firstClickAt, first, "firstClickAt unchanged on second click");
}});

Deno.test("classifyUa — proxy vs real browser labels", () => {
  assertEquals(classifyUa("Mozilla/5.0 (...) GoogleImageProxy"), "Gmail proxy");
  assertEquals(classifyUa("YahooMailProxy/1.0"), "Yahoo proxy");
  assertEquals(classifyUa("Microsoft Office/16.0"), "Outlook");
  assertEquals(classifyUa("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"), "Chrome");
  assertEquals(classifyUa("Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17.0 Safari/605"), "Safari");
  assertEquals(classifyUa(""), "Unknown");
});

Deno.test({ name: "recordOpen — tracks lastOpenAt, openCount, source (most-recent open)", ...kvOpts, fn: async () => {
  const fid = "f-open-meta";
  await setStored("audit-email-mark", ORG, [fid], { findingId: fid, sentAt: Date.now() - 100_000 });
  await recordOpen(ORG, fid, req("Mozilla/5.0 (...) GoogleImageProxy"));
  const m1 = (await markOf(fid))!;
  assertEquals(m1.openCount, 1);
  assertEquals(m1.lastOpenSource, "Gmail proxy");
  assert(m1.lastOpenAt && m1.lastOpenAt === m1.openedAt, "lastOpenAt == first openedAt on first open");
  await new Promise((r) => setTimeout(r, 5));
  await recordOpen(ORG, fid, req("Mozilla/5.0 (...) Chrome/120.0 Safari/537.36"));
  const m2 = (await markOf(fid))!;
  assertEquals(m2.openCount, 2, "openCount increments");
  assertEquals(m2.openedAt, m1.openedAt, "first openedAt unchanged");
  assert(m2.lastOpenAt! > m1.lastOpenAt!, "lastOpenAt advances on repeat open");
  assertEquals(m2.lastOpenSource, "Chrome", "source reflects most-recent open");
}});

Deno.test({ name: "recordClick — tracks lastClickSource from real browser UA", ...kvOpts, fn: async () => {
  const fid = "f-click-src";
  await stampSent(ORG, fid);
  await recordClick(ORG, fid, req("Mozilla/5.0 (...) Chrome/120.0 Safari/537.36"));
  const m = (await markOf(fid))!;
  assertEquals(m.clickCount, 1);
  assertEquals(m.lastClickSource, "Chrome");
  assert(m.lastClickAt, "lastClickAt set");
}});

Deno.test("tallyEngagement — rates + appeals-among-opened/clicked", () => {
  const marks: Array<EmailMark | null> = [
    { findingId: "a", sentAt: 1, openedAt: 2, firstClickAt: 3 }, // sent, opened, clicked
    { findingId: "b", sentAt: 1, openedAt: 2 },                   // sent, opened, not clicked
    { findingId: "c", sentAt: 1 },                                // sent, not opened
    { findingId: "d", sentAt: 1, openPrefetchAt: 2 },             // sent, prefetch-only (not opened)
    null,                                                         // no mark (in cohort, never emailed)
  ];
  const appeals = [
    { findingId: "a" }, // appealed + opened + clicked
    null,
    { findingId: "c" }, // appealed but not opened
    null,
    null,
  ];
  const t = tallyEngagement(marks, appeals);
  assertEquals(t.total, 5);
  assertEquals(t.sent, 4);
  assertEquals(t.opened, 2);
  assertEquals(t.clicked, 1);
  assertEquals(t.appealed, 2);
  assertEquals(t.appealedAmongOpened, 1);
  assertEquals(t.appealedAmongClicked, 1);
  assertEquals(t.openRate, 50);     // 2/4
  assertEquals(t.clickRate, 25);    // 1/4
  assertEquals(t.appealRateAll, 40); // 2/5
  assertEquals(t.appealRateOpened, 50); // 1/2
  assertEquals(t.appealRateClicked, 100); // 1/1
});

Deno.test("tallyEngagement — divide-by-zero guards", () => {
  const t = tallyEngagement([null, null], [null, null]);
  assertEquals(t.openRate, 0);
  assertEquals(t.clickRate, 0);
  assertEquals(t.appealRateAll, 0);
  assertEquals(t.appealRateOpened, 0);
});

// ── Cap + throttle (the wide-window fan-out fix) ─────────────────────────────

Deno.test("mapWithConcurrency — preserves order, never exceeds the limit, handles empty", async () => {
  assertEquals(await mapWithConcurrency<number, number>([], 4, (x) => Promise.resolve(x)), []);

  const input = Array.from({ length: 20 }, (_, i) => i);
  let inFlight = 0, peak = 0;
  const out = await mapWithConcurrency(input, 4, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, (n % 5) * 2)); // varying delays
    inFlight--;
    return n * 10;
  });
  assertEquals(out, input.map((n) => n * 10), "results align with input order despite varying delays");
  assert(peak <= 4, `peak concurrency ${peak} must not exceed the limit (4)`);
});

Deno.test({ name: "getEmailEngagement — small cohort: not capped, full tally", ...kvOpts, fn: async () => {
  const SM_ORG = ("eng-small-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const base = 1_700_000_500_000;
  const fids = ["s-a", "s-b", "s-c"];
  await Promise.all(fids.map((findingId, i) =>
    writeAuditDoneIndex(SM_ORG, { findingId, completedAt: base + i, completed: true, score: 88, reason: "reviewed" }, { assumeFinished: true })));
  await setStored("audit-email-mark", SM_ORG, ["s-a"], { findingId: "s-a", sentAt: base, openedAt: base + 1, firstClickAt: base + 2 });
  await setStored("audit-email-mark", SM_ORG, ["s-b"], { findingId: "s-b", sentAt: base });
  // s-c: no mark (in cohort, never emailed)

  const e = await getEmailEngagement(SM_ORG, base - 1, base + 10);
  assertEquals(e.cohortSize, 3, "true cohort size");
  assertEquals(e.capped, false, "small cohort is not capped");
  assertEquals(e.total, 3, "tally covers the whole cohort");
  assertEquals(e.sent, 2);
  assertEquals(e.opened, 1);
  assertEquals(e.clicked, 1);
}});

Deno.test({ name: "getEmailEngagement — caps at HYDRATE_CAP, keeps most-recent, reports true cohortSize", ...kvOpts, fn: async () => {
  const CAP_ORG = ("eng-cap-" + crypto.randomUUID().slice(0, 8)) as OrgId;
  const base = 1_700_000_000_000;
  const N = 2001; // one over HYDRATE_CAP (2000)
  // Seed N index entries with strictly increasing completedAt (i = recency rank).
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      writeAuditDoneIndex(CAP_ORG, {
        findingId: `cap-f-${i}`, completedAt: base + i, completed: true, score: 90, reason: "reviewed",
      }, { assumeFinished: true })),
  );
  // Oldest finding (i=0, EXCLUDED by the cap) opened+clicked; a recent one
  // (i=N-1, INSIDE the cap) opened. If the cap keeps most-recent, only the
  // recent open counts and the excluded click never does.
  await setStored("audit-email-mark", CAP_ORG, ["cap-f-0"], { findingId: "cap-f-0", sentAt: base, openedAt: base + 1, firstClickAt: base + 2 });
  await setStored("audit-email-mark", CAP_ORG, [`cap-f-${N - 1}`], { findingId: `cap-f-${N - 1}`, sentAt: base, openedAt: base + 1 });

  const e = await getEmailEngagement(CAP_ORG, base - 1, base + N + 1);
  assertEquals(e.cohortSize, N, "cohortSize is the true cohort count, not the sample");
  assert(e.capped, "capped flag set when cohort exceeds HYDRATE_CAP");
  assertEquals(e.total, 2000, "tally covers only the most-recent HYDRATE_CAP audits");
  assertEquals(e.opened, 1, "only the recent (sampled) open counts");
  assertEquals(e.clicked, 0, "the excluded oldest finding's click is not counted");
}});
