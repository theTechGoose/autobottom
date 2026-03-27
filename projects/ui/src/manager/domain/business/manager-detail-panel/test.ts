import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ManagerDetailPanel } from "./mod.ts";

Deno.test("ManagerDetailPanel - default detail is null", () => {
  const panel = new ManagerDetailPanel();
  assertEquals(panel.detail, null);
});

Deno.test("ManagerDetailPanel - default transcriptOpen is false", () => {
  const panel = new ManagerDetailPanel();
  assertEquals(panel.transcriptOpen, false);
});

Deno.test("ManagerDetailPanel - detail can be set", () => {
  const panel = new ManagerDetailPanel();
  // deno-lint-ignore no-explicit-any
  const data: any = { finding: { id: "f1" }, questions: [] };
  panel.detail = data;
  assertEquals(panel.detail.finding.id, "f1");
});

Deno.test("ManagerDetailPanel - transcriptOpen can be set to true", () => {
  const panel = new ManagerDetailPanel();
  panel.transcriptOpen = true;
  assertEquals(panel.transcriptOpen, true);
});
