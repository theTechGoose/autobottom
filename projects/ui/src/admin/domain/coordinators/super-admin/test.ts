import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SuperAdminCoordinator } from "./mod.ts";

Deno.test("SuperAdminCoordinator - default orgs is empty array", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(coord.orgs, []);
});

Deno.test("SuperAdminCoordinator - default selectedOrg is null", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(coord.selectedOrg, null);
});

Deno.test("SuperAdminCoordinator - default toasts is empty array", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(coord.toasts, []);
});

Deno.test("SuperAdminCoordinator - has loadOrgs method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.loadOrgs, "function");
});

Deno.test("SuperAdminCoordinator - has selectOrg method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.selectOrg, "function");
});

Deno.test("SuperAdminCoordinator - has createOrg method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.createOrg, "function");
});

Deno.test("SuperAdminCoordinator - has seed method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.seed, "function");
});

Deno.test("SuperAdminCoordinator - has wipe method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.wipe, "function");
});

Deno.test("SuperAdminCoordinator - has deleteOrg method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.deleteOrg, "function");
});

Deno.test("SuperAdminCoordinator - has impersonate method", () => {
  const coord = new SuperAdminCoordinator();
  assertEquals(typeof coord.impersonate, "function");
});

Deno.test("SuperAdminCoordinator - selectOrg sets selectedOrg", () => {
  const coord = new SuperAdminCoordinator();
  const org = { id: "1", name: "Test Org" };
  coord.selectOrg(org);
  assertEquals(coord.selectedOrg, org);
});
