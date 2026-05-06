import { assertEquals } from "#assert";
import { MODULE_NAME } from "./mod.ts";
Deno.test("events module name", () => { assertEquals(MODULE_NAME, "events"); });
