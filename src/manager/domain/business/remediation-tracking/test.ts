import { assertEquals } from "#assert";
import { isOverdue } from "./mod.ts";
Deno.test("overdue — no remediation", () => { assertEquals(isOverdue(undefined), true); });
Deno.test("overdue — recent", () => { assertEquals(isOverdue(Date.now()), false); });
