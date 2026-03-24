/** STEP: Bad word detection for package transcripts. Runs off critical path. */
import { getFinding, getBadWordConfig } from "../lib/kv.ts";
import { checkFindingForBadWords } from "../providers/bad-word.ts";
import { env } from "../env.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PACKAGES_TABLE = "bttffb64u";

export async function stepBadWordCheck(req: Request): Promise<Response> {
  const body = await req.json();
  const { findingId, orgId } = body;

  console.log(`[BAD-WORD-CHECK] ${findingId}: Starting...`);

  const finding = await getFinding(orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (finding.findingStatus === "terminated") return json({ ok: true, skipped: true, reason: "terminated" });

  const transcript = finding.rawTranscript ?? "";
  const config = await getBadWordConfig(orgId);

  const rawVoName = String(finding.record?.VoName ?? "");
  const voName = rawVoName.includes(" - ")
    ? rawVoName.split(" - ").slice(1).join(" - ").trim()
    : rawVoName.trim();

  const recordId = String(finding.record?.RecordId ?? "");
  const isPackage = !!finding.record?.GenieNumber;
  const realm = env.qbRealm;
  const recordUrl = recordId && realm
    ? `https://${realm}.quickbase.com/db/${PACKAGES_TABLE}?a=dr&rid=${recordId}`
    : undefined;
  const findingUrl = `${env.selfUrl}/audit/report?id=${findingId}`;

  const ctx = {
    findingId,
    recordId,
    agentEmail: voName || undefined,
    officeName: finding.record?.OfficeName ?? finding.record?.SubOfficeValue,
    guestName: finding.record?.GuestFullName ?? finding.record?.GuestName,
    reservationId: String(finding.record?.ReservationId ?? finding.record?.ResPkgId ?? ""),
    findingUrl,
    recordUrl: isPackage ? recordUrl : undefined,
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
