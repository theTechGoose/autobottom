import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { UsersModal } from "./mod.ts";

Deno.test("UsersModal - default open is false", () => {
  const modal = new UsersModal();
  assertEquals(modal.open, false);
});

Deno.test("UsersModal - default allUsers is empty array", () => {
  const modal = new UsersModal();
  assertEquals(modal.allUsers, []);
});

Deno.test("UsersModal - default tab is 'list'", () => {
  const modal = new UsersModal();
  assertEquals(modal.tab, "list");
});

Deno.test("UsersModal - default selectedRole is 'reviewer'", () => {
  const modal = new UsersModal();
  assertEquals(modal.selectedRole, "reviewer");
});

Deno.test("UsersModal - default newEmail is empty string", () => {
  const modal = new UsersModal();
  assertEquals(modal.newEmail, "");
});

Deno.test("UsersModal - default newPassword is empty string", () => {
  const modal = new UsersModal();
  assertEquals(modal.newPassword, "");
});

Deno.test("UsersModal - default newSupervisor is empty string", () => {
  const modal = new UsersModal();
  assertEquals(modal.newSupervisor, "");
});

Deno.test("UsersModal - default saving is false", () => {
  const modal = new UsersModal();
  assertEquals(modal.saving, false);
});

Deno.test("UsersModal - default currentAdminEmail is empty string", () => {
  const modal = new UsersModal();
  assertEquals(modal.currentAdminEmail, "");
});

Deno.test("UsersModal - has fetchUsers method", () => {
  const modal = new UsersModal();
  assertEquals(typeof modal.fetchUsers, "function");
});

Deno.test("UsersModal - has createUser method", () => {
  const modal = new UsersModal();
  assertEquals(typeof modal.createUser, "function");
});

Deno.test("UsersModal - supervisorOptions filters judges/managers for reviewer role", () => {
  const modal = new UsersModal();
  modal.allUsers = [
    { username: "admin@test.com", role: "admin" },
    { username: "judge@test.com", role: "judge" },
    { username: "reviewer@test.com", role: "reviewer" },
  ];
  modal.selectedRole = "reviewer";
  const options = modal.supervisorOptions;
  assertEquals(options.length, 1);
  assertEquals(options[0].username, "judge@test.com");
});

Deno.test("UsersModal - supervisorOptions filters admins for judge role", () => {
  const modal = new UsersModal();
  modal.allUsers = [
    { username: "admin@test.com", role: "admin" },
    { username: "judge@test.com", role: "judge" },
  ];
  modal.selectedRole = "judge";
  const options = modal.supervisorOptions;
  assertEquals(options.length, 1);
  assertEquals(options[0].username, "admin@test.com");
});

Deno.test("UsersModal - supervisorOptions returns empty for admin role", () => {
  const modal = new UsersModal();
  modal.allUsers = [
    { username: "admin@test.com", role: "admin" },
    { username: "judge@test.com", role: "judge" },
  ];
  modal.selectedRole = "admin";
  const options = modal.supervisorOptions;
  assertEquals(options.length, 0);
});
