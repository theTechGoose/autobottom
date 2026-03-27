import { assertEquals } from "jsr:@std/assert";
import { NewMessageModal } from "./mod.ts";

Deno.test("NewMessageModal - can be instantiated", () => {
  const modal = new NewMessageModal();
  assertEquals(modal instanceof NewMessageModal, true);
});

Deno.test("NewMessageModal - default open is false", () => {
  const modal = new NewMessageModal();
  assertEquals(modal.open, false);
});

Deno.test("NewMessageModal - default users is empty array", () => {
  const modal = new NewMessageModal();
  assertEquals(modal.users, []);
});

Deno.test("NewMessageModal - default searchQuery is empty string", () => {
  const modal = new NewMessageModal();
  assertEquals(modal.searchQuery, "");
});

Deno.test("NewMessageModal - filteredUsers returns all when searchQuery is empty", () => {
  const modal = new NewMessageModal();
  modal.users = [
    { email: "alice@test.com", role: "admin" },
    { email: "bob@test.com", role: "user" },
  ];
  assertEquals(modal.filteredUsers.length, 2);
});

Deno.test("NewMessageModal - filteredUsers filters by searchQuery", () => {
  const modal = new NewMessageModal();
  modal.users = [
    { email: "alice@test.com", role: "admin" },
    { email: "bob@test.com", role: "user" },
  ];
  modal.searchQuery = "bob";
  const result = modal.filteredUsers;
  assertEquals(result.length, 1);
  assertEquals(result[0].email, "bob@test.com");
});

Deno.test("NewMessageModal - filteredUsers is case-insensitive", () => {
  const modal = new NewMessageModal();
  modal.users = [
    { email: "Alice@test.com", role: "admin" },
  ];
  modal.searchQuery = "ALICE";
  assertEquals(modal.filteredUsers.length, 1);
});

Deno.test("NewMessageModal - filteredUsers returns empty when no matches", () => {
  const modal = new NewMessageModal();
  modal.users = [
    { email: "alice@test.com", role: "admin" },
  ];
  modal.searchQuery = "zzz";
  assertEquals(modal.filteredUsers.length, 0);
});
