/** QuickBase API client. */

/** Strip non-numeric suffixes from a Genie ID or comma-separated list of IDs.
 *  QB formula fields can return values like "27475188-error"; only the numeric part is valid.
 *  Comma-separated multi-genie values like "27475188,28391234" are preserved as-is.
 *  "27475188-error"        → "27475188"
 *  "27475188,28391234"     → "27475188,28391234"
 *  "27475188-error,28391" → "27475188,28391" */
function cleanGenieId(raw: unknown): string {
  const str = String(raw ?? "").trim();
  if (!str) return "";
  return str
    .split(",")
    .map((s) => s.trim().replace(/[^0-9].*$/, ""))
    .filter((s) => s.length > 0)
    .join(",");
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

interface QBQueryOptions {
  tableId: string;
  where: string;
  select: number[];
  sortBy?: { fieldId: number; order: "ASC" | "DESC" }[];
}

const QB_TIMEOUT_MS = 30_000;
const QB_RETRY_DELAYS = [2000, 5000, 10000]; // 3 retries: 2s, 5s, 10s

export async function queryRecords(opts: QBQueryOptions, attempt = 0): Promise<any[]> {
  const body: any = {
    from: opts.tableId,
    where: opts.where,
    select: opts.select,
  };
  if (opts.sortBy) body.sortBy = opts.sortBy;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QB_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API}/records/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    const msg = String(e?.message ?? e);
    const isTimeout = msg.includes("aborted") || msg.includes("AbortError");
    const label = isTimeout ? `timed out after ${QB_TIMEOUT_MS / 1000}s` : msg;
    if (attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(`[QB] ⚠️ queryRecords attempt ${attempt + 1} ${label} — retrying in ${delay}ms (table=${opts.tableId})`);
      await new Promise((r) => setTimeout(r, delay));
      return queryRecords(opts, attempt + 1);
    }
    throw new Error(`QuickBase query failed after ${attempt + 1} attempts: ${label} (table=${opts.tableId})`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt < QB_RETRY_DELAYS.length) {
      const delay = QB_RETRY_DELAYS[attempt];
      console.warn(`[QB] ⚠️ queryRecords attempt ${attempt + 1} got ${res.status} — retrying in ${delay}ms (table=${opts.tableId})`);
      await new Promise((r) => setTimeout(r, delay));
      return queryRecords(opts, attempt + 1);
    }
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
const FIELD_DESTINATION_DISPLAY = 566;
const FIELD_ACTIVATING_OFFICE = 140; // Activating Office (department)
// AutoYes expression fields on date leg records
const DATE_LEG_AUTOYES_FIELDS = [
  8,   // ArrivalDate
  10,  // DepartureDate
  32,  // GuestName
  33,  // SpouseName
  49,  // MaritalStatus
  297, // RoomTypeMaxOccupancy
  314, // DestinationPretty
  460, // TotalWGSAttached
  553, // DepositCollected
  594, // TotalMCCAttached
  706, // TotalAmountPaid
];

/** Fetch a date leg record by RID, returning human-readable field map. */
export async function getDateLegByRid(rid: string): Promise<Record<string, any> | null> {
  const records = await queryRecords({
    tableId: DATE_LEGS_TABLE,
    where: `{${FIELD_RECORD_ID}.EX.'${rid}'}`,
    select: [
      FIELD_RECORD_ID, FIELD_VO_GENIE, FIELD_RELATED_DESTINATION, FIELD_DESTINATION_DISPLAY,
      FIELD_GUEST_NAME, FIELD_VO_NAME, FIELD_VO_EMAIL, FIELD_SUPERVISOR_EMAIL, FIELD_ACTIVATING_OFFICE,
      ...DATE_LEG_AUTOYES_FIELDS,
    ],
  });

  if (records.length === 0) return null;

  const r = records[0];
  const autoYesValues: Record<string, string> = {};
  for (const fid of DATE_LEG_AUTOYES_FIELDS) {
    autoYesValues[String(fid)] = r[fid]?.value != null ? String(r[fid].value) : "";
  }

  return {
    RecordId: r[FIELD_RECORD_ID]?.value ?? rid,
    VoGenie: cleanGenieId(r[FIELD_VO_GENIE]?.value),
    RelatedDestinationId: r[FIELD_RELATED_DESTINATION]?.value ?? "",
    DestinationDisplay: r[FIELD_DESTINATION_DISPLAY]?.value ?? "",
    GuestName: r[FIELD_GUEST_NAME]?.value ?? "",
    VoName: r[FIELD_VO_NAME]?.value ?? "",
    VoEmail: r[FIELD_VO_EMAIL]?.value ?? "",
    SupervisorEmail: r[FIELD_SUPERVISOR_EMAIL]?.value ?? "",
    ActivatingOffice: String(r[FIELD_ACTIVATING_OFFICE]?.value ?? ""),
    ...autoYesValues,
  };
}

// PACKAGES table
const PACKAGES_TABLE = "bttffb64u";
const PKG_FIELD_RECORD_ID = 3;
const PKG_FIELD_GENIE_NUMBER = 18;    // GenieNumber — recording ID field
const PKG_FIELD_RELATED_OFFICE_ID = 45;  // RelatedOfficeId — used to derive destination
const PKG_FIELD_OFFICE_NAME = 46;         // Office (department)
const PKG_FIELD_GM_EMAIL = 114;           // RelatedOfficeId - Office GM Email — audit result recipient
// AutoYes expression fields on package records
const PACKAGE_AUTOYES_FIELDS = [
  67,  // MaritalStatus
  306, // MSPSubscription
  345, // HasMCC
];

/** Fetch a package record by RID, returning a field map with numeric string keys for autoYes expressions. */
export async function getPackageByRid(rid: string): Promise<Record<string, any> | null> {
  const records = await queryRecords({
    tableId: PACKAGES_TABLE,
    where: `{${PKG_FIELD_RECORD_ID}.EX.'${rid}'}`,
    select: [PKG_FIELD_RECORD_ID, PKG_FIELD_GENIE_NUMBER, PKG_FIELD_RELATED_OFFICE_ID, PKG_FIELD_OFFICE_NAME, PKG_FIELD_GM_EMAIL, ...PACKAGE_AUTOYES_FIELDS],
  });

  if (records.length === 0) return null;

  const r = records[0];
  const autoYesValues: Record<string, string> = {};
  for (const fid of PACKAGE_AUTOYES_FIELDS) {
    autoYesValues[String(fid)] = r[fid]?.value != null ? String(r[fid].value) : "";
  }

  return {
    RecordId: r[PKG_FIELD_RECORD_ID]?.value ?? rid,
    GenieNumber: cleanGenieId(r[PKG_FIELD_GENIE_NUMBER]?.value),
    RelatedOfficeId: r[PKG_FIELD_RELATED_OFFICE_ID]?.value ?? 0,
    OfficeName: String(r[PKG_FIELD_OFFICE_NAME]?.value ?? ""),
    GmEmail: r[PKG_FIELD_GM_EMAIL]?.value ?? "",
    ...autoYesValues,
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
