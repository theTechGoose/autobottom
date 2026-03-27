import { assertEquals } from "jsr:@std/assert";
import { BadgeEditorCoordinator } from "./mod.ts";

Deno.test("BadgeEditorCoordinator - can be instantiated", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(comp instanceof BadgeEditorCoordinator, true);
});

Deno.test("BadgeEditorCoordinator - default allItems is empty array", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(comp.allItems, []);
});

Deno.test("BadgeEditorCoordinator - default activeFilter is 'all'", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(comp.activeFilter, "all");
});

Deno.test("BadgeEditorCoordinator - default modalOpen is false", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(comp.modalOpen, false);
});

Deno.test("BadgeEditorCoordinator - default modalMode is 'create'", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(comp.modalMode, "create");
});

Deno.test("BadgeEditorCoordinator - default toasts is empty array", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(comp.toasts, []);
});

Deno.test("BadgeEditorCoordinator - has loadItems method", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(typeof comp.loadItems, "function");
});

Deno.test("BadgeEditorCoordinator - has saveItem method", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(typeof comp.saveItem, "function");
});

Deno.test("BadgeEditorCoordinator - has deleteItem method", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(typeof comp.deleteItem, "function");
});

Deno.test("BadgeEditorCoordinator - has openModal method", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(typeof comp.openModal, "function");
});

Deno.test("BadgeEditorCoordinator - has closeModal method", () => {
  const comp = new BadgeEditorCoordinator();
  assertEquals(typeof comp.closeModal, "function");
});

Deno.test("BadgeEditorCoordinator - openModal sets modalOpen to true", () => {
  const comp = new BadgeEditorCoordinator();
  comp.openModal();
  assertEquals(comp.modalOpen, true);
});

Deno.test("BadgeEditorCoordinator - closeModal sets modalOpen to false", () => {
  const comp = new BadgeEditorCoordinator();
  comp.openModal();
  comp.closeModal();
  assertEquals(comp.modalOpen, false);
});
