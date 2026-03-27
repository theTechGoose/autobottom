import { assertEquals } from "jsr:@std/assert";
import { StoreView } from "./mod.ts";

Deno.test("StoreView - can be instantiated", () => {
  const view = new StoreView();
  assertEquals(view instanceof StoreView, true);
});

Deno.test("StoreView - default storeData is null", () => {
  const view = new StoreView();
  assertEquals(view.storeData, null);
});

Deno.test("StoreView - default loading is true", () => {
  const view = new StoreView();
  assertEquals(view.loading, true);
});

Deno.test("StoreView - default error is empty string", () => {
  const view = new StoreView();
  assertEquals(view.error, "");
});

Deno.test("StoreView - default toasts is empty array", () => {
  const view = new StoreView();
  assertEquals(view.toasts, []);
});

Deno.test("StoreView - has loadStore method", () => {
  const view = new StoreView();
  assertEquals(typeof view.loadStore, "function");
});

Deno.test("StoreView - has buyItem method", () => {
  const view = new StoreView();
  assertEquals(typeof view.buyItem, "function");
});

Deno.test("StoreView - has showToast method", () => {
  const view = new StoreView();
  assertEquals(typeof view.showToast, "function");
});
