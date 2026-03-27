import { assertEquals } from "jsr:@std/assert";
import { QuestionEditor } from "./mod.ts";

Deno.test("QuestionEditor: default question is null", () => {
  const c = new QuestionEditor();
  assertEquals(c.question, null);
});

Deno.test("QuestionEditor: default versions is empty array", () => {
  const c = new QuestionEditor();
  assertEquals(c.versions, []);
});

Deno.test("QuestionEditor: default qName is empty string", () => {
  const c = new QuestionEditor();
  assertEquals(c.qName, "");
});

Deno.test("QuestionEditor: default qText is empty string", () => {
  const c = new QuestionEditor();
  assertEquals(c.qText, "");
});

Deno.test("QuestionEditor: default qAutoYes is empty string", () => {
  const c = new QuestionEditor();
  assertEquals(c.qAutoYes, "");
});

Deno.test("QuestionEditor: loadFromQuestion populates form fields", () => {
  const c = new QuestionEditor();
  c.question = { id: "q1", name: "Test Q", text: "Is it?", autoYes: "HAS_FLAG" };
  c.loadFromQuestion();
  assertEquals(c.qName, "Test Q");
  assertEquals(c.qText, "Is it?");
  assertEquals(c.qAutoYes, "HAS_FLAG");
});

Deno.test("QuestionEditor: loadFromQuestion handles null question", () => {
  const c = new QuestionEditor();
  c.loadFromQuestion();
  assertEquals(c.qName, "");
  assertEquals(c.qText, "");
  assertEquals(c.qAutoYes, "");
});

Deno.test("QuestionEditor: loadFromQuestion handles missing autoYes", () => {
  const c = new QuestionEditor();
  c.question = { id: "q1", name: "Test Q", text: "Is it?" };
  c.loadFromQuestion();
  assertEquals(c.qName, "Test Q");
  assertEquals(c.qText, "Is it?");
  assertEquals(c.qAutoYes, "");
});
