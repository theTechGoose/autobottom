import "reflect-metadata";
import { assertEquals } from "@std/assert";
import { DanetApplication, Module } from "@danet/core";
import { CoreModule } from "../../core.module.ts";
import { setKvInstance, resetKvInstance } from "../../data/kv/factory.ts";

Deno.env.set("DENO_KV_PATH", ":memory:");
Deno.env.set("LOCAL_QUEUE", "true");

@Module({ imports: [CoreModule] })
class TestModule {}

Deno.test("health e2e", async (t) => {
  const kv = await Deno.openKv(":memory:");
  setKvInstance(kv);
  const app = new DanetApplication();
  await app.init(TestModule);
  await app.listen(0);
  const addr = app.listeningOn;
  const base = `http://localhost:${addr.port}`;

  await t.step("GET /health returns { ok: true, ts: number }", async () => {
    const res = await fetch(`${base}/health`);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.ok, true);
    assertEquals(typeof data.ts, "number");
  });

  await app.close();
  resetKvInstance();
});
