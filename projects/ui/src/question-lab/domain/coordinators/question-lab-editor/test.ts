import { assertEquals, assertExists } from "jsr:@std/assert";
import { QuestionLabEditorCoordinator } from "./mod.ts";

Deno.test("QuestionLabEditorCoordinator: can be instantiated", () => {
  const c = new QuestionLabEditorCoordinator();
  assertExists(c);
});

Deno.test("QuestionLabEditorCoordinator: default view is 'list'", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.view, "list");
});

Deno.test("QuestionLabEditorCoordinator: default configs is empty array", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.configs, []);
});

Deno.test("QuestionLabEditorCoordinator: default activeConfig is null", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.activeConfig, null);
});

Deno.test("QuestionLabEditorCoordinator: default questions is empty array", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.questions, []);
});

Deno.test("QuestionLabEditorCoordinator: default activeQuestion is null", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.activeQuestion, null);
});

Deno.test("QuestionLabEditorCoordinator: default tests is empty array", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.tests, []);
});

Deno.test("QuestionLabEditorCoordinator: default toastMsg is empty string", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.toastMsg, "");
});

Deno.test("QuestionLabEditorCoordinator: default toastType is 'success'", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(c.toastType, "success");
});

Deno.test("QuestionLabEditorCoordinator: has loadConfigs method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.loadConfigs, "function");
});

Deno.test("QuestionLabEditorCoordinator: has openConfig method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.openConfig, "function");
});

Deno.test("QuestionLabEditorCoordinator: has openQuestion method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.openQuestion, "function");
});

Deno.test("QuestionLabEditorCoordinator: has createConfig method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.createConfig, "function");
});

Deno.test("QuestionLabEditorCoordinator: has deleteConfig method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.deleteConfig, "function");
});

Deno.test("QuestionLabEditorCoordinator: has renameConfig method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.renameConfig, "function");
});

Deno.test("QuestionLabEditorCoordinator: has createQuestion method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.createQuestion, "function");
});

Deno.test("QuestionLabEditorCoordinator: has deleteQuestion method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.deleteQuestion, "function");
});

Deno.test("QuestionLabEditorCoordinator: has saveQuestion method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.saveQuestion, "function");
});

Deno.test("QuestionLabEditorCoordinator: has restoreVersion method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.restoreVersion, "function");
});

Deno.test("QuestionLabEditorCoordinator: has createTest method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.createTest, "function");
});

Deno.test("QuestionLabEditorCoordinator: has deleteTest method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.deleteTest, "function");
});

Deno.test("QuestionLabEditorCoordinator: has simulateAll method", () => {
  const c = new QuestionLabEditorCoordinator();
  assertEquals(typeof c.simulateAll, "function");
});
