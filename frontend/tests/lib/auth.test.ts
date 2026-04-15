import { assertEquals } from "@std/assert";
import { isPublicPath, roleRedirect } from "../../lib/auth.ts";

Deno.test("isPublicPath — login and register are public", () => {
  assertEquals(isPublicPath("/login"), true);
  assertEquals(isPublicPath("/register"), true);
  assertEquals(isPublicPath("/api/login"), true);
  assertEquals(isPublicPath("/api/register"), true);
});

Deno.test("isPublicPath — protected paths are not public", () => {
  assertEquals(isPublicPath("/admin/dashboard"), false);
  assertEquals(isPublicPath("/review"), false);
  assertEquals(isPublicPath("/judge"), false);
  assertEquals(isPublicPath("/"), false);
});

Deno.test("isPublicPath — subpaths of public paths are public", () => {
  assertEquals(isPublicPath("/login/"), true);
  assertEquals(isPublicPath("/api/login/extra"), true);
});

Deno.test("roleRedirect returns correct paths", () => {
  assertEquals(roleRedirect("admin"), "/admin/dashboard");
  assertEquals(roleRedirect("reviewer"), "/review");
  assertEquals(roleRedirect("judge"), "/judge");
  assertEquals(roleRedirect("manager"), "/manager");
  assertEquals(roleRedirect("user"), "/agent");
});

Deno.test("roleRedirect returns / for unknown role", () => {
  assertEquals(roleRedirect("bogus" as any), "/");
});
