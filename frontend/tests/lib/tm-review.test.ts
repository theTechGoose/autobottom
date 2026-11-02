/** Pure rules behind the VO dashboard: the default date window (REQ-040) and
 *  how a queue splits into To Review / Reviewed once TM reviews are attached
 *  (REQ-035, REQ-037). */
import { assert, assertEquals } from "@std/assert";
import {
  attachTmReviews, splitVoQueue, voDefaultWindow, type TmReview,
} from "@core/business/tm-review/mod.ts";

/** Wall-clock ET → epoch ms, for readable fixtures. November 2026 is EST (UTC-5). */
const et = (iso: string) => Date.parse(iso + "-05:00");

Deno.test("REQ-040: on a Tuesday the default window is this Monday 00:00 ET through now", () => {
  const now = et("2026-11-03T14:30:00"); // Tuesday
  const w = voDefaultWindow(now);
  assertEquals(w.since, et("2026-11-02T00:00:00"));
  assertEquals(w.until, now);
});

Deno.test("REQ-040: on a Sunday the default window is the whole week, Monday through now", () => {
  const now = et("2026-11-08T21:00:00"); // Sunday
  const w = voDefaultWindow(now);
  assertEquals(w.since, et("2026-11-02T00:00:00"));
  assertEquals(w.until, now);
});

Deno.test("REQ-040: on a Monday the default window is the previous week, Monday through Sunday", () => {
  const now = et("2026-11-09T08:15:00"); // Monday
  const w = voDefaultWindow(now);
  assertEquals(w.since, et("2026-11-02T00:00:00"));
  assertEquals(w.until, et("2026-11-09T00:00:00") - 1);
});

Deno.test("REQ-040: Monday is decided in Eastern time, not UTC", () => {
  // 2026-11-10 02:00 UTC is still Monday 21:00 ET — a Monday, so last week.
  const now = Date.parse("2026-11-10T02:00:00Z");
  const w = voDefaultWindow(now);
  assertEquals(w.since, et("2026-11-02T00:00:00"));
  assertEquals(w.until, et("2026-11-09T00:00:00") - 1);
});

Deno.test("REQ-040: the window crosses the DST change on the right midnight", () => {
  // DST ended Sunday 2026-11-01; Wednesday 2026-10-28 is still EDT (UTC-4).
  const now = Date.parse("2026-10-28T16:00:00Z");
  const w = voDefaultWindow(now);
  assertEquals(w.since, Date.parse("2026-10-26T00:00:00-04:00"));
});

const review = (findingId: string, over: Partial<TmReview> = {}): TmReview => ({
  findingId, department: "VBA PM", note: "Listened to the call", reviewedBy: "vbapmvo@monsterrg.com",
  reviewedAt: 1_000, ...over,
});

Deno.test("REQ-035: a reviewed audit leaves To Review and lands on Reviewed", () => {
  const items = attachTmReviews(
    [{ findingId: "a", status: "pending" }, { findingId: "b", status: "pending" }],
    [review("b")],
  );
  const { pending, reviewed } = splitVoQueue(items);
  assertEquals(pending.map((i) => i.findingId), ["a"]);
  assertEquals(reviewed.map((i) => i.findingId), ["b"]);
  assertEquals(reviewed[0].tmReview?.note, "Listened to the call");
});

Deno.test("REQ-035: a manager remediating or skipping does not take an audit off the TM queue", () => {
  const { pending } = splitVoQueue(attachTmReviews(
    [{ findingId: "r", status: "remediated" }, { findingId: "s", status: "skipped" }],
    [],
  ));
  assertEquals(pending.map((i) => i.findingId).sort(), ["r", "s"]);
});

Deno.test("REQ-037: an appealed or re-audited audit is off the TM queue", () => {
  const { pending, reviewed } = splitVoQueue(attachTmReviews(
    [
      { findingId: "ap", status: "pending", appealState: "appealed" },
      { findingId: "re", status: "pending", appealState: "re-audited" },
    ],
    [],
  ));
  assertEquals(pending.length, 0);
  assertEquals(reviewed.map((i) => i.findingId).sort(), ["ap", "re"]);
});

Deno.test("REQ-038: attaching reviews leaves items with no review untouched", () => {
  const items = attachTmReviews([{ findingId: "x", status: "pending" }], [review("y")]);
  assert(!("tmReview" in items[0]));
});
