/** STEP 3b: Async Pinecone upload — runs off critical path alongside ask-batch. */
import { getFinding } from "../src/audit/domain/data/audit-repository/mod.ts";
import { upload } from "../src/audit/domain/data/pinecone/mod.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function stepPineconeAsync(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[STEP-PINECONE] ${findingId}: Starting async Pinecone upload...`);

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const raw = finding.rawTranscript ?? "";
  if (!raw || raw.includes("Invalid Genie") || raw.includes("Genie Invalid")) {
    console.log(`[STEP-PINECONE] ${findingId}: Skipping — no valid transcript`);
    return json({ ok: true, skipped: true });
  }

  try {
    await upload(findingId, raw);
    console.log(`[STEP-PINECONE] ${findingId}: Pinecone upload complete`);
  } catch (err) {
    console.error(`[STEP-PINECONE] ${findingId}: Upload failed:`, err);
  }

  return json({ ok: true });
}
