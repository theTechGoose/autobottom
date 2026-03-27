import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdminDashboardCoordinator } from "./mod.ts";

Deno.test("AdminDashboardCoordinator - default data is null", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(coord.data, null);
});

Deno.test("AdminDashboardCoordinator - default statusDot is 'loading'", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(coord.statusDot, "loading");
});

Deno.test("AdminDashboardCoordinator - default countdown is 30", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(coord.countdown, 30);
});

Deno.test("AdminDashboardCoordinator - default modal is 'none'", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(coord.modal, "none");
});

Deno.test("AdminDashboardCoordinator - default toasts is empty array", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(coord.toasts, []);
});

Deno.test("AdminDashboardCoordinator - has fetchData method", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(typeof coord.fetchData, "function");
});

Deno.test("AdminDashboardCoordinator - has openModal method", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(typeof coord.openModal, "function");
});

Deno.test("AdminDashboardCoordinator - has closeModal method", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(typeof coord.closeModal, "function");
});

Deno.test("AdminDashboardCoordinator - has renderCharts method", () => {
  const coord = new AdminDashboardCoordinator();
  assertEquals(typeof coord.renderCharts, "function");
});

Deno.test("AdminDashboardCoordinator - openModal sets modal state", () => {
  const coord = new AdminDashboardCoordinator();
  coord.openModal("webhook");
  assertEquals(coord.modal, "webhook");
});

Deno.test("AdminDashboardCoordinator - closeModal sets modal to none", () => {
  const coord = new AdminDashboardCoordinator();
  coord.openModal("webhook");
  coord.closeModal();
  assertEquals(coord.modal, "none");
});
