import { assertEquals } from "#assert";
import { isAppealExpired } from "./mod.ts";
Deno.test("appeal not expired — recent", () => { assertEquals(isAppealExpired(Date.now()), false); });
Deno.test("appeal expired — old", () => { assertEquals(isAppealExpired(Date.now() - 30 * 86400000), true); });
