import { assertEquals } from "#assert";
import { MODULE_NAME } from "./mod.ts";
Deno.test("chat module name", () => { assertEquals(MODULE_NAME, "chat"); });
