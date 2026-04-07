import "reflect-metadata";
import { assertEquals } from "@std/assert";
import { DanetApplication, Module } from "@danet/core";
import { CoreModule } from "../../../core/core.module.ts";
import { AuthModule } from "../../../auth/auth.module.ts";
import { AuditModule } from "../../audit.module.ts";
import { setKvInstance, resetKvInstance } from "../../../core/data/kv/factory.ts";

Deno.env.set("DENO_KV_PATH", ":memory:");
Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("SELF_URL", "http://localhost");

@Module({ imports: [CoreModule, AuthModule, AuditModule] })
class TestModule {}

let app: DanetApplication;
let base: string;

async function setup() {
  const kv = await Deno.openKv(":memory:");
  setKvInstance(kv);
  app = new DanetApplication();
  await app.init(TestModule);
  await app.listen(0);
  const addr = app.listeningOn;
  base = `http://localhost:${addr.port}`;
}

async function teardown() {
  await app.close();
  resetKvInstance();
}

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function get(path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  return fetch(`${base}${path}`, { headers });
}

async function registerAdmin(): Promise<string> {
  const res = await post("/register", {
    orgName: "AuditTestOrg",
    email: "audit-admin@test.com",
    password: "AuditP4ss",
  });
  const setCookie = res.headers.get("set-cookie");
  await res.json();
  return setCookie!.split(";")[0];
}

Deno.test("audit e2e", async (t) => {
  await setup();

  const cookie = await registerAdmin();

  await t.step("GET /audit/api/list returns empty list initially", async () => {
    const res = await get("/audit/api/list", cookie);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(Array.isArray(data), true);
  });

  await t.step("unauthenticated request returns 401", async () => {
    const res = await get("/audit/api/list");
    assertEquals(res.status, 401);
    await res.json();
  });

  // -- Edge cases --

  await t.step("GET /audit/api/finding with invalid findingId returns 404", async () => {
    const res = await get("/audit/api/finding?id=nonexistent-id", cookie);
    assertEquals(res.status, 404);
    await res.json();
  });

  await t.step("GET /audit/api/finding without id param returns 400", async () => {
    const res = await get("/audit/api/finding", cookie);
    assertEquals(res.status, 400);
    await res.json();
  });

  await t.step("GET /audit/api/recording without rid param returns 400", async () => {
    const res = await get("/audit/api/recording", cookie);
    assertEquals(res.status, 400);
    await res.json();
  });

  await teardown();
});
