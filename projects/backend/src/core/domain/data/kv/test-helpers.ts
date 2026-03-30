/**
 * In-memory KV helpers for tests. Uses Deno.openKv(":memory:") to create
 * isolated Kv instances that don't persist to disk.
 */

import { Kv } from "./mod.ts";

export class KvTestHelpers {
  /** Create a fresh (isolated) in-memory Kv instance. Each call returns a new instance. */
  static async fresh(): Promise<Kv> {
    return new Kv(await Deno.openKv(":memory:"));
  }

  /** Clear all entries from a Kv instance. */
  static async clear(kv: Kv): Promise<void> {
    for await (const entry of kv.db.list({ prefix: [] })) {
      await kv.db.delete(entry.key);
    }
  }
}
