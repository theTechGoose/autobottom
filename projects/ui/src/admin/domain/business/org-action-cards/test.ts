import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OrgActionCards } from "./mod.ts";

Deno.test("OrgActionCards - default selectedOrg is null", () => {
  const cards = new OrgActionCards();
  assertEquals(cards.selectedOrg, null);
});

Deno.test("OrgActionCards - default loading is empty object", () => {
  const cards = new OrgActionCards();
  assertEquals(cards.loading, {});
});

Deno.test("OrgActionCards - has seed method", () => {
  const cards = new OrgActionCards();
  assertEquals(typeof cards.seed, "function");
});

Deno.test("OrgActionCards - has wipe method", () => {
  const cards = new OrgActionCards();
  assertEquals(typeof cards.wipe, "function");
});

Deno.test("OrgActionCards - has deleteOrg method", () => {
  const cards = new OrgActionCards();
  assertEquals(typeof cards.deleteOrg, "function");
});

Deno.test("OrgActionCards - has impersonate method", () => {
  const cards = new OrgActionCards();
  assertEquals(typeof cards.impersonate, "function");
});
