import { assertEquals, assertExists } from "jsr:@std/assert";
import { JudgeApi } from "./mod.ts";

Deno.test("JudgeApi: class can be instantiated", () => {
  const api = new JudgeApi();
  assertExists(api);
});

Deno.test("JudgeApi: has getNext method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getNext, "function");
});

Deno.test("JudgeApi: has decide method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.decide, "function");
});

Deno.test("JudgeApi: has goBack method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.goBack, "function");
});

Deno.test("JudgeApi: has getMe method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getMe, "function");
});

Deno.test("JudgeApi: has getDashboard method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getDashboard, "function");
});

Deno.test("JudgeApi: has getReviewers method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getReviewers, "function");
});

Deno.test("JudgeApi: has addReviewer method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.addReviewer, "function");
});

Deno.test("JudgeApi: has removeReviewer method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.removeReviewer, "function");
});

Deno.test("JudgeApi: has getRecording method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getRecording, "function");
});

Deno.test("JudgeApi: has getGameConfig method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getGameConfig, "function");
});

Deno.test("JudgeApi: has getBadges method", () => {
  const api = new JudgeApi();
  assertEquals(typeof api.getBadges, "function");
});

Deno.test("JudgeApi: getRecording returns correct URL", () => {
  const api = new JudgeApi();
  const url = api.getRecording("abc-123");
  assertEquals(url, "/audit/recording?id=abc-123");
});
