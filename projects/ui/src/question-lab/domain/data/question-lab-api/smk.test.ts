import { assertEquals, assertExists } from "jsr:@std/assert";
import { QuestionLabApi } from "./mod.ts";

Deno.test("QuestionLabApi: class can be instantiated", () => {
  const api = new QuestionLabApi();
  assertExists(api);
});

Deno.test("QuestionLabApi: has getConfigs method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.getConfigs, "function");
});

Deno.test("QuestionLabApi: has createConfig method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.createConfig, "function");
});

Deno.test("QuestionLabApi: has updateConfig method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.updateConfig, "function");
});

Deno.test("QuestionLabApi: has deleteConfig method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.deleteConfig, "function");
});

Deno.test("QuestionLabApi: has getConfig method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.getConfig, "function");
});

Deno.test("QuestionLabApi: has createQuestion method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.createQuestion, "function");
});

Deno.test("QuestionLabApi: has getQuestion method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.getQuestion, "function");
});

Deno.test("QuestionLabApi: has updateQuestion method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.updateQuestion, "function");
});

Deno.test("QuestionLabApi: has deleteQuestion method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.deleteQuestion, "function");
});

Deno.test("QuestionLabApi: has restoreVersion method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.restoreVersion, "function");
});

Deno.test("QuestionLabApi: has createTest method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.createTest, "function");
});

Deno.test("QuestionLabApi: has deleteTest method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.deleteTest, "function");
});

Deno.test("QuestionLabApi: has simulate method", () => {
  const api = new QuestionLabApi();
  assertEquals(typeof api.simulate, "function");
});
