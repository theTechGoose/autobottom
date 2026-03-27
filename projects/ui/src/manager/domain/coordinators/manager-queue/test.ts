import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ManagerQueueCoordinator } from "./mod.ts";

Deno.test("ManagerQueueCoordinator - can be instantiated", () => {
  const coord = new ManagerQueueCoordinator();
  assertExists(coord);
});

Deno.test("ManagerQueueCoordinator - default screen is 'queue'", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.screen, "queue");
});

Deno.test("ManagerQueueCoordinator - default queueData is empty array", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.queueData, []);
});

Deno.test("ManagerQueueCoordinator - default stats is null", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.stats, null);
});

Deno.test("ManagerQueueCoordinator - default filterVal is 'all'", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.filterVal, "all");
});

Deno.test("ManagerQueueCoordinator - default detail is null", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.detail, null);
});

Deno.test("ManagerQueueCoordinator - default gameState is null", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.gameState, null);
});

Deno.test("ManagerQueueCoordinator - default loading is true", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.loading, true);
});

Deno.test("ManagerQueueCoordinator - default toastMsg is empty", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.toastMsg, "");
});

Deno.test("ManagerQueueCoordinator - default toastType is 'info'", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.toastType, "info");
});

Deno.test("ManagerQueueCoordinator - default transcriptOpen is false", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.transcriptOpen, false);
});

Deno.test("ManagerQueueCoordinator - default remNotes is empty", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.remNotes, "");
});

Deno.test("ManagerQueueCoordinator - default remSubmitting is false", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.remSubmitting, false);
});

Deno.test("ManagerQueueCoordinator - default backfilling is false", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(coord.backfilling, false);
});

Deno.test("ManagerQueueCoordinator - has loadQueue method", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(typeof coord.loadQueue, "function");
});

Deno.test("ManagerQueueCoordinator - has loadDetail method", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(typeof coord.loadDetail, "function");
});

Deno.test("ManagerQueueCoordinator - has loadGameState method", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(typeof coord.loadGameState, "function");
});

Deno.test("ManagerQueueCoordinator - has submitRemediation method", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(typeof coord.submitRemediation, "function");
});

Deno.test("ManagerQueueCoordinator - has backfill method", () => {
  const coord = new ManagerQueueCoordinator();
  assertEquals(typeof coord.backfill, "function");
});

Deno.test("ManagerQueueCoordinator - showToast sets toastMsg and toastType", () => {
  const coord = new ManagerQueueCoordinator();
  coord.showToast("Test message", "error");
  assertEquals(coord.toastMsg, "Test message");
  assertEquals(coord.toastType, "error");
});

Deno.test("ManagerQueueCoordinator - showToast defaults type to 'info'", () => {
  const coord = new ManagerQueueCoordinator();
  coord.showToast("Info message");
  assertEquals(coord.toastMsg, "Info message");
  assertEquals(coord.toastType, "info");
});
