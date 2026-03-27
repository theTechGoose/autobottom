import { assertEquals, assertExists } from "jsr:@std/assert";
import { AgentApi } from "./mod.ts";

Deno.test("AgentApi - can be instantiated", () => {
  const api = new AgentApi();
  assertExists(api);
});

Deno.test("AgentApi - has getMe method", () => {
  const api = new AgentApi();
  assertEquals(typeof api.getMe, "function");
});

Deno.test("AgentApi - has getDashboard method", () => {
  const api = new AgentApi();
  assertEquals(typeof api.getDashboard, "function");
});

Deno.test("AgentApi - has getGameState method", () => {
  const api = new AgentApi();
  assertEquals(typeof api.getGameState, "function");
});

Deno.test("AgentApi - has getStore method", () => {
  const api = new AgentApi();
  assertEquals(typeof api.getStore, "function");
});

Deno.test("AgentApi - has buyItem method", () => {
  const api = new AgentApi();
  assertEquals(typeof api.buyItem, "function");
});
