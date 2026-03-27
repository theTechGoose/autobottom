import { assertEquals } from "jsr:@std/assert";
import { ConfigDetail } from "./mod.ts";

Deno.test("ConfigDetail: default config is null", () => {
  const c = new ConfigDetail();
  assertEquals(c.config, null);
});

Deno.test("ConfigDetail: default questions is empty array", () => {
  const c = new ConfigDetail();
  assertEquals(c.questions, []);
});

Deno.test("ConfigDetail: default configName is empty string", () => {
  const c = new ConfigDetail();
  assertEquals(c.configName, "");
});

Deno.test("ConfigDetail: default showNewQuestion is false", () => {
  const c = new ConfigDetail();
  assertEquals(c.showNewQuestion, false);
});

Deno.test("ConfigDetail: default newQName is empty string", () => {
  const c = new ConfigDetail();
  assertEquals(c.newQName, "");
});

Deno.test("ConfigDetail: default newQText is empty string", () => {
  const c = new ConfigDetail();
  assertEquals(c.newQText, "");
});

Deno.test("ConfigDetail: toggleNewQuestion flips state", () => {
  const c = new ConfigDetail();
  c.toggleNewQuestion();
  assertEquals(c.showNewQuestion, true);
  c.toggleNewQuestion();
  assertEquals(c.showNewQuestion, false);
});

Deno.test("ConfigDetail: resetQuestionForm clears form and hides it", () => {
  const c = new ConfigDetail();
  c.showNewQuestion = true;
  c.newQName = "My Question";
  c.newQText = "Some text";
  c.resetQuestionForm();
  assertEquals(c.showNewQuestion, false);
  assertEquals(c.newQName, "");
  assertEquals(c.newQText, "");
});
