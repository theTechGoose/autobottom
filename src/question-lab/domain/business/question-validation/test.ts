import { assertEquals } from "#assert";
import { validateQuestionText } from "./mod.ts";
Deno.test("validate — empty is invalid", () => { assertEquals(validateQuestionText("").valid, false); });
Deno.test("validate — good question is valid", () => { assertEquals(validateQuestionText("Was the income disclosed properly?").valid, true); });
