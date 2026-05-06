import { assertEquals } from "#assert";
import { computeOverturnRate } from "./mod.ts";
Deno.test("overturn rate — 50%", () => { assertEquals(computeOverturnRate(5, 10), 50); });
Deno.test("overturn rate — zero total", () => { assertEquals(computeOverturnRate(0, 0), 0); });
