import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DevtoolsModal } from "./mod.ts";

Deno.test("DevtoolsModal - default open is false", () => {
  const modal = new DevtoolsModal();
  assertEquals(modal.open, false);
});

Deno.test("DevtoolsModal - default seedBusy is false", () => {
  const modal = new DevtoolsModal();
  assertEquals(modal.seedBusy, false);
});

Deno.test("DevtoolsModal - default wipeBusy is false", () => {
  const modal = new DevtoolsModal();
  assertEquals(modal.wipeBusy, false);
});

Deno.test("DevtoolsModal - has seedData method", () => {
  const modal = new DevtoolsModal();
  assertEquals(typeof modal.seedData, "function");
});

Deno.test("DevtoolsModal - has wipeData method", () => {
  const modal = new DevtoolsModal();
  assertEquals(typeof modal.wipeData, "function");
});
