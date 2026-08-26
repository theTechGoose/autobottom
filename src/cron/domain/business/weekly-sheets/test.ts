/** Tests for weekly sheets date window calculation + cron idempotency. */

import { assertEquals } from "#assert";
import { prevWeekWindow, isWeeklySheetsFireTime, isJobSlot, runWeeklySheetsExport, normKeyCell, rowKey, postedKeys } from "./mod.ts";
import { getStored, resetFirestoreCredentials, setStored } from "@core/data/firestore/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";

/** Eastern wall clock for an instant — the window is ET-anchored, so asserting
 *  with the runner's local getDay()/getHours() would only pass on an ET box. */
const et = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

Deno.test("prevWeekWindow — Tuesday's run covers the previous Mon-Sun in ET", () => {
  // Tuesday April 14, 2026, 9am ET (13:00Z, EDT).
  const { since, until } = prevWeekWindow(new Date("2026-04-14T13:00:00Z"));
  assertEquals(et(since), "Mon, 04/06, 00:00:00");
  assertEquals(et(until), "Sun, 04/12, 23:59:59");
});

Deno.test("prevWeekWindow — same week no matter which day it fires", () => {
  // The old form keyed off "yesterday", so a fire-day slip moved the window.
  // Every day of the week of Apr 13-19 must resolve to Apr 6-12.
  for (const day of ["13", "14", "15", "16", "17", "18", "19"]) {
    const { since, until } = prevWeekWindow(new Date(`2026-04-${day}T11:00:00Z`));
    assertEquals(et(since), "Mon, 04/06, 00:00:00", `since drifted on Apr ${day}`);
    assertEquals(et(until), "Sun, 04/12, 23:59:59", `until drifted on Apr ${day}`);
  }
});

Deno.test("prevWeekWindow — spans the spring DST change without losing an hour", () => {
  // US DST began Sun Mar 8, 2026 — inside the Mar 2-8 window this returns.
  const { since, until } = prevWeekWindow(new Date("2026-03-10T11:00:00Z"));
  assertEquals(et(since), "Mon, 03/02, 00:00:00");
  assertEquals(et(until), "Sun, 03/08, 23:59:59");
  // 7 days minus the lost hour, minus the 1ms the end-boundary gives back.
  assertEquals(until - since, 7 * 86_400_000 - 3_600_000 - 1);
});

Deno.test("isJobSlot — chargebacks' Tuesday 9am ET slot, still correct while paused", () => {
  const cb = (iso: string) => isJobSlot("chargebacks", new Date(iso));
  assertEquals(cb("2026-04-14T12:59:00Z"), false); // Tue 8:59am ET
  assertEquals(cb("2026-04-14T13:00:00Z"), true);  // Tue 9:00am ET
  assertEquals(cb("2026-04-14T15:00:00Z"), true);  // Tue 11am ET — catch-up
  assertEquals(cb("2026-04-14T11:00:00Z"), false); // Tue 7am ET — the old slot
  assertEquals(cb("2026-04-15T13:00:00Z"), false); // Wed
  assertEquals(cb("2026-04-13T13:00:00Z"), false); // Mon — that's wire's day now
  assertEquals(cb("2026-04-12T13:00:00Z"), false); // Sun — the old misfire day
  // Standard time: 9am ET is 14:00Z, so a fixed-UTC-hour schedule would slip.
  assertEquals(cb("2026-01-13T14:00:00Z"), true);  // Tue 9:00am EST
  assertEquals(cb("2026-01-13T13:00:00Z"), false); // Tue 8:00am EST
});

Deno.test("isJobSlot — wire on Monday, never the same day as chargebacks", () => {
  const wire = (iso: string) => isJobSlot("wire", new Date(iso));
  assertEquals(wire("2026-04-13T12:59:00Z"), false); // Mon 8:59am ET
  assertEquals(wire("2026-04-13T13:00:00Z"), true);  // Mon 9:00am ET
  assertEquals(wire("2026-04-13T20:00:00Z"), true);  // Mon 4pm ET — catch-up
  assertEquals(wire("2026-04-14T13:00:00Z"), false); // Tue — chargebacks' day
  assertEquals(wire("2026-04-12T13:00:00Z"), false); // Sun
  // No hour of any day may fire both jobs — that is what the split means.
  for (const day of ["12", "13", "14", "15", "16", "17", "18"]) {
    for (const hour of ["00", "09", "13", "18", "23"]) {
      const at = new Date(`2026-04-${day}T${hour}:00:00Z`);
      const both = isJobSlot("wire", at) && isJobSlot("chargebacks", at);
      assertEquals(both, false, `both jobs fired on Apr ${day} ${hour}:00Z`);
    }
  }
});

Deno.test("normKeyCell — a date matches however the sheet renders it back", () => {
  // Appends are USER_ENTERED, so "8/5/2026" comes back re-rendered.
  const written = normKeyCell("8/5/2026");
  assertEquals(written, "2026-08-05");
  assertEquals(normKeyCell("08/05/2026"), written);
  assertEquals(normKeyCell("2026-08-05"), written);
  assertEquals(normKeyCell("8-5-2026"), written);
  // Non-dates pass through, case-folded.
  assertEquals(normKeyCell("https://X.quickbase.com/db/a?rid=1"), "https://x.quickbase.com/db/a?rid=1");
  assertEquals(normKeyCell(""), "");
});

Deno.test("rowKey — blank key column means never suppress the row", () => {
  const row = ["8/5/2026", "Jane", "1000", "https://qb/db/x?rid=496199", "SMD", "Q1", "88%", "GS WST"];
  assertEquals(rowKey(row, [0, 3]), "2026-08-05|https://qb/db/x?rid=496199");
  // A missing CRM link can't identify a row — losing real data beats a dupe.
  assertEquals(rowKey(["8/5/2026", "Jane", "", "", ""], [0, 3]), "");
});

Deno.test("postedKeys — the week of Aug 3 can't be posted a second time", () => {
  // What the Sunday run left on the Chargebacks tab: column A (date) and D (CRM).
  const onSheet = [
    ["Date", "8/3/2026", "8/5/2026"],
    ["CRM Link", "https://qb/db/x?rid=1", "https://qb/db/x?rid=2"],
  ];
  const posted = postedKeys(onSheet);
  const candidates = [
    ["8/3/2026", "Ann", "", "https://qb/db/x?rid=1", "", "", "", ""], // already there
    ["8/9/2026", "Bo", "", "https://qb/db/x?rid=3", "", "", "", ""],  // Sunday, genuinely new
  ];
  const fresh = candidates.filter((r) => {
    const k = rowKey(r, [0, 3]);
    return !k || !posted.has(k);
  });
  assertEquals(fresh.length, 1);
  assertEquals(fresh[0][3], "https://qb/db/x?rid=3");
});

/** Mark a week as successfully posted, the way a finished export does.
 *  Sheets aren't configured under test, so a real run can only ever fail —
 *  the `done` marker has to be written directly to exercise the skip path. */
const markPosted = (job: "wire" | "chargebacks", now: Date) =>
  setStored(
    "weekly-sheets-claim", defaultOrgId(), [job, prevWeekWindow(now).since],
    { job, since: prevWeekWindow(now).since, status: "done", at: 0 },
    { expireInMs: 8 * 24 * 60 * 60 * 1000 },
  );

Deno.test("runWeeklySheetsExport — a POSTED week is never posted again", async () => {
  resetFirestoreCredentials(); // in-memory firestore
  const now = new Date("2026-04-14T13:00:00Z");
  await markPosted("chargebacks", now);
  const second = await runWeeklySheetsExport("chargebacks", now);
  assertEquals(second.skipped, true);
  assertEquals(second.appended, 0);
});

Deno.test("runWeeklySheetsExport — a FAILED run releases the week so the next tick retries", async () => {
  // The 2026-08-18 outage: the claim was taken before the work and never
  // released, so one dead run burned the week and every later tick logged
  // "already posted" over an empty sheet. A failed run must leave no claim.
  const now = new Date("2026-04-28T13:00:00Z");
  const first = await runWeeklySheetsExport("chargebacks", now);
  assertEquals(typeof first.error, "string"); // sheets unconfigured under test
  assertEquals(first.skipped, undefined);
  const claim = await getStored("weekly-sheets-claim", defaultOrgId(), "chargebacks", prevWeekWindow(now).since);
  assertEquals(claim, null); // released
  // ...so the next tick actually retries instead of skipping.
  assertEquals((await runWeeklySheetsExport("chargebacks", now)).skipped, undefined);
});

Deno.test("runWeeklySheetsExport — wire's claim doesn't block chargebacks", async () => {
  // A LATER week than the tests above on purpose: the claims are real writes to
  // the shared in-memory store, and re-resetting it mid-suite breaks tests in
  // other files that lean on it.
  //
  // Both jobs cover the SAME Mon-Sun window, one day apart. Keyed on the window
  // alone, Monday's wire run would claim the week and Tuesday would skip.
  const monday = new Date("2026-04-20T13:00:00Z");
  const tuesday = new Date("2026-04-21T13:00:00Z");
  assertEquals(prevWeekWindow(monday).since, prevWeekWindow(tuesday).since);
  await markPosted("wire", monday);
  const cb = await runWeeklySheetsExport("chargebacks", tuesday);
  assertEquals(cb.skipped, undefined); // ran — not blocked by wire's posted week
  assertEquals((await runWeeklySheetsExport("wire", monday)).skipped, true);
});

// ── Tuesday paused (2026-08-26) ───────────────────────────────────────────────

Deno.test("isWeeklySheetsFireTime — chargebacks never fires on a schedule while paused", () => {
  // Every hour of the week, including its own Tuesday 9am slot.
  for (const day of ["12", "13", "14", "15", "16", "17", "18"]) {
    for (const hour of ["00", "09", "12", "13", "14", "18", "23"]) {
      const at = new Date(`2026-04-${day}T${hour}:00:00Z`);
      assertEquals(
        isWeeklySheetsFireTime("chargebacks", at), false,
        `paused chargebacks fired on Apr ${day} ${hour}:00Z`,
      );
    }
  }
  // Standard time too — the DST path must not sneak past the pause.
  assertEquals(isWeeklySheetsFireTime("chargebacks", new Date("2026-01-13T14:00:00Z")), false);
});

Deno.test("isWeeklySheetsFireTime — pausing chargebacks left wire's Monday run alone", () => {
  assertEquals(isWeeklySheetsFireTime("wire", new Date("2026-04-13T13:00:00Z")), true);  // Mon 9am ET
  assertEquals(isWeeklySheetsFireTime("wire", new Date("2026-04-13T20:00:00Z")), true);  // Mon 4pm — catch-up
  assertEquals(isWeeklySheetsFireTime("wire", new Date("2026-04-13T12:59:00Z")), false); // Mon 8:59am
  assertEquals(isWeeklySheetsFireTime("wire", new Date("2026-01-12T14:00:00Z")), true);  // Mon 9am EST
});

Deno.test("chargebacks' slot math still resolves — so un-pausing restores Tuesday", () => {
  // isJobSlot is what isWeeklySheetsFireTime falls through to once paused=false.
  assertEquals(isJobSlot("chargebacks", new Date("2026-04-14T13:00:00Z")), true);
  assertEquals(isJobSlot("chargebacks", new Date("2026-04-14T12:59:00Z")), false);
});
