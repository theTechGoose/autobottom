/** STEP 7: Cleanup - delete Pinecone namespace and clean up KV state. */
import { deleteNamespace } from "../../../../core/data/pinecone/impl.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepCleanup(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId, pineconeNamespace } = body;

  console.log(`[STEP-CLEANUP] ${findingId}: Cleaning up...`);

  // Delete Pinecone namespace
  const ns = pineconeNamespace ?? findingId;
  try {
    await deleteNamespace(ns);
    console.log(`[STEP-CLEANUP] ${findingId}: Pinecone namespace deleted`);
  } catch (err) {
    console.error(`[STEP-CLEANUP] ${findingId}: Pinecone delete failed:`, err);
  }

  return json({ ok: true });
}
