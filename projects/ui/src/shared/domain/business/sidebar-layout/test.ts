import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SidebarLayout } from "./mod.ts";

Deno.test("SidebarLayout - default active is empty string", () => {
  const layout = new SidebarLayout();
  assertEquals(layout.active, "");
});

Deno.test("SidebarLayout - role property exists and is assignable", () => {
  const layout = new SidebarLayout();
  layout.role = "admin";
  assertEquals(layout.role, "admin");
});

Deno.test("SidebarLayout - active property accepts custom value", () => {
  const layout = new SidebarLayout();
  layout.active = "/admin/dashboard";
  assertEquals(layout.active, "/admin/dashboard");
});
