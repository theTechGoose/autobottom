import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RemediationSection } from "./mod.ts";

Deno.test("RemediationSection - default canRemediate is false", () => {
  const section = new RemediationSection();
  assertEquals(section.canRemediate, false);
});

Deno.test("RemediationSection - default notes is empty string", () => {
  const section = new RemediationSection();
  assertEquals(section.notes, "");
});

Deno.test("RemediationSection - default submitting is false", () => {
  const section = new RemediationSection();
  assertEquals(section.submitting, false);
});

Deno.test("RemediationSection - canRemediate can be set to true", () => {
  const section = new RemediationSection();
  section.canRemediate = true;
  assertEquals(section.canRemediate, true);
});

Deno.test("RemediationSection - notes can be set", () => {
  const section = new RemediationSection();
  section.notes = "This is a remediation note with enough chars";
  assertEquals(section.notes, "This is a remediation note with enough chars");
});

Deno.test("RemediationSection - has submit method", () => {
  const section = new RemediationSection();
  assertEquals(typeof section.submit, "function");
});
