import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FullLayout } from "./mod.ts";

Deno.test("FullLayout - default links is empty array", () => {
  const layout = new FullLayout();
  assertEquals(layout.links, []);
});

Deno.test("FullLayout - default avatarId is nav-avatar", () => {
  const layout = new FullLayout();
  assertEquals(layout.avatarId, "nav-avatar");
});

Deno.test("FullLayout - default usernameId is nav-username", () => {
  const layout = new FullLayout();
  assertEquals(layout.usernameId, "nav-username");
});

Deno.test("FullLayout - default roleId is nav-role", () => {
  const layout = new FullLayout();
  assertEquals(layout.roleId, "nav-role");
});

Deno.test("FullLayout - accentColor property is assignable", () => {
  const layout = new FullLayout();
  layout.accentColor = "#f97316";
  assertEquals(layout.accentColor, "#f97316");
});

Deno.test("FullLayout - title property is assignable", () => {
  const layout = new FullLayout();
  layout.title = "Agent Panel";
  assertEquals(layout.title, "Agent Panel");
});

Deno.test("FullLayout - links property accepts array of link objects", () => {
  const layout = new FullLayout();
  layout.links = [
    { href: "/agent", label: "Dashboard", icon: "&#9776;", active: true },
    { href: "/chat", label: "Chat" },
  ];
  assertEquals(layout.links.length, 2);
  assertEquals(layout.links[0].href, "/agent");
  assertEquals(layout.links[0].active, true);
  assertEquals(layout.links[1].icon, undefined);
  assertEquals(layout.links[1].active, undefined);
});

Deno.test("FullLayout - required properties exist on prototype", () => {
  const layout = new FullLayout();
  assertExists(layout);
});
