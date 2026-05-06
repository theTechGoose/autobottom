import { assertEquals } from "#assert";
import { registerCrons } from "./mod.ts";
Deno.test("registerCrons is a function", () => { assertEquals(typeof registerCrons, "function"); });
