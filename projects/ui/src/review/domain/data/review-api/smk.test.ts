import { assertEquals, assertExists } from "jsr:@std/assert";
import { ReviewApi } from "./mod.ts";

Deno.test("ReviewApi: class can be instantiated", () => {
  const api = new ReviewApi();
  assertExists(api);
});

Deno.test("ReviewApi: has getNext method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.getNext, "function");
});

Deno.test("ReviewApi: has decide method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.decide, "function");
});

Deno.test("ReviewApi: has goBack method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.goBack, "function");
});

Deno.test("ReviewApi: has getMe method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.getMe, "function");
});

Deno.test("ReviewApi: has getDashboard method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.getDashboard, "function");
});

Deno.test("ReviewApi: has getRecording method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.getRecording, "function");
});

Deno.test("ReviewApi: has getGameConfig method", () => {
  const api = new ReviewApi();
  assertEquals(typeof api.getGameConfig, "function");
});
