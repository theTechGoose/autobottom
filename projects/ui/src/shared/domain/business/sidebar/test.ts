import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Sidebar } from "./mod.ts";

Deno.test("Sidebar - role property is required (can be set)", () => {
  const sidebar = new Sidebar();
  sidebar.role = "admin";
  assertEquals(sidebar.role, "admin");
});

Deno.test("Sidebar - default active is empty string", () => {
  const sidebar = new Sidebar();
  assertEquals(sidebar.active, "");
});

Deno.test("Sidebar - admin links include admin, review, judge, and shared links", () => {
  const sidebar = new Sidebar();
  sidebar.role = "admin";
  const links = sidebar.links;
  const hrefs = links.map((l) => l.href);
  // Admin-specific
  assertEquals(hrefs.includes("/admin/dashboard"), true);
  assertEquals(hrefs.includes("/admin/users"), true);
  assertEquals(hrefs.includes("/admin/pipeline"), true);
  // Review links
  assertEquals(hrefs.includes("/review"), true);
  assertEquals(hrefs.includes("/review/dashboard"), true);
  // Judge links
  assertEquals(hrefs.includes("/judge"), true);
  assertEquals(hrefs.includes("/judge/dashboard"), true);
  // Shared links
  assertEquals(hrefs.includes("/gamification"), true);
  assertEquals(hrefs.includes("/chat"), true);
});

Deno.test("Sidebar - reviewer links include review and shared links", () => {
  const sidebar = new Sidebar();
  sidebar.role = "reviewer";
  const links = sidebar.links;
  const hrefs = links.map((l) => l.href);
  assertEquals(hrefs.includes("/review"), true);
  assertEquals(hrefs.includes("/review/dashboard"), true);
  assertEquals(hrefs.includes("/gamification"), true);
  assertEquals(hrefs.includes("/chat"), true);
  // Should NOT include admin links
  assertEquals(hrefs.includes("/admin/dashboard"), false);
});

Deno.test("Sidebar - judge links include judge and shared links", () => {
  const sidebar = new Sidebar();
  sidebar.role = "judge";
  const links = sidebar.links;
  const hrefs = links.map((l) => l.href);
  assertEquals(hrefs.includes("/judge"), true);
  assertEquals(hrefs.includes("/judge/dashboard"), true);
  assertEquals(hrefs.includes("/gamification"), true);
  assertEquals(hrefs.includes("/chat"), true);
  assertEquals(hrefs.includes("/admin/dashboard"), false);
});

Deno.test("Sidebar - manager links include manager and shared links", () => {
  const sidebar = new Sidebar();
  sidebar.role = "manager";
  const links = sidebar.links;
  const hrefs = links.map((l) => l.href);
  assertEquals(hrefs.includes("/manager"), true);
  assertEquals(hrefs.includes("/gamification"), true);
  assertEquals(hrefs.includes("/chat"), true);
});

Deno.test("Sidebar - user links include agent and shared links", () => {
  const sidebar = new Sidebar();
  sidebar.role = "user";
  const links = sidebar.links;
  const hrefs = links.map((l) => l.href);
  assertEquals(hrefs.includes("/agent"), true);
  assertEquals(hrefs.includes("/agent/store"), true);
  assertEquals(hrefs.includes("/gamification"), true);
  assertEquals(hrefs.includes("/chat"), true);
});

Deno.test("Sidebar - unknown role returns only shared links", () => {
  const sidebar = new Sidebar();
  sidebar.role = "unknown";
  const links = sidebar.links;
  const hrefs = links.map((l) => l.href);
  assertEquals(links.length, 2);
  assertEquals(hrefs.includes("/gamification"), true);
  assertEquals(hrefs.includes("/chat"), true);
});

Deno.test("Sidebar - each link has href, label, and iconColor", () => {
  const sidebar = new Sidebar();
  sidebar.role = "admin";
  for (const link of sidebar.links) {
    assertEquals(typeof link.href, "string");
    assertEquals(typeof link.label, "string");
    assertEquals(typeof link.iconColor, "string");
  }
});
