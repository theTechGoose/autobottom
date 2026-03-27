import { assertEquals } from "jsr:@std/assert";
import { BadgeItemModal } from "./mod.ts";

Deno.test("BadgeItemModal - can be instantiated", () => {
  const comp = new BadgeItemModal();
  assertEquals(comp instanceof BadgeItemModal, true);
});

Deno.test("BadgeItemModal - default open is false", () => {
  const comp = new BadgeItemModal();
  assertEquals(comp.open, false);
});

Deno.test("BadgeItemModal - default mode is 'create'", () => {
  const comp = new BadgeItemModal();
  assertEquals(comp.mode, "create");
});

Deno.test("BadgeItemModal - default form fields", () => {
  const comp = new BadgeItemModal();
  assertEquals(comp.id, "");
  assertEquals(comp.name, "");
  assertEquals(comp.type, "title");
  assertEquals(comp.price, 0);
  assertEquals(comp.icon, "");
  assertEquals(comp.preview, "");
  assertEquals(comp.description, "");
  assertEquals(comp.saving, false);
});

Deno.test("BadgeItemModal - has save method", () => {
  const comp = new BadgeItemModal();
  assertEquals(typeof comp.save, "function");
});

Deno.test("BadgeItemModal - has close method", () => {
  const comp = new BadgeItemModal();
  assertEquals(typeof comp.close, "function");
});

Deno.test("BadgeItemModal - close sets open to false", () => {
  const comp = new BadgeItemModal();
  comp.open = true;
  comp.close();
  assertEquals(comp.open, false);
});
