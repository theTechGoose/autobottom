/** Pinecone vector store adapter for RAG retrieval. Ported from providers/pinecone.ts. */
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";
import OpenAI from "#openai";

function getOpenAI() { return new OpenAI({ apiKey: Deno.env.get("OPEN_AI_KEY") }); }

const PINECONE_HOST = () => {
  const key = Deno.env.get("ADAM_PINECONE") ?? Deno.env.get("PINECONE_DB_KEY");
  const index = Deno.env.get("PINECONE_INDEX") ?? "auto-bot";
  if (!key) throw new Error("ADAM_PINECONE or PINECONE_DB_KEY required");
  return { key, index };
};

const PINECONE_TIMEOUT_MS = 30_000;

async function timedFetch(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PINECONE_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeoutId); }
}

let _hostUrl: string | undefined;
async function getPineconeHost(): Promise<string> {
  if (_hostUrl) return _hostUrl;
  const { key, index } = PINECONE_HOST();
  const res = await timedFetch(`https://api.pinecone.io/indexes/${index}`, { headers: { "Api-Key": key } });
  if (!res.ok) throw new Error(`Pinecone describe index failed: ${res.status}`);
  const data = await res.json();
  _hostUrl = data.host;
  if (!_hostUrl) throw new Error("Pinecone index host not found");
  return _hostUrl;
}

async function embed(input: string): Promise<number[]> {
  const openai = getOpenAI();
  let timerId: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<never>((_, reject) => { timerId = setTimeout(() => reject(new Error(`OpenAI embed timed out after ${PINECONE_TIMEOUT_MS / 1000}s`)), PINECONE_TIMEOUT_MS); });
  try {
    const res = await Promise.race([openai.embeddings.create({ input, model: "text-embedding-3-small", encoding_format: "float" }), timeoutP]);
    clearTimeout(timerId!);
    return res.data[0].embedding;
  } catch (e) { clearTimeout(timerId!); throw e; }
}

function chunkText(text: string, maxChunkSize = 2000, overlap = 200): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      current = overlapWords.join(" ") + " " + sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export async function upload(findingId: string, text: string): Promise<void> {
  return withSpan("pinecone.upload", async (span) => {
    const chunks = chunkText(text);
    span.setAttribute("pinecone.chunks", chunks.length);
    const host = await getPineconeHost();
    const { key } = PINECONE_HOST();
    const vectors = await Promise.all(chunks.map(async (chunk, i) => {
      const values = await embed(chunk);
      return { id: `${findingId}-${i}`, values, metadata: { text: chunk } };
    }));
    for (let i = 0; i < vectors.length; i += 100) {
      const batch = vectors.slice(i, i + 100);
      const res = await timedFetch(`https://${host}/vectors/upsert`, {
        method: "POST", headers: { "Api-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ vectors: batch, namespace: findingId }),
      });
      if (!res.ok) throw new Error(`Pinecone upsert failed: ${res.status} ${await res.text()}`);
      await res.json();
    }
    metric("autobottom.pinecone.upload", 1);
  }, {}, "client");
}

export async function query(findingId: string, question: string, numDocs = 4): Promise<string> {
  return withSpan("pinecone.query", async () => {
    const host = await getPineconeHost();
    const { key } = PINECONE_HOST();
    const queryVector = await embed(question);
    const res = await timedFetch(`https://${host}/query`, {
      method: "POST", headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ vector: queryVector, topK: numDocs, namespace: findingId, includeMetadata: true }),
    });
    if (!res.ok) throw new Error(`Pinecone query failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const matches = (data.matches ?? []) as Array<{ score: number; metadata?: { text?: string } }>;
    const topScore = matches[0]?.score ?? 0;
    metric("autobottom.pinecone.query", 1);
    return matches.filter((m) => topScore - m.score < 0.2).map((m) => m.metadata?.text ?? "").filter(Boolean).join("\n\n --- \n\n");
  }, {}, "client");
}

export async function deleteNamespace(findingId: string): Promise<void> {
  return withSpan("pinecone.deleteNamespace", async () => {
    const host = await getPineconeHost();
    const { key } = PINECONE_HOST();
    const res = await timedFetch(`https://${host}/vectors/delete`, {
      method: "POST", headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ deleteAll: true, namespace: findingId }),
    });
    if (!res.ok) console.error(`[PINECONE] delete namespace failed: ${res.status} ${await res.text()}`);
    metric("autobottom.pinecone.delete", 1);
  }, {}, "client");
}

/** Exported for testing. */
export { chunkText };
