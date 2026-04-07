import { assertEquals } from "@std/assert";
import {
  AuthContextSchema,
  OrgRecordSchema,
  RoleSchema,
  UserRecordSchema,
} from "./auth.ts";

Deno.test("Role schema snapshot — all values", () => {
  for (const role of ["admin", "judge", "manager", "reviewer", "user"] as const) {
    assertEquals(RoleSchema.parse(role), role);
  }
});

Deno.test("OrgRecord schema snapshot", () => {
  const fixture = {
    name: "Acme Corp",
    slug: "acme-corp",
    createdAt: 1700000000000,
    createdBy: "admin@acme.com",
  };
  const parsed = OrgRecordSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("UserRecord schema snapshot — required fields only", () => {
  const fixture = {
    passwordHash: "abc123hash",
    role: "reviewer" as const,
    createdAt: 1700000000000,
  };
  const parsed = UserRecordSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("UserRecord schema snapshot — with supervisor", () => {
  const fixture = {
    passwordHash: "abc123hash",
    role: "reviewer" as const,
    supervisor: "manager@acme.com",
    createdAt: 1700000000000,
  };
  const parsed = UserRecordSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("UserRecord schema snapshot — supervisor null", () => {
  const fixture = {
    passwordHash: "abc123hash",
    role: "judge" as const,
    supervisor: null,
    createdAt: 1700000000000,
  };
  const parsed = UserRecordSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("AuthContext schema snapshot", () => {
  const fixture = {
    email: "user@acme.com",
    orgId: "org-001",
    role: "manager" as const,
  };
  const parsed = AuthContextSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
