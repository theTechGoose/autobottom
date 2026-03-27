import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdminTablesPanel } from "./mod.ts";

Deno.test("AdminTablesPanel - default activeAudits is empty array", () => {
  const panel = new AdminTablesPanel();
  assertEquals(panel.activeAudits, []);
});

Deno.test("AdminTablesPanel - default recentErrors is empty array", () => {
  const panel = new AdminTablesPanel();
  assertEquals(panel.recentErrors, []);
});

Deno.test("AdminTablesPanel - default tokensByFunction is null", () => {
  const panel = new AdminTablesPanel();
  assertEquals(panel.tokensByFunction, null);
});

Deno.test("AdminTablesPanel - properties can be set", () => {
  const panel = new AdminTablesPanel();
  panel.activeAudits = [{ findingId: "f1", step: "s1", ts: 1000 }];
  panel.recentErrors = [{ findingId: "f2", step: "s2", error: "err", ts: 2000 }];
  panel.tokensByFunction = { fn1: { total_tokens: 100, calls: 5 } };
  assertEquals(panel.activeAudits.length, 1);
  assertEquals(panel.recentErrors.length, 1);
  assertEquals(panel.tokensByFunction.fn1.total_tokens, 100);
});
