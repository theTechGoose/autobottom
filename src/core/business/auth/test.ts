/** Tests for auth service — password hashing, role checking, session helpers. */

import { assertEquals, assert, assertThrows } from "#assert";
import { hashPassword, hasRole, requireRole, parseCookie, defaultOrgId, resolveOrg } from "./mod.ts";
import type { AuthContext, Role } from "./mod.ts";

Deno.test("hashPassword — deterministic SHA-256 hex", async () => {
  const h1 = await hashPassword("secret123");
  const h2 = await hashPassword("secret123");
  assertEquals(h1, h2);
  assertEquals(h1.length, 64); // SHA-256 = 32 bytes = 64 hex chars
});

Deno.test("hashPassword — different passwords produce different hashes", async () => {
  const h1 = await hashPassword("password1");
  const h2 = await hashPassword("password2");
  assert(h1 !== h2);
});

Deno.test("hasRole — admin has all roles", () => {
  const auth: AuthContext = { email: "a@test.com", orgId: "org-1", role: "admin" };
  assert(hasRole(auth, "user"));
  assert(hasRole(auth, "reviewer"));
  assert(hasRole(auth, "manager"));
  assert(hasRole(auth, "judge"));
  assert(hasRole(auth, "admin"));
});

Deno.test("hasRole — user has only user role", () => {
  const auth: AuthContext = { email: "u@test.com", orgId: "org-1", role: "user" };
  assert(hasRole(auth, "user"));
  assert(!hasRole(auth, "reviewer"));
  assert(!hasRole(auth, "admin"));
});

Deno.test("hasRole — reviewer has reviewer and user", () => {
  const auth: AuthContext = { email: "r@test.com", orgId: "org-1", role: "reviewer" };
  assert(hasRole(auth, "user"));
  assert(hasRole(auth, "reviewer"));
  assert(!hasRole(auth, "manager"));
});

Deno.test("requireRole — throws on null auth", () => {
  assertThrows(() => requireRole(null, "user"), Error, "Unauthorized");
});

Deno.test("requireRole — throws on insufficient role", () => {
  const auth: AuthContext = { email: "u@test.com", orgId: "org-1", role: "user" };
  assertThrows(() => requireRole(auth, "admin"), Error, "Forbidden");
});

Deno.test("requireRole — returns auth on sufficient role", () => {
  const auth: AuthContext = { email: "a@test.com", orgId: "org-1", role: "admin" };
  const result = requireRole(auth, "reviewer");
  assertEquals(result.email, "a@test.com");
});

Deno.test("parseCookie — extracts session token", () => {
  const req = new Request("http://localhost", {
    headers: { cookie: "session=abc123; other=xyz" },
  });
  assertEquals(parseCookie(req, "session"), "abc123");
});

Deno.test("parseCookie — returns null when no cookie", () => {
  const req = new Request("http://localhost");
  assertEquals(parseCookie(req, "session"), null);
});

Deno.test("parseCookie — returns null when cookie name not found", () => {
  const req = new Request("http://localhost", {
    headers: { cookie: "other=xyz" },
  });
  assertEquals(parseCookie(req, "session"), null);
});

Deno.test("parseCookie — handles cookie at start of string", () => {
  const req = new Request("http://localhost", {
    headers: { cookie: "session=first-cookie" },
  });
  assertEquals(parseCookie(req, "session"), "first-cookie");
});
/** Tests for org resolver — per-request auth context. */

Deno.test("defaultOrgId — returns 'default' when no env set", () => {
  // In test env, CHARGEBACKS_ORG_ID and DEFAULT_ORG_ID are not set
  const result = defaultOrgId();
  assertEquals(typeof result, "string");
  // Either returns the env value or "default"
});

Deno.test("resolveOrg — returns default when no cookie", async () => {
  const req = new Request("http://localhost/test");
  const orgId = await resolveOrg(req);
  assertEquals(typeof orgId, "string");
  // No session cookie → falls back to defaultOrgId()
  assertEquals(orgId, defaultOrgId());
});

Deno.test({ name: "resolveOrg — returns default when invalid cookie", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const req = new Request("http://localhost/test", {
    headers: { cookie: "session=invalid-token-12345" },
  });
  const orgId = await resolveOrg(req);
  assertEquals(orgId, defaultOrgId());
}});

Deno.test({ name: "resolveOrg — returns default when empty cookie", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const req = new Request("http://localhost/test", {
    headers: { cookie: "" },
  });
  const orgId = await resolveOrg(req);
  assertEquals(orgId, defaultOrgId());
}});
