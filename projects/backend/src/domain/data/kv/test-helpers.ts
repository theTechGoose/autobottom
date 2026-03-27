/**
 * In-memory KV factory for tests. Uses Deno.openKv(":memory:") to create
 * isolated KV instances that don't persist to disk.
 */

let _testKv: Deno.Kv | undefined;

/** Get a shared in-memory KV instance for tests. */
export async function getTestKv(): Promise<Deno.Kv> {
  if (!_testKv) {
    _testKv = await Deno.openKv(":memory:");
  }
  return _testKv;
}

/** Create a fresh (isolated) in-memory KV instance. Each call returns a new instance. */
export async function freshKv(): Promise<Deno.Kv> {
  return await Deno.openKv(":memory:");
}

/** Close and reset the shared test KV instance. Call in test cleanup. */
export async function closeTestKv(): Promise<void> {
  if (_testKv) {
    _testKv.close();
    _testKv = undefined;
  }
}

/** Clear all entries from a KV instance. */
export async function clearKv(kv: Deno.Kv): Promise<void> {
  const entries = kv.list({ prefix: [] });
  for await (const entry of entries) {
    await kv.delete(entry.key);
  }
}
