import { assertEquals } from "jsr:@std/assert";
import { MessageThread } from "./mod.ts";

Deno.test("MessageThread - can be instantiated", () => {
  const mt = new MessageThread();
  assertEquals(mt instanceof MessageThread, true);
});

Deno.test("MessageThread - default messages is empty array", () => {
  const mt = new MessageThread();
  assertEquals(mt.messages, []);
});

Deno.test("MessageThread - default myEmail is empty string", () => {
  const mt = new MessageThread();
  assertEquals(mt.myEmail, "");
});

Deno.test("MessageThread - groupedMessages returns empty array when no messages", () => {
  const mt = new MessageThread();
  assertEquals(mt.groupedMessages, []);
});

Deno.test("MessageThread - groupedMessages groups messages by date label", () => {
  const mt = new MessageThread();
  const today = new Date();
  const todayStr = today.toISOString();

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString();

  mt.messages = [
    { from: "a@t.com", to: "b@t.com", body: "hello", time: todayStr },
    { from: "b@t.com", to: "a@t.com", body: "hi", time: todayStr },
    { from: "a@t.com", to: "b@t.com", body: "old msg", time: yesterdayStr },
  ];

  const groups = mt.groupedMessages;
  assertEquals(groups.length, 2);
  assertEquals(groups[0].label, "Yesterday");
  assertEquals(groups[0].messages.length, 1);
  assertEquals(groups[1].label, "Today");
  assertEquals(groups[1].messages.length, 2);
});

Deno.test("MessageThread - groupedMessages labels today correctly", () => {
  const mt = new MessageThread();
  const now = new Date().toISOString();
  mt.messages = [{ from: "a@t.com", to: "b@t.com", body: "test", time: now }];
  const groups = mt.groupedMessages;
  assertEquals(groups[0].label, "Today");
});

Deno.test("MessageThread - groupedMessages labels yesterday correctly", () => {
  const mt = new MessageThread();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  mt.messages = [{ from: "a@t.com", to: "b@t.com", body: "test", time: yesterday.toISOString() }];
  const groups = mt.groupedMessages;
  assertEquals(groups[0].label, "Yesterday");
});

Deno.test("MessageThread - groupedMessages uses date string for older messages", () => {
  const mt = new MessageThread();
  const old = new Date("2024-01-15T12:00:00Z");
  mt.messages = [{ from: "a@t.com", to: "b@t.com", body: "test", time: old.toISOString() }];
  const groups = mt.groupedMessages;
  assertEquals(typeof groups[0].label, "string");
  assertEquals(groups[0].label !== "Today", true);
  assertEquals(groups[0].label !== "Yesterday", true);
});

Deno.test("MessageThread - groupedMessages sorts chronologically", () => {
  const mt = new MessageThread();
  const t1 = new Date("2024-06-01T10:00:00Z").toISOString();
  const t2 = new Date("2024-06-01T11:00:00Z").toISOString();
  mt.messages = [
    { from: "b@t.com", to: "a@t.com", body: "second", time: t2 },
    { from: "a@t.com", to: "b@t.com", body: "first", time: t1 },
  ];
  const groups = mt.groupedMessages;
  assertEquals(groups[0].messages[0].body, "first");
  assertEquals(groups[0].messages[1].body, "second");
});
