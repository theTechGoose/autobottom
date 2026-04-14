import { assertEquals } from "#assert";
import { calculateXp } from "./mod.ts";
Deno.test("calculateXp — base XP", () => { assertEquals(calculateXp(100), 100); });
Deno.test("calculateXp — with multiplier", () => { assertEquals(calculateXp(100, 1.5), 150); });
