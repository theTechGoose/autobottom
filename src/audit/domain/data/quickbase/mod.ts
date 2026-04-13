/** QuickBase API client. Ported from providers/quickbase.ts. */

function cleanGenieId(raw: unknown): string {
  const str = String(raw ?? "").trim();
  if (!str) return "";
  return str.split(",").map((s) => s.trim().replace(/[^0-9].*$/, "")).filter((s) => s.length > 0).join(",");
}

function headers() {
  return {
    "QB-Realm-Hostname": `${Deno.env.get("QB_REALM")}.quickbase.com`,
    "User-Agent": "auto-bot",
    Authorization: `QB-USER-TOKEN ${Deno.env.get("QB_USER_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

const API = "https://api.quickbase.com/v1";
const QB_TIMEOUT_MS = 30_000;
const QB_RETRY_DELAYS = [2000, 5000, 10000];

export interface QBQueryOptions {
  tableId: string;
  where: string;
  select: number[];
  sortBy?: { fieldId: number; order: "ASC" | "DESC" }[];
}

export async function queryRecords(opts: QBQueryOptions, attempt = 0): Promise<any[]> {
  const body: any = { from: opts.tableId, where: opts.where, select: opts.select };
  if (opts.sortBy) body.sortBy = opts.sortBy;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QB_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API}/records/query`, {
      method: "POST", headers: headers(), body: JSON.stringify(body), signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    const msg = String(e?.message ?? e);
    const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
    const label = isTimeout ? `timed out after ${QB_TIMEOUT_MS / 1000}s` : msg;
    if (attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(`[QB] ⚠️ queryRecords attempt ${attempt + 1} ${label} — retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return queryRecords(opts, attempt + 1);
    }
    throw new Error(`QuickBase query failed after ${attempt + 1} attempts: ${label}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(`[QB] ⚠️ queryRecords attempt ${attempt + 1} got ${res.status} — retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return queryRecords(opts, attempt + 1);
    }
    throw new Error(`QuickBase query failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

// ── Date Legs ────────────────────────────────────────────────────────────────

const DATE_LEGS_TABLE = "bpb28qsnn";
const DL = { RECORD_ID: 3, VO_GENIE: 145, RELATED_DEST: 292, GUEST_NAME: 32, VO_NAME: 144, VO_EMAIL: 839, SUPERVISOR_EMAIL: 851, DEST_DISPLAY: 566, ACTIVATING_OFFICE: 140, SHIFT: 834 };
const DATE_LEG_AUTOYES_FIELDS = [8, 10, 32, 33, 49, 297, 314, 460, 553, 594, 706];

export async function getDateLegByRid(rid: string): Promise<Record<string, any> | null> {
  const records = await queryRecords({
    tableId: DATE_LEGS_TABLE,
    where: `{${DL.RECORD_ID}.EX.'${rid}'}`,
    select: [DL.RECORD_ID, DL.VO_GENIE, DL.RELATED_DEST, DL.DEST_DISPLAY, DL.GUEST_NAME, DL.VO_NAME, DL.VO_EMAIL, DL.SUPERVISOR_EMAIL, DL.ACTIVATING_OFFICE, DL.SHIFT, ...DATE_LEG_AUTOYES_FIELDS],
  });
  if (records.length === 0) return null;
  const r = records[0];
  const autoYes: Record<string, string> = {};
  for (const fid of DATE_LEG_AUTOYES_FIELDS) autoYes[String(fid)] = r[fid]?.value != null ? String(r[fid].value) : "";
  return {
    RecordId: r[DL.RECORD_ID]?.value ?? rid, VoGenie: cleanGenieId(r[DL.VO_GENIE]?.value),
    RelatedDestinationId: r[DL.RELATED_DEST]?.value ?? "", DestinationDisplay: r[DL.DEST_DISPLAY]?.value ?? "",
    GuestName: r[DL.GUEST_NAME]?.value ?? "", VoName: r[DL.VO_NAME]?.value ?? "",
    VoEmail: r[DL.VO_EMAIL]?.value ?? "", SupervisorEmail: r[DL.SUPERVISOR_EMAIL]?.value ?? "",
    ActivatingOffice: String(r[DL.ACTIVATING_OFFICE]?.value ?? ""), Shift: String(r[DL.SHIFT]?.value ?? ""),
    ...autoYes,
  };
}

// ── Packages ─────────────────────────────────────────────────────────────────

const PACKAGES_TABLE = "bttffb64u";
const PK = { RECORD_ID: 3, GENIE_NUMBER: 18, RELATED_OFFICE_ID: 45, OFFICE_NAME: 46, GM_EMAIL: 114, GUEST_NAME: 57, VO_NAME: 52 };
const PACKAGE_AUTOYES_FIELDS = [67, 145, 306, 345];

export async function getPackageByRid(rid: string): Promise<Record<string, any> | null> {
  const records = await queryRecords({
    tableId: PACKAGES_TABLE,
    where: `{${PK.RECORD_ID}.EX.'${rid}'}`,
    select: [PK.RECORD_ID, PK.GENIE_NUMBER, PK.RELATED_OFFICE_ID, PK.OFFICE_NAME, PK.GM_EMAIL, PK.GUEST_NAME, PK.VO_NAME, ...PACKAGE_AUTOYES_FIELDS],
  });
  if (records.length === 0) return null;
  const r = records[0];
  const autoYes: Record<string, string> = {};
  for (const fid of PACKAGE_AUTOYES_FIELDS) autoYes[String(fid)] = r[fid]?.value != null ? String(r[fid].value) : "";
  return {
    RecordId: r[PK.RECORD_ID]?.value ?? rid, GenieNumber: cleanGenieId(r[PK.GENIE_NUMBER]?.value),
    RelatedOfficeId: r[PK.RELATED_OFFICE_ID]?.value ?? 0, OfficeName: String(r[PK.OFFICE_NAME]?.value ?? ""),
    GmEmail: r[PK.GM_EMAIL]?.value ?? "", GuestName: String(r[PK.GUEST_NAME]?.value ?? ""),
    VoName: String(r[PK.VO_NAME]?.value ?? ""), ...autoYes,
  };
}

// ── Audit Questions ──────────────────────────────────────────────────────────

const QUESTIONS_TABLE = "bu3e8x98x";
const QF = {
  RELATED_DEST: Number(Deno.env.get("QB_AUDIT_QUESTIONS_DEST_FIELD") || "11"),
  REPORT_LABEL: Number(Deno.env.get("QB_AUDIT_QUESTIONS_LABEL_FIELD") || "7"),
  QUESTION: Number(Deno.env.get("QB_AUDIT_QUESTIONS_QUESTION_FIELD") || "6"),
  AUTOYES: Number(Deno.env.get("QB_AUDIT_QUESTIONS_AUTOYES_FIELD") || "14"),
};

export async function getQuestionsForDestination(destinationId: string): Promise<Array<{ header: string; question: string; autoYes: string }>> {
  if (!destinationId) { console.warn("[QB] No destinationId provided"); return []; }
  const records = await queryRecords({
    tableId: QUESTIONS_TABLE,
    where: `{${QF.RELATED_DEST}.EX.'${destinationId}'}`,
    select: [QF.REPORT_LABEL, QF.QUESTION, QF.AUTOYES],
  });
  return records.map((r: any) => ({
    header: r[QF.REPORT_LABEL]?.value ?? "",
    question: r[QF.QUESTION]?.value ?? "",
    autoYes: r[QF.AUTOYES]?.value ?? "",
  }));
}
