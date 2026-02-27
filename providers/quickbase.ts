/** QuickBase API client. */

function headers() {
  return {
    "QB-Realm-Hostname": `${Deno.env.get("QB_REALM")}.quickbase.com`,
    "User-Agent": "auto-bot",
    Authorization: `QB-USER-TOKEN ${Deno.env.get("QB_USER_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

const API = "https://api.quickbase.com/v1";

interface QBQueryOptions {
  tableId: string;
  where: string;
  select: number[];
  sortBy?: { fieldId: number; order: "ASC" | "DESC" }[];
}

export async function queryRecords(opts: QBQueryOptions): Promise<any[]> {
  const body: any = {
    from: opts.tableId,
    where: opts.where,
    select: opts.select,
  };
  if (opts.sortBy) body.sortBy = opts.sortBy;

  const res = await fetch(`${API}/records/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QuickBase query failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

// DATE_LEGS table
const DATE_LEGS_TABLE = "bpb28qsnn";
const FIELD_RECORD_ID = 3;
const FIELD_VO_GENIE = 145;
const FIELD_RELATED_DESTINATION = 292;
const FIELD_GUEST_NAME = 32;
const FIELD_VO_NAME = 144;
const FIELD_VO_EMAIL = 839;
const FIELD_SUPERVISOR_EMAIL = 851;

/** Fetch a date leg record by RID, returning human-readable field map. */
export async function getDateLegByRid(rid: string): Promise<Record<string, any> | null> {
  const records = await queryRecords({
    tableId: DATE_LEGS_TABLE,
    where: `{${FIELD_RECORD_ID}.EX.'${rid}'}`,
    select: [FIELD_RECORD_ID, FIELD_VO_GENIE, FIELD_RELATED_DESTINATION, FIELD_GUEST_NAME, FIELD_VO_NAME, FIELD_VO_EMAIL, FIELD_SUPERVISOR_EMAIL],
  });

  if (records.length === 0) return null;

  const r = records[0];
  return {
    RecordId: r[FIELD_RECORD_ID]?.value ?? rid,
    VoGenie: r[FIELD_VO_GENIE]?.value ?? "",
    RelatedDestinationId: r[FIELD_RELATED_DESTINATION]?.value ?? "",
    GuestName: r[FIELD_GUEST_NAME]?.value ?? "",
    VoName: r[FIELD_VO_NAME]?.value ?? "",
    VoEmail: r[FIELD_VO_EMAIL]?.value ?? "",
    SupervisorEmail: r[FIELD_SUPERVISOR_EMAIL]?.value ?? "",
  };
}

// VO Audit Questions table
const QUESTIONS_TABLE = "bu3e8x98x";
const FIELD_RELATED_DEST = Number(Deno.env.get("QB_AUDIT_QUESTIONS_DEST_FIELD") || "11");
const FIELD_REPORT_LABEL = Number(Deno.env.get("QB_AUDIT_QUESTIONS_LABEL_FIELD") || "7");
const FIELD_QUESTION = Number(Deno.env.get("QB_AUDIT_QUESTIONS_QUESTION_FIELD") || "6");
const FIELD_AUTOYES = Number(Deno.env.get("QB_AUDIT_QUESTIONS_AUTOYES_FIELD") || "14");

/** Fetch audit questions for a destination. */
export async function getQuestionsForDestination(destinationId: string): Promise<Array<{ header: string; question: string; autoYes: string }>> {
  if (!destinationId) {
    console.warn("[QB] No destinationId provided, skipping questions fetch");
    return [];
  }

  const records = await queryRecords({
    tableId: QUESTIONS_TABLE,
    where: `{${FIELD_RELATED_DEST}.EX.'${destinationId}'}`,
    select: [FIELD_REPORT_LABEL, FIELD_QUESTION, FIELD_AUTOYES],
  });

  return records.map((r: any) => ({
    header: r[FIELD_REPORT_LABEL]?.value ?? "",
    question: r[FIELD_QUESTION]?.value ?? "",
    autoYes: r[FIELD_AUTOYES]?.value ?? "",
  }));
}
