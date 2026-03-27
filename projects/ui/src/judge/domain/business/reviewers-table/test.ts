import { assertEquals } from "jsr:@std/assert";
import { ReviewersTable } from "./mod.ts";

Deno.test("ReviewersTable - default reviewers is empty array", () => {
  const table = new ReviewersTable();
  assertEquals(table.reviewers, []);
});

Deno.test("ReviewersTable - default addModalOpen is false", () => {
  const table = new ReviewersTable();
  assertEquals(table.addModalOpen, false);
});

Deno.test("ReviewersTable - default revEmail is empty string", () => {
  const table = new ReviewersTable();
  assertEquals(table.revEmail, "");
});

Deno.test("ReviewersTable - default revPassword is empty string", () => {
  const table = new ReviewersTable();
  assertEquals(table.revPassword, "");
});

Deno.test("ReviewersTable - default addLoading is false", () => {
  const table = new ReviewersTable();
  assertEquals(table.addLoading, false);
});

Deno.test("ReviewersTable - default addError is empty string", () => {
  const table = new ReviewersTable();
  assertEquals(table.addError, "");
});

Deno.test("ReviewersTable - reviewers can be set", () => {
  const table = new ReviewersTable();
  const data = [{ username: "alice@test.com", createdAt: 1700000000000 }];
  table.reviewers = data;
  assertEquals(table.reviewers.length, 1);
  assertEquals(table.reviewers[0].username, "alice@test.com");
});

Deno.test("ReviewersTable - openAddModal sets state correctly", () => {
  const table = new ReviewersTable();
  table.openAddModal();
  assertEquals(table.addModalOpen, true);
  assertEquals(table.addError, "");
  assertEquals(table.revEmail, "");
  assertEquals(table.revPassword, "");
});

Deno.test("ReviewersTable - closeAddModal sets addModalOpen to false", () => {
  const table = new ReviewersTable();
  table.addModalOpen = true;
  table.closeAddModal();
  assertEquals(table.addModalOpen, false);
});
