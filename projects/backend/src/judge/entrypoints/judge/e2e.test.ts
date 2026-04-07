import "reflect-metadata";
import { assertEquals } from "@std/assert";
import { DanetApplication, Module } from "@danet/core";
import { CoreModule } from "../../../core/core.module.ts";
import { AuthModule } from "../../../auth/auth.module.ts";
import { JudgeModule } from "../../judge.module.ts";
import { setKvInstance, resetKvInstance } from "../../../core/data/kv/factory.ts";

Deno.env.set("DENO_KV_PATH", ":memory:");
Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("SELF_URL", "http://localhost");

@Module({ imports: [CoreModule, AuthModule, JudgeModule] })
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

async function registerAndLogin(): Promise<string> {
  const res = await post("/register", {
    orgName: "JudgeTestOrg",
    email: "judge-admin@test.com",
    password: "JudgeP4ss",
  });
  const setCookie = res.headers.get("set-cookie");
  await res.json();
  return setCookie!.split(";")[0];
}

Deno.test("judge e2e edge cases", async (t) => {
  await setup();
  const cookie = await registerAndLogin();

  await t.step("POST /judge/api/decide with invalid decision returns 400", async () => {
    const res = await post("/judge/api/decide", {
      findingId: "f1",
      questionIndex: 0,
      decision: "invalid-value",
    }, cookie);
    assertEquals(res.status, 400);
    await res.json();
  });

  await t.step("POST /judge/api/decide with string questionIndex returns 400", async () => {
    const res = await post("/judge/api/decide", {
      findingId: "f1",
      questionIndex: "not-a-number",
      decision: "uphold",
    }, cookie);
    assertEquals(res.status, 400);
    await res.json();
  });

  await t.step("POST /judge/api/decide with negative questionIndex still parses (schema allows it)", async () => {
    const res = await post("/judge/api/decide", {
      findingId: "f1",
      questionIndex: -1,
      decision: "uphold",
    }, cookie);
    // Schema allows negative numbers, business logic will handle it
    const status = res.status;
    assertEquals(status === 200 || status === 409, true);
    await res.json();
  });

  await t.step("POST /judge/api/decide with missing fields returns 400", async () => {
    const res = await post("/judge/api/decide", {}, cookie);
    assertEquals(res.status, 400);
    await res.json();
  });

  await t.step("unauthenticated request to judge returns 401", async () => {
    const res = await get("/judge/api/next");
    assertEquals(res.status, 401);
    await res.json();
  });

  await teardown();
});
