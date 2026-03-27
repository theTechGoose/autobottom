import { assertEquals } from "jsr:@std/assert";
import { ConversationList } from "./mod.ts";

Deno.test("ConversationList - can be instantiated", () => {
  const cl = new ConversationList();
  assertEquals(cl instanceof ConversationList, true);
});

Deno.test("ConversationList - default conversations is empty array", () => {
  const cl = new ConversationList();
  assertEquals(cl.conversations, []);
});

Deno.test("ConversationList - default activeEmail is empty string", () => {
  const cl = new ConversationList();
  assertEquals(cl.activeEmail, "");
});

Deno.test("ConversationList - default searchQuery is empty string", () => {
  const cl = new ConversationList();
  assertEquals(cl.searchQuery, "");
});

Deno.test("ConversationList - filteredConversations returns all when searchQuery is empty", () => {
  const cl = new ConversationList();
  cl.conversations = [
    { email: "alice@test.com", lastMessage: "hi", lastTime: "1pm", unread: 0 },
    { email: "bob@test.com", lastMessage: "hey", lastTime: "2pm", unread: 1 },
  ];
  assertEquals(cl.filteredConversations.length, 2);
});

Deno.test("ConversationList - filteredConversations filters by searchQuery", () => {
  const cl = new ConversationList();
  cl.conversations = [
    { email: "alice@test.com", lastMessage: "hi", lastTime: "1pm", unread: 0 },
    { email: "bob@test.com", lastMessage: "hey", lastTime: "2pm", unread: 1 },
  ];
  cl.searchQuery = "alice";
  const result = cl.filteredConversations;
  assertEquals(result.length, 1);
  assertEquals(result[0].email, "alice@test.com");
});

Deno.test("ConversationList - filteredConversations is case-insensitive", () => {
  const cl = new ConversationList();
  cl.conversations = [
    { email: "Alice@test.com", lastMessage: "hi", lastTime: "1pm", unread: 0 },
  ];
  cl.searchQuery = "alice";
  assertEquals(cl.filteredConversations.length, 1);
});

Deno.test("ConversationList - filteredConversations returns empty when no matches", () => {
  const cl = new ConversationList();
  cl.conversations = [
    { email: "alice@test.com", lastMessage: "hi", lastTime: "1pm", unread: 0 },
  ];
  cl.searchQuery = "xyz";
  assertEquals(cl.filteredConversations.length, 0);
});
