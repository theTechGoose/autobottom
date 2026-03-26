/**
 * Shared KV factory. All modules use this instead of calling Deno.openKv() directly.
 * In test mode (DENO_KV_PATH=:memory:), returns an in-memory instance.
 * Lazy singleton — one connection shared across the entire app.
 */

let _kv: Deno.Kv | undefined;

export async function kvFactory(): Promise<Deno.Kv> {
  if (!_kv) {
    const path = Deno.env.get("DENO_KV_PATH");
    _kv = await Deno.openKv(path);
  }
  return _kv;
}

/** For tests: inject a pre-created KV instance. */
export function setKvInstance(kv: Deno.Kv): void {
  _kv = kv;
}

/** For tests: reset the singleton so the next call creates a fresh one. */
export function resetKvInstance(): void {
  _kv = undefined;
}
