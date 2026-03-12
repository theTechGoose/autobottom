import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { ChunkedKv } from "./chunked-kv.ts";

function toKebabCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const ID_PREFIX = "||id||";
const SEP = "::";

function validateParts(parts: string[]) {
  for (const p of parts) {
    if (p.includes(SEP))
      throw new Error(`Part "${p}" contains separator "${SEP}"`);
  }
}

// ── TypedStore ───────────────────────────────────────────────────────────────

export interface SetOptions {
  expireIn?: number;
}

export class TypedStore<T> {
  private chunked: ChunkedKv;

  constructor(
    private db: Deno.Kv,
    readonly typeName: string,
  ) {
    this.chunked = new ChunkedKv(db);
  }

  get rawDb(): Deno.Kv {
    return this.db;
  }

  makeId(...parts: string[]): string {
    validateParts(parts);
    return `${ID_PREFIX}${[this.typeName, ...parts, nanoid()].join(SEP)}`;
  }

  static parseId(id: string): string[] | null {
    if (!id.startsWith(ID_PREFIX)) return null;
    return id.slice(ID_PREFIX.length).split(SEP);
  }

  toKey(id: string | string[]): Deno.KvKey {
    if (Array.isArray(id)) return [`__${this.typeName}__`, ...id];
    const parsed = TypedStore.parseId(id);
    if (!parsed) throw new Error(`Invalid typed ID: ${id}`);
    const [type, ...rest] = parsed;
    return [`__${type}__`, ...rest];
  }

  // ── Basic CRUD ──────────────────────────────────────────────────────────

  async get(id: string | string[]): Promise<T | null> {
    const entry = await this.db.get<T>(this.toKey(id));
    return entry.value;
  }

  async getEntry(id: string | string[]): Promise<Deno.KvEntryMaybe<T>> {
    return this.db.get<T>(this.toKey(id));
  }

  async set(
    id: string | string[],
    value: T,
    options?: SetOptions,
  ): Promise<void> {
    await this.db.set(this.toKey(id), value, options);
  }

  async delete(id: string | string[]): Promise<void> {
    await this.db.delete(this.toKey(id));
  }

  async list(
    ...parts: Deno.KvKeyPart[]
  ): Promise<Array<{ id: string; value: T }>> {
    const prefix: Deno.KvKey = [`__${this.typeName}__`, ...parts];
    const results: Array<{ id: string; value: T }> = [];
    for await (const entry of this.db.list<T>({ prefix })) {
      const rest = (entry.key as string[]).slice(1);
      const id = `${ID_PREFIX}${this.typeName}${SEP}${rest.join(SEP)}`;
      results.push({ id, value: entry.value });
    }
    return results;
  }

  async listRaw(
    parts: Deno.KvKeyPart[],
    options?: Deno.KvListOptions,
  ): Promise<Array<{ key: Deno.KvKey; value: T }>> {
    const prefix: Deno.KvKey = [`__${this.typeName}__`, ...parts];
    const results: Array<{ key: Deno.KvKey; value: T }> = [];
    for await (const entry of this.db.list<T>({ prefix }, options)) {
      results.push({ key: entry.key, value: entry.value });
    }
    return results;
  }

  // ── Chunked CRUD (for values > 64KB) ───────────────────────────────────

  async getChunked(id: string | string[]): Promise<T | null> {
    return this.chunked.get<T>(this.toKey(id));
  }

  async setChunked(
    id: string | string[],
    value: T,
    options?: SetOptions,
  ): Promise<void> {
    await this.chunked.set(this.toKey(id), value, options);
  }

  async deleteChunked(id: string | string[]): Promise<void> {
    await this.chunked.delete(this.toKey(id));
  }
}

// ── Store Factory ────────────────────────────────────────────────────────────

export function initStores(db: Deno.Kv) {
  return <T>(dto: new () => T): TypedStore<T> => {
    return new TypedStore(db, toKebabCase(dto.name));
  };
}
