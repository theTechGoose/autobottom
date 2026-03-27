import { assertEquals, assertExists } from "jsr:@std/assert";
import { ChatRoom } from "./mod.ts";

Deno.test("ChatRoom - can be instantiated", () => {
  const room = new ChatRoom();
  assertExists(room);
});

Deno.test("ChatRoom - default me is null", () => {
  const room = new ChatRoom();
  assertEquals(room.me, null);
});

Deno.test("ChatRoom - default conversations is empty array", () => {
  const room = new ChatRoom();
  assertEquals(room.conversations, []);
});

Deno.test("ChatRoom - default allUsers is empty array", () => {
  const room = new ChatRoom();
  assertEquals(room.allUsers, []);
});

Deno.test("ChatRoom - default activeEmail is empty string", () => {
  const room = new ChatRoom();
  assertEquals(room.activeEmail, "");
});

Deno.test("ChatRoom - default messages is empty array", () => {
  const room = new ChatRoom();
  assertEquals(room.messages, []);
});

Deno.test("ChatRoom - default msgInput is empty string", () => {
  const room = new ChatRoom();
  assertEquals(room.msgInput, "");
});

Deno.test("ChatRoom - default sending is false", () => {
  const room = new ChatRoom();
  assertEquals(room.sending, false);
});

Deno.test("ChatRoom - default convSearch is empty string", () => {
  const room = new ChatRoom();
  assertEquals(room.convSearch, "");
});

Deno.test("ChatRoom - default modalOpen is false", () => {
  const room = new ChatRoom();
  assertEquals(room.modalOpen, false);
});

Deno.test("ChatRoom - default modalSearch is empty string", () => {
  const room = new ChatRoom();
  assertEquals(room.modalSearch, "");
});

Deno.test("ChatRoom - default loadingConv is false", () => {
  const room = new ChatRoom();
  assertEquals(room.loadingConv, false);
});

Deno.test("ChatRoom - default initialized is false", () => {
  const room = new ChatRoom();
  assertEquals(room.initialized, false);
});

Deno.test("ChatRoom - has init method", () => {
  const room = new ChatRoom();
  assertEquals(typeof room.init, "function");
});

Deno.test("ChatRoom - has openConversation method", () => {
  const room = new ChatRoom();
  assertEquals(typeof room.openConversation, "function");
});

Deno.test("ChatRoom - has sendMsg method", () => {
  const room = new ChatRoom();
  assertEquals(typeof room.sendMsg, "function");
});

Deno.test("ChatRoom - has startPolling method", () => {
  const room = new ChatRoom();
  assertEquals(typeof room.startPolling, "function");
});

Deno.test("ChatRoom - has stopPolling method", () => {
  const room = new ChatRoom();
  assertEquals(typeof room.stopPolling, "function");
});
