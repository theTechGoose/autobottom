import { assertEquals } from "#assert";
import { validateAgentEmail } from "./mod.ts";
Deno.test("valid email passes", () => { assertEquals(validateAgentEmail("a@b.com"), true); });
Deno.test("invalid email fails", () => { assertEquals(validateAgentEmail("notanemail"), false); });
