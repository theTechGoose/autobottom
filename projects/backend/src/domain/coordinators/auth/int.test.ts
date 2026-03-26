/** Integration tests for auth/kv.ts using an in-memory KV instance. */

import { assertEquals, assertNotEquals } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../../../kv-factory.ts";
import {
  createOrg,
  getOrg,
  listOrgs,
  createUser,
  getUser,
  deleteUser,
  listUsers,
  verifyUser,
  createSession,
  authenticate,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function freshKv(): Promise<Deno.Kv> {
  const kv = await Deno.openKv(":memory:");
  setKvInstance(kv);
  return kv;
}

async function teardown(kv: Deno.Kv): Promise<void> {
  kv.close();
  resetKvInstance();
}

// ---------------------------------------------------------------------------
// 1. createOrg / getOrg
// ---------------------------------------------------------------------------

Deno.test({
  name: "createOrg / getOrg — stores name, slug, createdBy",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("Test Org", "admin@example.com");
      assertNotEquals(orgId, "");

      const org = await getOrg(orgId);
      assertEquals(org?.name, "Test Org");
      assertEquals(org?.slug, "test-org");
      assertEquals(org?.createdBy, "admin@example.com");
    } finally {
      await teardown(kv);
    }
  },
});

Deno.test({
  name: "getOrg — returns null for unknown id",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const result = await getOrg("nonexistent-id");
      assertEquals(result, null);
    } finally {
      await teardown(kv);
    }
  },
});

// ---------------------------------------------------------------------------
// 2. createUser / getUser / verifyUser
// ---------------------------------------------------------------------------

Deno.test({
  name: "createUser / getUser — stored user has correct role",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("User Org", "admin@example.com");
      await createUser(orgId, "alice@example.com", "secret123", "judge");

      const user = await getUser(orgId, "alice@example.com");
      assertEquals(user?.role, "judge");
      assertNotEquals(user?.passwordHash, "");
    } finally {
      await teardown(kv);
    }
  },
});

Deno.test({
  name: "verifyUser — correct password returns AuthContext",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("Verify Org", "admin@example.com");
      await createUser(orgId, "bob@example.com", "pass1234", "reviewer");

      const ctx = await verifyUser("bob@example.com", "pass1234");
      assertEquals(ctx?.email, "bob@example.com");
      assertEquals(ctx?.orgId, orgId);
      assertEquals(ctx?.role, "reviewer");
    } finally {
      await teardown(kv);
    }
  },
});

Deno.test({
  name: "verifyUser — wrong password returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("WrongPass Org", "admin@example.com");
      await createUser(orgId, "carol@example.com", "correct", "user");

      const ctx = await verifyUser("carol@example.com", "wrong");
      assertEquals(ctx, null);
    } finally {
      await teardown(kv);
    }
  },
});

// ---------------------------------------------------------------------------
// 3. deleteUser
// ---------------------------------------------------------------------------

Deno.test({
  name: "deleteUser — getUser returns null after deletion",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("Delete Org", "admin@example.com");
      await createUser(orgId, "dave@example.com", "pw", "user");

      // Confirm user exists before deletion
      assertNotEquals(await getUser(orgId, "dave@example.com"), null);

      await deleteUser(orgId, "dave@example.com");

      assertEquals(await getUser(orgId, "dave@example.com"), null);
    } finally {
      await teardown(kv);
    }
  },
});

// ---------------------------------------------------------------------------
// 4. listUsers
// ---------------------------------------------------------------------------

Deno.test({
  name: "listUsers — returns all created users for the org",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("List Org", "admin@example.com");
      await createUser(orgId, "u1@example.com", "pw", "judge");
      await createUser(orgId, "u2@example.com", "pw", "reviewer");
      await createUser(orgId, "u3@example.com", "pw", "user");

      const users = await listUsers(orgId);
      assertEquals(users.length, 3);

      const emails = users.map((u) => u.email).sort();
      assertEquals(emails, ["u1@example.com", "u2@example.com", "u3@example.com"]);
    } finally {
      await teardown(kv);
    }
  },
});

// ---------------------------------------------------------------------------
// 5. authenticate (session)
// ---------------------------------------------------------------------------

Deno.test({
  name: "authenticate — valid session cookie returns AuthContext",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const orgId = await createOrg("Session Org", "admin@example.com");
      const ctx = { email: "eve@example.com", orgId, role: "admin" as const };
      const token = await createSession(ctx);

      const req = new Request("http://localhost/", {
        headers: { cookie: `session=${token}` },
      });
      const auth = await authenticate(req);

      assertEquals(auth?.email, "eve@example.com");
      assertEquals(auth?.orgId, orgId);
      assertEquals(auth?.role, "admin");
    } finally {
      await teardown(kv);
    }
  },
});

Deno.test({
  name: "authenticate — missing cookie returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const req = new Request("http://localhost/");
      const auth = await authenticate(req);
      assertEquals(auth, null);
    } finally {
      await teardown(kv);
    }
  },
});

Deno.test({
  name: "authenticate — invalid/unknown session token returns null",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const req = new Request("http://localhost/", {
        headers: { cookie: "session=totally-fake-token-that-does-not-exist" },
      });
      const auth = await authenticate(req);
      assertEquals(auth, null);
    } finally {
      await teardown(kv);
    }
  },
});

// ---------------------------------------------------------------------------
// 6. listOrgs
// ---------------------------------------------------------------------------

Deno.test({
  name: "listOrgs — returns all created orgs",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const kv = await freshKv();
    try {
      const id1 = await createOrg("Alpha Corp", "a@example.com");
      const id2 = await createOrg("Beta Inc", "b@example.com");
      const id3 = await createOrg("Gamma LLC", "c@example.com");

      const orgs = await listOrgs();
      assertEquals(orgs.length, 3);

      const ids = orgs.map((o) => o.id).sort();
      assertEquals(ids.sort(), [id1, id2, id3].sort());
    } finally {
      await teardown(kv);
    }
  },
});
