import { assertEquals } from "jsr:@std/assert";
import { StoreWalletBar } from "./mod.ts";

Deno.test("StoreWalletBar - can be instantiated", () => {
  const comp = new StoreWalletBar();
  assertEquals(comp instanceof StoreWalletBar, true);
});

Deno.test("StoreWalletBar - default balance is 0", () => {
  const comp = new StoreWalletBar();
  assertEquals(comp.balance, 0);
});

Deno.test("StoreWalletBar - default level is 1", () => {
  const comp = new StoreWalletBar();
  assertEquals(comp.level, 1);
});

Deno.test("StoreWalletBar - default totalXp is 0", () => {
  const comp = new StoreWalletBar();
  assertEquals(comp.totalXp, 0);
});

Deno.test("StoreWalletBar - balance can be set", () => {
  const comp = new StoreWalletBar();
  comp.balance = 500;
  assertEquals(comp.balance, 500);
});
