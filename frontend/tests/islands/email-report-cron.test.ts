/** Unit tests for the weekly editor's time↔cron conversion. This is the
 *  `sendTimeEst → schedule.cron` migration: the "sends nightly at HH:MM" picker
 *  produces a Daily cron, and reopening a saved report must show the same time
 *  back (round-trip), or the editor would silently reset / clobber the time. */
import { assertEquals } from "@std/assert";
import { presetShapeToCron, parseCronToShape } from "../../islands/EmailReportEditor.tsx";

Deno.test("nightly time → Daily cron (the sendTimeEst migration)", () => {
  assertEquals(presetShapeToCron({ preset: "Daily", timeOfDay: "20:00" }), { cron: "0 20 * * *", tz: "America/New_York" });
  assertEquals(presetShapeToCron({ preset: "Daily", timeOfDay: "09:00" }), { cron: "0 9 * * *", tz: "America/New_York" });
  assertEquals(presetShapeToCron({ preset: "Daily", timeOfDay: "23:59" }), { cron: "59 23 * * *", tz: "America/New_York" });
});

Deno.test("Disabled / Custom presets emit no schedule", () => {
  assertEquals(presetShapeToCron({ preset: "Disabled", timeOfDay: "09:00" }), null);
  assertEquals(presetShapeToCron({ preset: "Custom", timeOfDay: "09:00" }), null);
});

Deno.test("Daily cron → shape shows the saved time back", () => {
  assertEquals(parseCronToShape("0 20 * * *"), { preset: "Daily", timeOfDay: "20:00" });
  assertEquals(parseCronToShape("0 9 * * *"), { preset: "Daily", timeOfDay: "09:00" });
});

Deno.test("time round-trips through cron unchanged (no reset on reopen)", () => {
  for (const t of ["00:00", "06:30", "09:00", "13:45", "20:00", "23:59"]) {
    const cron = presetShapeToCron({ preset: "Daily", timeOfDay: t })!.cron;
    assertEquals(parseCronToShape(cron).timeOfDay, t, `round-trip failed for ${t}`);
  }
});

Deno.test("weekly + monthly presets carry day + time", () => {
  assertEquals(presetShapeToCron({ preset: "Weekly", dayOfWeek: 1, timeOfDay: "08:00" }), { cron: "0 8 * * 1", tz: "America/New_York" });
  assertEquals(parseCronToShape("0 8 * * 1"), { preset: "Weekly", dayOfWeek: 1, timeOfDay: "08:00" });
  assertEquals(presetShapeToCron({ preset: "Monthly", dayOfMonth: 15, timeOfDay: "07:30" }), { cron: "30 7 15 * *", tz: "America/New_York" });
  assertEquals(parseCronToShape("30 7 15 * *"), { preset: "Monthly", dayOfMonth: 15, timeOfDay: "07:30" });
});
