import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TopbarLayout } from "./mod.ts";

Deno.test("TopbarLayout - default backHref is /admin/dashboard", () => {
  const layout = new TopbarLayout();
  assertEquals(layout.backHref, "/admin/dashboard");
});

Deno.test("TopbarLayout - title property exists and is assignable", () => {
  const layout = new TopbarLayout();
  layout.title = "Gamification";
  assertEquals(layout.title, "Gamification");
});

Deno.test("TopbarLayout - backHref property accepts custom value", () => {
  const layout = new TopbarLayout();
  layout.backHref = "/judge/dashboard";
  assertEquals(layout.backHref, "/judge/dashboard");
});
