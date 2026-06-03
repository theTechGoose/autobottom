/** Tests for the canary errors endpoint helpers + handler auth/shape. */

import { assertEquals, assert } from "#assert";
import { etDayWindow, logsBaseFromReq, buildLogsUrl, handleCanaryErrors } from "./mod.ts";

const TZ = "America/New_York";

Deno.test("etDayWindow — yesterday is a full ET day, 23–25h wide", () => {
  // 2026-06-02 12:00 ET ≈ 16:00 UTC (EDT, -4h)
  const now = Date.UTC(2026, 5, 2, 16, 0, 0);
  const w = etDayWindow(now);
  assertEquals(w.date, "2026-06-01");
  // EDT: ET midnight = 04:00 UTC
  assertEquals(new Date(w.since).toISOString(), "2026-06-01T04:00:00.000Z");
  assertEquals(new Date(w.until).toISOString(), "2026-06-02T04:00:00.000Z");
  assertEquals(w.until - w.since, 24 * 3600_000);
});

Deno.test("etDayWindow — explicit date override (EST, winter)", () => {
  // Jan is EST (-5h): ET midnight = 05:00 UTC
  const w = etDayWindow(Date.UTC(2026, 5, 2, 16, 0, 0), "2026-01-15");
  assertEquals(w.date, "2026-01-15");
  assertEquals(new Date(w.since).toISOString(), "2026-01-15T05:00:00.000Z");
  assertEquals(new Date(w.until).toISOString(), "2026-01-16T05:00:00.000Z");
});

Deno.test("etDayWindow — spring-forward day is 23h (DST gap)", () => {
  // 2026 DST starts Sun Mar 8. The ET day 2026-03-08 loses an hour.
  const w = etDayWindow(Date.UTC(2026, 2, 9, 16, 0, 0), "2026-03-08");
  assertEquals(w.date, "2026-03-08");
  // Mar 8 00:00 EST = 05:00 UTC; Mar 9 00:00 EDT = 04:00 UTC → 23h span.
  assertEquals(w.until - w.since, 23 * 3600_000);
});

Deno.test("logsBaseFromReq — derives org/project from deno.net host", () => {
  const req = new Request("https://autobottom.thetechgoose.deno.net/canary/errors", { method: "POST" });
  assertEquals(logsBaseFromReq(req), "https://console.deno.com/thetechgoose/autobottom/observability/logs?query=");
});

Deno.test("logsBaseFromReq — falls back for non-deno.net host", () => {
  const req = new Request("http://localhost:3000/canary/errors", { method: "POST" });
  assert(logsBaseFromReq(req).startsWith("https://console.deno.com/"));
});

Deno.test("buildLogsUrl — query + suffix", () => {
  const base = "https://console.deno.com/thetechgoose/autobottom/observability/logs?query=";
  assertEquals(buildLogsUrl(base, "fid-abc"), `${base}fid-abc&start=now%2Fy&end=now`);
});

Deno.test("handleCanaryErrors — non-POST → 405", async () => {
  const res = await handleCanaryErrors(new Request("https://x.deno.net/canary/errors", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("handleCanaryErrors — missing/bad bearer → 401 (when secret set)", async () => {
  Deno.env.set("CANARY_SECRET", "top-secret");
  try {
    const res = await handleCanaryErrors(new Request("https://x.deno.net/canary/errors", { method: "POST" }));
    assertEquals(res.status, 401);
    const res2 = await handleCanaryErrors(new Request("https://x.deno.net/canary/errors", {
      method: "POST", headers: { Authorization: "Bearer wrong" },
    }));
    assertEquals(res2.status, 401);
  } finally {
    Deno.env.delete("CANARY_SECRET");
  }
});

Deno.test("handleCanaryErrors — 500 when secret not configured", async () => {
  Deno.env.delete("CANARY_SECRET");
  const res = await handleCanaryErrors(new Request("https://x.deno.net/canary/errors", {
    method: "POST", headers: { Authorization: "Bearer anything" },
  }));
  assertEquals(res.status, 500);
});

Deno.test({
  name: "handleCanaryErrors — good bearer → 200 JSON shape",
  sanitizeResources: false, sanitizeOps: false,
  async fn() {
    Deno.env.set("CANARY_SECRET", "top-secret");
    try {
      const res = await handleCanaryErrors(new Request("https://autobottom.thetechgoose.deno.net/canary/errors", {
        method: "POST", headers: { Authorization: "Bearer top-secret" },
      }));
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.timezone, TZ);
      assert(typeof body.date === "string");
      assert(typeof body.totalErrors === "number");
      assert(Array.isArray(body.findingIds));
      assert(Array.isArray(body.errors));
    } finally {
      Deno.env.delete("CANARY_SECRET");
    }
  },
});

Deno.test({
  name: "handleCanaryErrors — surfaces a seeded error with logs URL (full read path)",
  sanitizeResources: false, sanitizeOps: false,
  async fn() {
    Deno.env.set("CANARY_SECRET", "top-secret");
    try {
      const { trackError } = await import("@audit/domain/data/stats-repository/mod.ts");
      const { defaultOrgId } = await import("@core/business/auth/mod.ts");
      await trackError(defaultOrgId() as never, "canary-fid-1", "transcribe", "boom");
      const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const res = await handleCanaryErrors(new Request(`https://autobottom.thetechgoose.deno.net/canary/errors?date=${todayEt}`, {
        method: "POST", headers: { Authorization: "Bearer top-secret" },
      }));
      const body = await res.json();
      assert(body.totalErrors >= 1, "seeded error counted");
      assert(body.findingIds.includes("canary-fid-1"), "finding id present");
      const e = body.errors.find((x: { findingId: string }) => x.findingId === "canary-fid-1");
      assert(e, "seeded error in array");
      assertEquals(e.step, "transcribe");
      assertEquals(e.error, "boom");
      assert(typeof e.timestamp === "string");
      assert(e.logsUrl.includes("query=canary-fid-1"), "logs URL queries the finding");
      assert(e.logsUrl.startsWith("https://console.deno.com/thetechgoose/autobottom/"), "logs URL points at the deployment");
    } finally {
      Deno.env.delete("CANARY_SECRET");
    }
  },
});

Deno.test({
  name: "handleCanaryErrors — classifies recovered vs unrecovered (genuine fault) errors",
  sanitizeResources: false, sanitizeOps: false,
  async fn() {
    Deno.env.set("CANARY_SECRET", "top-secret");
    try {
      const { trackError, clearErrors } = await import("@audit/domain/data/stats-repository/mod.ts");
      const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
      const { defaultOrgId } = await import("@core/business/auth/mod.ts");
      const org = defaultOrgId() as never;

      // The handler reads the shared default org and dedups by ts; clear first
      // so this test sees only its own two rows (deterministic under the full
      // suite, where other tests also seed default-org errors). Tests run
      // sequentially, so this can't race a concurrent seeder.
      await clearErrors(org);

      // A self-healed blip (audit finished) and a genuine stuck fault.
      const recoveredFid = "canary-recovered-" + crypto.randomUUID().slice(0, 8);
      const stuckFid = "canary-stuck-" + crypto.randomUUID().slice(0, 8);
      await saveFinding(org, { id: recoveredFid, findingStatus: "finished" });
      await saveFinding(org, { id: stuckFid, findingStatus: "getting-recording" });
      await trackError(org, recoveredFid, "init", "The signal has been aborted");
      // Distinct ms so the handler's per-ts dedup keeps both rows.
      await new Promise((r) => setTimeout(r, 3));
      await trackError(org, stuckFid, "init", "The signal has been aborted");

      const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const res = await handleCanaryErrors(new Request(`https://autobottom.thetechgoose.deno.net/canary/errors?date=${todayEt}`, {
        method: "POST", headers: { Authorization: "Bearer top-secret" },
      }));
      assertEquals(res.status, 200);
      const body = await res.json();

      // New contract fields present + typed.
      assert(typeof body.unrecoveredErrors === "number", "unrecoveredErrors is a number");
      assert(Array.isArray(body.unrecoveredFindingIds), "unrecoveredFindingIds is an array");

      const rec = body.errors.find((x: { findingId: string }) => x.findingId === recoveredFid);
      const stuck = body.errors.find((x: { findingId: string }) => x.findingId === stuckFid);
      assert(rec, "recovered error present in errors[]");
      assert(stuck, "stuck error present in errors[]");
      assertEquals(rec.recovered, true, "finished finding → recovered:true");
      assertEquals(stuck.recovered, false, "getting-recording finding → recovered:false");

      // The genuine fault is the only one that should count against canary.
      assert(!body.unrecoveredFindingIds.includes(recoveredFid), "recovered finding excluded from unrecovered set");
      assert(body.unrecoveredFindingIds.includes(stuckFid), "stuck finding listed as unrecovered");
      assert(body.unrecoveredErrors >= 1, "at least the stuck finding counts as unrecovered");
      // totalErrors keeps its meaning: both errors are still listed for visibility.
      assert(body.findingIds.includes(recoveredFid) && body.findingIds.includes(stuckFid), "both findings in full findingIds");
    } finally {
      Deno.env.delete("CANARY_SECRET");
    }
  },
});
