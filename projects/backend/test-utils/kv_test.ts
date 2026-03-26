import { assertEquals } from "@std/assert";
import { freshKv, clearKv } from "./kv.ts";

Deno.test("freshKv creates an in-memory KV instance", async () => {
  const kv = await freshKv();
  await kv.set(["test", "key"], "value");
  const result = await kv.get(["test", "key"]);
  assertEquals(result.value, "value");
  kv.close();
});

Deno.test("clearKv removes all entries", async () => {
  const kv = await freshKv();
  await kv.set(["a"], 1);
  await kv.set(["b"], 2);
  await clearKv(kv);
  const a = await kv.get(["a"]);
  const b = await kv.get(["b"]);
  assertEquals(a.value, null);
  assertEquals(b.value, null);
  kv.close();
});

Deno.test("freshKv instances are isolated", async () => {
  const kv1 = await freshKv();
  const kv2 = await freshKv();
  await kv1.set(["shared"], "from-kv1");
  const result = await kv2.get(["shared"]);
  assertEquals(result.value, null);
  kv1.close();
  kv2.close();
});
