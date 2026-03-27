import { assertExists } from "jsr:@std/assert";
import { ChatPage } from "./mod.ts";

Deno.test("ChatPage - can be instantiated", () => {
  const page = new ChatPage();
  assertExists(page);
});
