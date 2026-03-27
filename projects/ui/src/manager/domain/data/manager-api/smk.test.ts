import { assertEquals, assertExists } from "jsr:@std/assert";
import { ManagerApi } from "./mod.ts";

Deno.test("ManagerApi: class can be instantiated", () => {
  const api = new ManagerApi();
  assertExists(api);
});

Deno.test("ManagerApi: has getQueue method", () => {
  const api = new ManagerApi();
  assertEquals(typeof api.getQueue, "function");
});

Deno.test("ManagerApi: has getStats method", () => {
  const api = new ManagerApi();
  assertEquals(typeof api.getStats, "function");
});

Deno.test("ManagerApi: has getFinding method", () => {
  const api = new ManagerApi();
  assertEquals(typeof api.getFinding, "function");
});

Deno.test("ManagerApi: has remediate method", () => {
  const api = new ManagerApi();
  assertEquals(typeof api.remediate, "function");
});

Deno.test("ManagerApi: has getGameState method", () => {
  const api = new ManagerApi();
  assertEquals(typeof api.getGameState, "function");
});

Deno.test("ManagerApi: has backfill method", () => {
  const api = new ManagerApi();
  assertEquals(typeof api.backfill, "function");
});
