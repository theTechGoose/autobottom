import { assertEquals } from "jsr:@std/assert";
import { AgentDashboard } from "./mod.ts";

Deno.test("AgentDashboard - can be instantiated", () => {
  const dash = new AgentDashboard();
  assertEquals(dash instanceof AgentDashboard, true);
});

Deno.test("AgentDashboard - default activeTab is 'dashboard'", () => {
  const dash = new AgentDashboard();
  assertEquals(dash.activeTab, "dashboard");
});

Deno.test("AgentDashboard - default data is null", () => {
  const dash = new AgentDashboard();
  assertEquals(dash.data, null);
});

Deno.test("AgentDashboard - default gameState is null", () => {
  const dash = new AgentDashboard();
  assertEquals(dash.gameState, null);
});

Deno.test("AgentDashboard - default loading is true", () => {
  const dash = new AgentDashboard();
  assertEquals(dash.loading, true);
});

Deno.test("AgentDashboard - default error is empty string", () => {
  const dash = new AgentDashboard();
  assertEquals(dash.error, "");
});

Deno.test("AgentDashboard - default userEmail is '--'", () => {
  const dash = new AgentDashboard();
  assertEquals(dash.userEmail, "--");
});

Deno.test("AgentDashboard - has load method", () => {
  const dash = new AgentDashboard();
  assertEquals(typeof dash.load, "function");
});

Deno.test("AgentDashboard - has loadGameState method", () => {
  const dash = new AgentDashboard();
  assertEquals(typeof dash.loadGameState, "function");
});
