/** Pinecone vector store for RAG retrieval (manual OpenAI embeddings). */
import OpenAI from "npm:openai";

function getOpenAI() {
  return new OpenAI({ apiKey: Deno.env.get("OPEN_AI_KEY") });
}

const PINECONE_HOST = () => {
  const key = Deno.env.get("ADAM_PINECONE") ?? Deno.env.get("PINECONE_DB_KEY");
  const index = Deno.env.get("PINECONE_INDEX") ?? "auto-bot";
  if (!key) throw new Error("ADAM_PINECONE or PINECONE_DB_KEY required");
  // Pinecone serverless index host format
  return { key, index };
};

const PINECONE_TIMEOUT_MS = 30_000;

async function timedFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PINECONE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Get the Pinecone index host URL. Cached after first call. */
let _hostUrl: string | undefined;
async function getPineconeHost(): Promise<string> {
  if (_hostUrl) return _hostUrl;
  const { key, index } = PINECONE_HOST();
  const res = await timedFetch(`https://api.pinecone.io/indexes/${index}`, {
    headers: { "Api-Key": key },
  });
  if (!res.ok) throw new Error(`Pinecone describe index failed: ${res.status}`);
  const data = await res.json();
  _hostUrl = data.host;
  if (!_hostUrl) throw new Error("Pinecone index host not found");
  return _hostUrl;
}

async function embed(input: string): Promise<number[]> {
  const openai = getOpenAI();
  // Use Promise.race+setTimeout — npm SDKs in Deno don't reliably propagate AbortSignal
  let timerId: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () =>
        reject(
          new Error(
            `OpenAI embed timed out after ${PINECONE_TIMEOUT_MS / 1000}s`,
          ),
        ),
      PINECONE_TIMEOUT_MS,
    );
  });
  try {
    const res = await Promise.race([
      openai.embeddings.create({
        input,
        model: "text-embedding-3-small",
        encoding_format: "float",
      }),
      timeoutP,
    ]);
    clearTimeout(timerId!);
    return res.data[0].embedding;
  } catch (e) {
    clearTimeout(timerId!);
    throw e;
  }
}

/** Simple semantic chunking by splitting on sentence boundaries with overlap. */
function chunkText(text: string, maxChunkSize = 2000, overlap = 200): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Keep last part for overlap
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

/** Upload transcript chunks to Pinecone with OpenAI embeddings. */
export async function upload(findingId: string, text: string) {
  const chunks = chunkText(text);
  const host = await getPineconeHost();
  const { key } = PINECONE_HOST();

  // Embed all chunks
  const vectors = await Promise.all(
    chunks.map(async (chunk, i) => {
      const values = await embed(chunk);
      return {
        id: `${findingId}-${i}`,
        values,
        metadata: { text: chunk },
      };
    }),
  );

  // Upsert in batches of 100
  for (let i = 0; i < vectors.length; i += 100) {
    const batch = vectors.slice(i, i + 100);
    const res = await timedFetch(`https://${host}/vectors/upsert`, {
      method: "POST",
      headers: {
        "Api-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ vectors: batch, namespace: findingId }),
    });
    if (!res.ok) {
      throw new Error(
        `Pinecone upsert failed: ${res.status} ${await res.text()}`,
      );
    }
    await res.json(); // consume body
  }

  // No polling — vectors index async. ask-batch falls back to rawTranscript if Pinecone
  // returns empty on the first query before indexing completes.
}

/** Query Pinecone for relevant transcript chunks. */
export async function query(
  findingId: string,
  question: string,
  numDocs = 4,
): Promise<string> {
  const host = await getPineconeHost();
  const { key } = PINECONE_HOST();

  const queryVector = await embed(question);

  const res = await timedFetch(`https://${host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vector: queryVector,
      topK: numDocs,
      namespace: findingId,
      includeMetadata: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pinecone query failed: ${res.status} ${errText}`);
  }
  const data = await res.json();

  const matches = (data.matches ?? []) as Array<
    { score: number; metadata?: { text?: string } }
  >;
  const topScore = matches[0]?.score ?? 0;
  const hits = matches
    .filter((m) => topScore - m.score < 0.2)
    .map((m) => m.metadata?.text ?? "")
    .filter(Boolean);
  return hits.join("\n\n --- \n\n");
}

/** Delete an entire namespace (for cleanup). */
export async function deleteNamespace(findingId: string) {
  const host = await getPineconeHost();
  const { key } = PINECONE_HOST();

  const res = await timedFetch(`https://${host}/vectors/delete`, {
    method: "POST",
    headers: {
      "Api-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deleteAll: true, namespace: findingId }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[PINECONE] delete namespace failed: ${res.status} ${text}`);
  }
}
