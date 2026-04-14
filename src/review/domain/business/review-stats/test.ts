import { assertEquals } from "#assert";
import { computeReviewRate } from "./mod.ts";
Deno.test("review rate — decisions per hour", () => { assertEquals(computeReviewRate(60, 2), 30); });
Deno.test("review rate — zero hours returns 0", () => { assertEquals(computeReviewRate(10, 0), 0); });
