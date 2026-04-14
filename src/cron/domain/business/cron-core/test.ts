import { assertEquals } from "#assert";
import { MODULE_NAME } from "./mod.ts";
Deno.test("cron module name", () => { assertEquals(MODULE_NAME, "cron"); });
