import { assertEquals } from "#assert";
import { shouldBroadcast } from "./mod.ts";
Deno.test("broadcast — subscribed", () => { assertEquals(shouldBroadcast("sale", { sale: true }), true); });
Deno.test("broadcast — not subscribed", () => { assertEquals(shouldBroadcast("sale", {}), false); });
