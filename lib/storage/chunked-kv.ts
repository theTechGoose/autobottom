/** ChunkedKv: generic chunked storage to work around Deno KV's 64KB value limit. */

const CHUNK_LIMIT = 30_000;

export class ChunkedKv {
  #db: Deno.Kv;
  constructor(db: Deno.Kv) { this.#db = db; }

  async get<T = unknown>(prefix: Deno.KvKey): Promise<T | null> {
    const meta = await this.#db.get<number>([...prefix, "_n"]);
    if (meta.value == null || meta.value === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < meta.value; i++) {
      const entry = await this.#db.get<string>([...prefix, i]);
      if (typeof entry.value !== "string") return null;
      parts.push(entry.value);
    }
    if (parts.length === 0) return null;
    try {
      return JSON.parse(parts.join("")) as T;
    } catch {
      return null;
    }
  }

  async set(prefix: Deno.KvKey, value: unknown, options?: { expireIn?: number }): Promise<void> {
    const raw = JSON.stringify(value);
    if (raw.length <= CHUNK_LIMIT) {
      await this.#db.set([...prefix, "_n"], 0, options);
      await this.#db.set([...prefix, 0], raw, options);
      await this.#db.set([...prefix, "_n"], 1, options);
      return;
    }
    const n = Math.ceil(raw.length / CHUNK_LIMIT);
    await this.#db.set([...prefix, "_n"], 0, options ?? {});
    for (let i = 0; i < n; i++) {
      await this.#db.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT), options ?? {});
    }
    await this.#db.set([...prefix, "_n"], n, options ?? {});
  }

  async delete(prefix: Deno.KvKey): Promise<void> {
    const meta = await this.#db.get<number>([...prefix, "_n"]);
    if (meta.value == null) return;
    await this.#db.delete([...prefix, "_n"]);
    for (let i = 0; i < meta.value; i++) {
      await this.#db.delete([...prefix, i]);
    }
  }
}
