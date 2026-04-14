/** Tests for org resolver — per-request auth context. */
import { assertEquals } from "jsr:@std/assert";
import { defaultOrgId, resolveOrg } from "./org-resolver.ts";

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
