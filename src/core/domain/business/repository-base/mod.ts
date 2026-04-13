/** Generic KV repository with org-scoped keys, chunked storage, and typed CRUD. */

import { getKv, orgKey } from "@core/domain/data/deno-kv/mod.ts";
import type { OrgId } from "@core/domain/data/deno-kv/mod.ts";

export type { OrgId };

const CHUNK_LIMIT = 30_000;

// ── Chunked storage (values > 64KB) ────────────────────────────────────────

async function chunkedGet<T>(db: Deno.Kv, prefix: Deno.KvKey): Promise<T | null> {
  const meta = await db.get<number>([...prefix, "_n"]);
  if (meta.value == null || meta.value === 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < meta.value; i++) {
    const entry = await db.get<string>([...prefix, i]);
    if (typeof entry.value !== "string") return null;
    parts.push(entry.value);
  }
  if (parts.length === 0) return null;
  try { return JSON.parse(parts.join("")) as T; }
  catch { return null; }
}

async function chunkedSet(db: Deno.Kv, prefix: Deno.KvKey, value: unknown, options?: { expireIn?: number }): Promise<void> {
  const raw = JSON.stringify(value);
  if (raw.length <= CHUNK_LIMIT) {
    await db.set([...prefix, "_n"], 0, options);
    await db.set([...prefix, 0], raw, options);
    await db.set([...prefix, "_n"], 1, options);
    return;
  }
  const n = Math.ceil(raw.length / CHUNK_LIMIT);
  await db.set([...prefix, "_n"], 0, options ?? {});
  for (let i = 0; i < n; i++) {
    await db.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT), options ?? {});
  }
  await db.set([...prefix, "_n"], n, options ?? {});
}

async function chunkedDelete(db: Deno.Kv, prefix: Deno.KvKey): Promise<void> {
  const meta = await db.get<number>([...prefix, "_n"]);
  if (meta.value == null) return;
  await db.delete([...prefix, "_n"]);
  for (let i = 0; i < meta.value; i++) {
    await db.delete([...prefix, i]);
  }
}

// ── KvRepository ────────────────────────────────────────────────────────────

export interface SetOptions {
  expireIn?: number;
}

/**
 * Generic repository over Deno KV with org-scoped keys.
 * Subclass per module and provide a `namespace` to isolate data.
 */
export class KvRepository<T = unknown> {
  constructor(protected readonly namespace: string) {}

  protected key(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Deno.KvKey {
    return orgKey(orgId, this.namespace, ...parts);
  }

  protected globalKey(...parts: Deno.KvKeyPart[]): Deno.KvKey {
    return [this.namespace, ...parts];
  }

  protected async db(): Promise<Deno.Kv> {
    return getKv();
  }

  // ── Basic CRUD ──────────────────────────────────────────────────────────

  async get(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Promise<T | null> {
    const db = await this.db();
    const entry = await db.get<T>(this.key(orgId, ...parts));
    return entry.value ?? null;
  }

  async getEntry(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Promise<Deno.KvEntryMaybe<T>> {
    const db = await this.db();
    return db.get<T>(this.key(orgId, ...parts));
  }

  async set(orgId: OrgId, parts: Deno.KvKeyPart[], value: T, options?: SetOptions): Promise<void> {
    const db = await this.db();
    await db.set(this.key(orgId, ...parts), value, options);
  }

  async delete(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Promise<void> {
    const db = await this.db();
    await db.delete(this.key(orgId, ...parts));
  }

  async list(orgId: OrgId, ...prefixParts: Deno.KvKeyPart[]): Promise<Array<{ key: Deno.KvKey; value: T }>> {
    const db = await this.db();
    const prefix = this.key(orgId, ...prefixParts);
    const results: Array<{ key: Deno.KvKey; value: T }> = [];
    for await (const entry of db.list<T>({ prefix })) {
      results.push({ key: entry.key, value: entry.value });
    }
    return results;
  }

  // ── Chunked CRUD (for values > 64KB) ───────────────────────────────────

  async getChunked(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Promise<T | null> {
    const db = await this.db();
    return chunkedGet<T>(db, this.key(orgId, ...parts));
  }

  async setChunked(orgId: OrgId, parts: Deno.KvKeyPart[], value: T, options?: SetOptions): Promise<void> {
    const db = await this.db();
    await chunkedSet(db, this.key(orgId, ...parts), value, options);
  }

  async deleteChunked(orgId: OrgId, ...parts: Deno.KvKeyPart[]): Promise<void> {
    const db = await this.db();
    await chunkedDelete(db, this.key(orgId, ...parts));
  }

  // ── Atomic operations ──────────────────────────────────────────────────

  async atomic(): Promise<Deno.AtomicOperation> {
    const db = await this.db();
    return db.atomic();
  }
}
