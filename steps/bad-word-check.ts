/** STEP: Bad word detection for package transcripts. Runs off critical path. */
import { getFinding, getBadWordConfig } from "../lib/kv.ts";
import { checkFindingForBadWords } from "../providers/bad-word.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stepBadWordCheck(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[BAD-WORD-CHECK] ${findingId}: Starting...`);

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const transcript = finding.rawTranscript ?? "";
  const config = await getBadWordConfig(orgId);

  const ctx = {
    findingId,
    recordId: String(finding.record?.RecordId ?? ""),
    agentEmail: finding.owner,
    officeName: finding.record?.OfficeName ?? finding.record?.SubOfficeValue,
    guestName: finding.record?.GuestFullName,
    reservationId: String(finding.record?.ReservationId ?? finding.record?.ResPkgId ?? ""),
  };

  try {
    const found = await checkFindingForBadWords(config, transcript, ctx);
    console.log(`[BAD-WORD-CHECK] ${findingId}: Done — ${found ? "violations found" : "clean"}`);
    return json({ ok: true, violations: found });
  } catch (err) {
    console.error(`[BAD-WORD-CHECK] ${findingId}: Error:`, err);
    return json({ ok: true, error: String(err) }); // non-fatal
  }
}
