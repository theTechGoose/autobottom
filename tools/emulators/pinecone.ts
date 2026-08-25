/** Pinecone stand-in: namespaced vectors in memory, real cosine similarity.
 *
 *  Embeddings still come from OpenAI (AI stays live in both modes), so the
 *  vectors are genuine — only the storage and the nearest-neighbour search are
 *  local. Scores are therefore comparable to prod's, which matters because the
 *  caller filters matches by score distance (`topScore - m.score < 0.2`).
 *
 *  Covers describe-index, upsert, query and namespace delete. Not durable. */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

interface Vector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

/** namespace → vectors */
const store = new Map<string, Vector[]>();

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const describe = /^\/control\/indexes\/(.+)$/.exec(path);
  if (describe) {
    // The app takes `host` from here and addresses it directly; pineconeDataUrl()
    // routes whatever we return back to this process.
    return Response.json({ name: describe[1], host: `${describe[1]}.emulator.local`, dimension: 1536 });
  }

  if (path === "/data/vectors/upsert" && req.method === "POST") {
    const body = await req.json() as { vectors: Vector[]; namespace?: string };
    const ns = body.namespace ?? "";
    const existing = store.get(ns) ?? [];
    const byId = new Map(existing.map((v) => [v.id, v]));
    for (const v of body.vectors) byId.set(v.id, v);
    store.set(ns, [...byId.values()]);
    return Response.json({ upsertedCount: body.vectors.length });
  }

  if (path === "/data/query" && req.method === "POST") {
    const body = await req.json() as {
      vector: number[]; topK?: number; namespace?: string; includeMetadata?: boolean;
    };
    const vectors = store.get(body.namespace ?? "") ?? [];
    const matches = vectors
      .map((v) => ({
        id: v.id,
        score: cosine(body.vector, v.values),
        ...(body.includeMetadata ? { metadata: v.metadata } : {}),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, body.topK ?? 4);
    return Response.json({ matches, namespace: body.namespace ?? "" });
  }

  if (path === "/data/vectors/delete" && req.method === "POST") {
    const body = await req.json() as { deleteAll?: boolean; namespace?: string; ids?: string[] };
    const ns = body.namespace ?? "";
    if (body.deleteAll) store.delete(ns);
    else if (body.ids) store.set(ns, (store.get(ns) ?? []).filter((v) => !body.ids!.includes(v.id)));
    return Response.json({});
  }

  return Response.json({ error: `unhandled ${req.method} ${path}` }, { status: 404 });
}

export function startPinecone(): Deno.HttpServer {
  return Deno.serve({ port: EMULATOR_PORTS.pinecone, onListen: () => {} }, handle);
}
