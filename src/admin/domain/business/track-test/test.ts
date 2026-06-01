/** Smoke tests for the email-tracking spike — token parsing + hit round-trip
 *  via the in-memory Firestore fallback (no creds = in-mem store). */

import { assertEquals, assert } from "#assert";
import { makeTid, parseTid, recordHit, listTrackingHits, TRANSPARENT_GIF } from "./mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = ("track-test-" + crypto.randomUUID().slice(0, 8)) as OrgId;

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.test/track/pixel", { headers });
}

Deno.test("makeTid/parseTid — round-trips label + sentAt", () => {
  const tid = makeTid("Workspace");
  const { label, sentAt } = parseTid(tid);
  assertEquals(label, "workspace"); // sanitized lowercase
  assert(sentAt > 0, "sentAt parsed");
  assertEquals(tid.split(".").length, 3);
});

Deno.test("makeTid — sanitizes unsafe labels", () => {
  assertEquals(parseTid(makeTid("Gmail!! 123")).label, "gmail123");
  assertEquals(parseTid(makeTid("")).label, "other");
});

Deno.test("TRANSPARENT_GIF — valid 1x1 gif header", () => {
  // "GIF89a" magic
  assertEquals(String.fromCharCode(...TRANSPARENT_GIF.slice(0, 6)), "GIF89a");
});

Deno.test({ name: "recordHit + listTrackingHits — captures kind/ua/ip and computes msSinceSend", ...kvOpts, fn: async () => {
  const sentAt = Date.now() - 5000;
  const tid = `gmail.${sentAt}.abcd1234`;
  await recordHit("pixel", tid, ORG, reqWith({ "user-agent": "TestAgent/1.0", "x-forwarded-for": "203.0.113.5, 10.0.0.1" }));
  await recordHit("click", tid, ORG, reqWith({ "user-agent": "TestAgent/2.0", "x-forwarded-for": "203.0.113.9" }));

  // Note: sends are listed from track-test-send docs; here we only recorded
  // hits, so listTrackingHits (driven by sends) won't surface them without a
  // send doc. Validate the hits were stored by reading them back directly.
  const { listStoredWithKeys } = await import("@core/data/firestore/mod.ts");
  const hits = (await listStoredWithKeys<{ tid: string; kind: string; ua: string; ip: string; msSinceSend: number }>("track-test-hit", ORG))
    .map((r) => r.value)
    .filter((h) => h.tid === tid)
    .sort((a, b) => a.kind.localeCompare(b.kind));
  assertEquals(hits.length, 2);
  const click = hits.find((h) => h.kind === "click")!;
  const pixel = hits.find((h) => h.kind === "pixel")!;
  assertEquals(pixel.ip, "203.0.113.5"); // first XFF hop
  assertEquals(click.ua, "TestAgent/2.0");
  assert(pixel.msSinceSend >= 5000, "msSinceSend computed from tid sentAt");
}});

Deno.test({ name: "listTrackingHits — groups hits under their send, newest-first", ...kvOpts, fn: async () => {
  const { setStored } = await import("@core/data/firestore/mod.ts");
  const older = `gmail.${Date.now() - 20000}.aaaa1111`;
  const newer = `apple.${Date.now() - 1000}.bbbb2222`;
  await setStored("track-test-send", ORG, [older], { tid: older, toEmail: "a@x.com", label: "gmail", sentAt: Date.now() - 20000 });
  await setStored("track-test-send", ORG, [newer], { tid: newer, toEmail: "b@x.com", label: "apple", sentAt: Date.now() - 1000 });
  await recordHit("pixel", older, ORG, reqWith({ "user-agent": "UA" }));

  const results = (await listTrackingHits(ORG)).filter((r) => r.tid === older || r.tid === newer);
  assertEquals(results[0].tid, newer); // newest send first
  const olderResult = results.find((r) => r.tid === older)!;
  assertEquals(olderResult.hits.length, 1);
  assertEquals(olderResult.hits[0].kind, "pixel");
}});
