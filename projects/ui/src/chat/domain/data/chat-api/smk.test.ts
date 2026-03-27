import { assertEquals, assertExists } from "jsr:@std/assert";
import { ChatApi } from "./mod.ts";

Deno.test("ChatApi: class can be instantiated", () => {
  const api = new ChatApi();
  assertExists(api);
});

Deno.test("ChatApi: has getMe method", () => {
  const api = new ChatApi();
  assertEquals(typeof api.getMe, "function");
});

Deno.test("ChatApi: has getConversations method", () => {
  const api = new ChatApi();
  assertEquals(typeof api.getConversations, "function");
});

Deno.test("ChatApi: has getMessages method", () => {
  const api = new ChatApi();
  assertEquals(typeof api.getMessages, "function");
});

Deno.test("ChatApi: has sendMessage method", () => {
  const api = new ChatApi();
  assertEquals(typeof api.sendMessage, "function");
});

Deno.test("ChatApi: has getUsers method", () => {
  const api = new ChatApi();
  assertEquals(typeof api.getUsers, "function");
});
