import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OrgSidebar } from "./mod.ts";

Deno.test("OrgSidebar - default orgs is empty array", () => {
  const sidebar = new OrgSidebar();
  assertEquals(sidebar.orgs, []);
});

Deno.test("OrgSidebar - default selectedOrg is null", () => {
  const sidebar = new OrgSidebar();
  assertEquals(sidebar.selectedOrg, null);
});

Deno.test("OrgSidebar - default newOrgName is empty string", () => {
  const sidebar = new OrgSidebar();
  assertEquals(sidebar.newOrgName, "");
});

Deno.test("OrgSidebar - has createOrg method", () => {
  const sidebar = new OrgSidebar();
  assertEquals(typeof sidebar.createOrg, "function");
});
