import { assertEquals } from "#assert";
import { isValidConfigName } from "./mod.ts";
Deno.test("valid config name", () => { assertEquals(isValidConfigName("My Config"), true); });
Deno.test("too short", () => { assertEquals(isValidConfigName("ab"), false); });
