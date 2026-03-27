import { assertEquals } from "jsr:@std/assert";
import { MessageInput } from "./mod.ts";

Deno.test("MessageInput - can be instantiated", () => {
  const mi = new MessageInput();
  assertEquals(mi instanceof MessageInput, true);
});

Deno.test("MessageInput - default text is empty string", () => {
  const mi = new MessageInput();
  assertEquals(mi.text, "");
});

Deno.test("MessageInput - default sending is false", () => {
  const mi = new MessageInput();
  assertEquals(mi.sending, false);
});

Deno.test("MessageInput - send() clears text", () => {
  const mi = new MessageInput();
  mi.text = "hello world";
  mi.send();
  assertEquals(mi.text, "");
});

Deno.test("MessageInput - send() does nothing when text is empty", () => {
  const mi = new MessageInput();
  mi.text = "";
  mi.send();
  assertEquals(mi.text, "");
});

Deno.test("MessageInput - send() does nothing when text is whitespace only", () => {
  const mi = new MessageInput();
  mi.text = "   ";
  mi.send();
  assertEquals(mi.text, "   ");
});
