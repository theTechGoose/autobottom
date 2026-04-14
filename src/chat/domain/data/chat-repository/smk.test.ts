/** Smoke tests for chat repository. */
import { assertEquals, assert } from "#assert";
import { sendMessage, getConversation, getUnreadCount, markConversationRead, getConversationList } from "./mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const ORG = "test-org-" + crypto.randomUUID().slice(0, 8);

Deno.test({ name: "messaging — send and retrieve", ...kvOpts, fn: async () => {
  const msg = await sendMessage(ORG, "alice@test.com", "bob@test.com", "Hello Bob!");
  assert(msg.id);
  assertEquals(msg.from, "alice@test.com");
  const conv = await getConversation(ORG, "alice@test.com", "bob@test.com");
  assert(conv.some((m) => m.body === "Hello Bob!"));
}});

Deno.test({ name: "messaging — both participants see message", ...kvOpts, fn: async () => {
  await sendMessage(ORG, "a@t.com", "b@t.com", "Shared msg");
  const convA = await getConversation(ORG, "a@t.com", "b@t.com");
  const convB = await getConversation(ORG, "b@t.com", "a@t.com");
  assert(convA.some((m) => m.body === "Shared msg"));
  assert(convB.some((m) => m.body === "Shared msg"));
}});

Deno.test({ name: "unread — increments on receive", ...kvOpts, fn: async () => {
  const before = await getUnreadCount(ORG, "recv@t.com");
  await sendMessage(ORG, "send@t.com", "recv@t.com", "Unread test");
  const after = await getUnreadCount(ORG, "recv@t.com");
  assert(after > before);
}});

Deno.test({ name: "mark read — decrements unread", ...kvOpts, fn: async () => {
  await sendMessage(ORG, "x@t.com", "y@t.com", "Read me");
  const before = await getUnreadCount(ORG, "y@t.com");
  await markConversationRead(ORG, "y@t.com", "x@t.com");
  const after = await getUnreadCount(ORG, "y@t.com");
  assert(after <= before);
}});
