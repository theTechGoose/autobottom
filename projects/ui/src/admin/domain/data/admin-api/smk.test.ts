import { assertEquals, assertExists } from "jsr:@std/assert";
import { AdminApi } from "./mod.ts";

Deno.test("AdminApi: class can be instantiated", () => {
  const api = new AdminApi();
  assertExists(api);
});

Deno.test("AdminApi: has getDashboardData method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getDashboardData, "function");
});

Deno.test("AdminApi: has getWebhook method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getWebhook, "function");
});

Deno.test("AdminApi: has saveWebhook method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.saveWebhook, "function");
});

Deno.test("AdminApi: has getParallelism method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getParallelism, "function");
});

Deno.test("AdminApi: has setParallelism method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.setParallelism, "function");
});

Deno.test("AdminApi: has getPipelineConfig method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getPipelineConfig, "function");
});

Deno.test("AdminApi: has savePipelineConfig method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.savePipelineConfig, "function");
});

Deno.test("AdminApi: has getUsers method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getUsers, "function");
});

Deno.test("AdminApi: has createUser method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.createUser, "function");
});

Deno.test("AdminApi: has getMe method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getMe, "function");
});

Deno.test("AdminApi: has seedData method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.seedData, "function");
});

Deno.test("AdminApi: has wipeData method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.wipeData, "function");
});

Deno.test("AdminApi: has getEmailReports method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getEmailReports, "function");
});

Deno.test("AdminApi: has saveEmailReport method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.saveEmailReport, "function");
});

Deno.test("AdminApi: has deleteEmailReport method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.deleteEmailReport, "function");
});

Deno.test("AdminApi: has triggerAudit method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.triggerAudit, "function");
});

Deno.test("AdminApi: has getOrgs method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.getOrgs, "function");
});

Deno.test("AdminApi: has createOrg method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.createOrg, "function");
});

Deno.test("AdminApi: has seedOrg method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.seedOrg, "function");
});

Deno.test("AdminApi: has wipeOrg method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.wipeOrg, "function");
});

Deno.test("AdminApi: has deleteOrg method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.deleteOrg, "function");
});

Deno.test("AdminApi: has impersonate method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.impersonate, "function");
});

Deno.test("AdminApi: has seedSounds method", () => {
  const api = new AdminApi();
  assertEquals(typeof api.seedSounds, "function");
});
