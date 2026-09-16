/** One-step lookup for other apps: QuickBase record id → full finding(s).
 *
 *  GET /audit/finding-by-record?recordId=<rid>[&fields=a,b][&snippets=false]   (Authorization: Bearer FINDING_API_SECRET)
 *  → 200 { ok, recordId, findingIds, findings }
 *
 *  `fields` narrows each finding to `id` plus the named fields: any top-level
 *  finding field (rawTranscript, diarizedTranscript, answeredQuestions, record…)
 *  or `score`. A named field the finding lacks comes back null, so a typo is
 *  visible instead of silently missing.
 *
 *  `score` is the audit-done-idx score — what the dashboards and Audit History
 *  show. Not finding.reviewScore: the judge rewrites answers and the index score
 *  on an overturn but leaves reviewScore at the pre-appeal value.
 *
 *  `snippets=false` drops answeredQuestions[].snippet — the transcript text each
 *  question was graded on. It is most of the payload (a whole transcript copy per
 *  question on short calls), so a caller that doesn't need it saves ~60-75%.
 *
 *  Each entry in `findings` is the same object GET /audit/finding returns. A record
 *  can hold more than one audit (a re-audit, or a duplicate submit), so this is
 *  always a list, newest first. `findingIds` lists every audit on the record;
 *  `findings` carries the first MAX_FINDINGS that still exist.
 *
 *  Only finished audits are in the record index, and the search looks back at
 *  most 365 days (findAuditsByRecordId).
 *
 *  Dispatched directly from main.ts: danet's @Req is broken via router.fetch, so
 *  a controller can't read the Authorization header. */
import { findAuditsByRecordId } from "@audit/domain/data/stats-repository/mod.ts";
import { readFullFinding } from "@audit/domain/business/read-finding/mod.ts";
import { defaultOrgId } from "@core/business/auth/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import type { AuditDoneIndexEntry } from "@core/dto/types.ts";

/** Findings are read one at a time (prod wedges under concurrent chunked reads),
 *  so cap how many one request can pull. */
const MAX_FINDINGS = 10;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function requireFindingApiSecret(req: Request): Response | null {
  const secret = Deno.env.get("FINDING_API_SECRET");
  if (!secret) return json({ ok: false, error: "FINDING_API_SECRET not configured" }, 500);
  const header = req.headers.get("Authorization") ?? "";
  if (!constantTimeEq(header, `Bearer ${secret}`)) return json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

/** A copy without per-question snippets. Never strip in place: readFullFinding can
 *  hand back getFinding's cached object, and /audit/finding serves that same one. */
export function withoutSnippets(finding: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(finding.answeredQuestions)) return finding;
  const answeredQuestions = finding.answeredQuestions.map((q) => {
    if (!q || typeof q !== "object") return q;
    const { snippet: _snippet, ...rest } = q as Record<string, unknown>;
    return rest;
  });
  return { ...finding, answeredQuestions };
}

/** `fields=a, b,,c` → ["a","b","c"]; absent or blank → null (return everything). */
export function parseFields(raw: string | null): string[] | null {
  const names = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return names.length ? [...new Set(names)] : null;
}

/** `id` plus each requested field; `score` comes from the index row. */
export function pickFields(finding: Record<string, unknown>, fields: string[], score: number | undefined): Record<string, unknown> {
  const picked: Record<string, unknown> = { id: finding.id };
  for (const name of fields) picked[name] = name === "score" ? (score ?? null) : (finding[name] ?? null);
  return picked;
}

const busy = (recordId: string, detail: string) =>
  json({ ok: false, error: "Server busy, please retry", retry: true, recordId, detail }, 503);

export async function handleFindingByRecord(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ ok: false, error: "GET required" }, 405);
  const authErr = requireFindingApiSecret(req);
  if (authErr) return authErr;

  const params = new URL(req.url).searchParams;
  const recordId = (params.get("recordId") ?? "").trim();
  if (!recordId) return json({ ok: false, error: "recordId required" }, 400);
  const includeSnippets = params.get("snippets")?.trim().toLowerCase() !== "false";
  const fields = parseFields(params.get("fields"));

  const orgId = defaultOrgId() as OrgId;
  // Rows come back newest first, so the first row seen per finding is its latest.
  const latestRow = new Map<string, AuditDoneIndexEntry>();
  try {
    for (const row of await findAuditsByRecordId(orgId, recordId)) {
      if (!latestRow.has(row.findingId)) latestRow.set(row.findingId, row);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [FINDING-BY-RECORD] search failed for recordId=${recordId}: ${msg}`);
    return busy(recordId, msg);
  }

  const findingIds = [...latestRow.keys()];
  const findings: Record<string, unknown>[] = [];
  for (const id of findingIds.slice(0, MAX_FINDINGS)) {
    const read = await readFullFinding(orgId, id);
    if (read.kind === "found") {
      const finding = includeSnippets ? read.finding : withoutSnippets(read.finding);
      findings.push(fields ? pickFields(finding, fields, latestRow.get(id)?.score) : finding);
    } else if (read.kind === "busy") return busy(recordId, read.detail);
    else if (read.kind === "failed") return json({ ok: false, error: "lookup failed", recordId, detail: read.detail }, 500);
    // "missing": the index still points at a deleted finding — skip it.
  }

  console.log(`🔎 [FINDING-BY-RECORD] recordId=${recordId} → ${findings.length} finding(s) of ${findingIds.length} indexed`);
  if (findings.length === 0) return json({ ok: false, error: "no audits found for this record", recordId, findingIds }, 404);
  return json({ ok: true, recordId, findingIds, findings });
}
