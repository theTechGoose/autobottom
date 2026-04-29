/** Unit tests for the path-exclusion logic of the impersonation banner.
 *  Banner must NOT show on /audit/* (finding-detail views, no reviewer
 *  scope) — added after a regression where the golden ADMIN VIEW topbar
 *  appeared on /audit/report. */
import { assertEquals } from "@std/assert";
import { shouldProbeForBanner, EXCLUDED_PREFIXES } from "../../islands/ImpersonationBanner.tsx";

Deno.test("ImpersonationBanner — should NOT probe on /audit/report (regression check)", () => {
  assertEquals(shouldProbeForBanner("/audit/report", ""), false);
  assertEquals(shouldProbeForBanner("/audit/report?id=foo", ""), false);
});

Deno.test("ImpersonationBanner — should NOT probe on /admin/*", () => {
  assertEquals(shouldProbeForBanner("/admin/dashboard", ""), false);
  assertEquals(shouldProbeForBanner("/admin/users", ""), false);
});

Deno.test("ImpersonationBanner — should NOT probe on /login, /register, /", () => {
  assertEquals(shouldProbeForBanner("/login", ""), false);
  assertEquals(shouldProbeForBanner("/register", ""), false);
  assertEquals(shouldProbeForBanner("/", ""), false);
});

Deno.test("ImpersonationBanner — SHOULD probe on /review, /judge, /manager, /agent (legitimate impersonation targets)", () => {
  assertEquals(shouldProbeForBanner("/review", ""), true);
  assertEquals(shouldProbeForBanner("/review/dashboard", ""), true);
  assertEquals(shouldProbeForBanner("/judge", ""), true);
  assertEquals(shouldProbeForBanner("/judge/dashboard", ""), true);
  assertEquals(shouldProbeForBanner("/manager", ""), true);
  assertEquals(shouldProbeForBanner("/agent", ""), true);
});

Deno.test("ImpersonationBanner — explicit ?as= override forces probe even on excluded paths", () => {
  assertEquals(shouldProbeForBanner("/audit/report", "test@x.com"), true);
  assertEquals(shouldProbeForBanner("/admin/dashboard", "test@x.com"), true);
  assertEquals(shouldProbeForBanner("/", "test@x.com"), true);
});

Deno.test("ImpersonationBanner — EXCLUDED_PREFIXES contains /audit (regression marker)", () => {
  // If a future change removes /audit from the list, this test catches it.
  assertEquals(EXCLUDED_PREFIXES.includes("/audit"), true);
});
