/** The single source of truth for turning a raw QuickBase `record` into the
 *  "Record Details" a human sees beside an audit.
 *
 *  The mapping is a pile of bare numeric QuickBase field IDs (`rec["297"]` is
 *  room type / max occupancy, `rec["49"]` is marital status, and so on). Those
 *  numbers are meaningless on sight and easy to transpose, which is exactly why
 *  this lived in three hand-copied places — step-finalize (persisted onto the
 *  review queue), review-queue's rehydrate (rebuilt when a stored item came
 *  back empty), and judge-repository (rebuilt per read). A fourth copy was
 *  about to be written for the manager remediation view. One drifting digit in
 *  any copy shows a reviewer the wrong guest's details with no error anywhere,
 *  so they collapse to this.
 *
 *  Two shapes, chosen by `recordingIdField`: a GenieNumber audit is a PARTNER
 *  package (office / amount paid / MCC / MSP), anything else is an INTERNAL
 *  date-leg (spouse / destination / travel dates / WGS + MCC). Sale flags 460,
 *  594 and 345 match saleFlagsFromFinding — see that module before touching
 *  them.
 *
 *  Every field is optional and empty ones are dropped rather than sent as ""
 *  so a caller can tell "no record data at all" from "this one field is blank".
 *
 *  Pure — plain object in, plain object out, no Deno/IO. Imported by both the
 *  backend (`@core/...`) and the Fresh frontend, so it MUST stay bundle-safe. */

/** The rendered Record Details payload. Keys are stable — VerdictPanel and the
 *  manager remediation view both read them by name.
 *
 *  A `type` (not an `interface`) on purpose: the queue item types declare this
 *  field as `Record<string, string | undefined>`, and only a type alias carries
 *  the implicit index signature that makes it assignable to one. */
export type RecordMeta = {
  voName?: string;
  guestName?: string;
  spouseName?: string;
  maritalStatus?: string;
  destination?: string;
  arrivalDate?: string;
  departureDate?: string;
  roomTypeMaxOccupancy?: string;
  tourTime?: string;
  opcGifting?: string;
  totalWGS?: string;
  totalMCC?: string;
  officeName?: string;
  totalAmountPaid?: string;
  hasMCC?: string;
  mspSubscription?: string;
};

/** A falsy QuickBase field is absent, not empty-string. Mirrors the original
 *  `rec.X ? String(rec.X) : undefined` guard exactly — note this also drops a
 *  literal 0, which is deliberate: a 0 amount / 0 WGS reads as "not sold". */
function field(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return v ? String(v) : undefined;
}

/** A QuickBase multitext field (289 OPC Gifting) is a list. Whichever path
 *  delivered it — the QB client already flattened it with String(), or the
 *  webhook body handed the raw array through — it reads as "A,B" with no space,
 *  which is fine for an autoYes contains-check and ugly in a grid a human
 *  scans. Display-only: the raw record keeps the comma-joined form the
 *  question expressions match against. */
function listField(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  if (!v) return undefined;
  const parts = (Array.isArray(v) ? v : String(v).split(","))
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Build the Record Details for one finding.
 *
 *  @param record            the finding's raw QuickBase record (may be missing)
 *  @param recordingIdField  "GenieNumber" ⇒ partner package, else date-leg */
export function buildRecordMeta(
  record: Record<string, unknown> | undefined | null,
  recordingIdField: string | undefined,
): RecordMeta {
  const rec = record ?? {};
  const isPackage = recordingIdField === "GenieNumber";

  const meta: RecordMeta = isPackage
    ? {
      voName: field(rec, "VoName"),
      guestName: field(rec, "GuestName"),
      maritalStatus: field(rec, "67"),
      officeName: field(rec, "OfficeName"),
      totalAmountPaid: field(rec, "145"),
      hasMCC: field(rec, "345"),
      mspSubscription: field(rec, "306"),
    }
    : {
      voName: field(rec, "VoName"),
      // Date-legs carry the guest under either the named field or fid 32.
      guestName: field(rec, "GuestName") ?? field(rec, "32"),
      spouseName: field(rec, "33"),
      maritalStatus: field(rec, "49"),
      roomTypeMaxOccupancy: field(rec, "297"),
      destination: field(rec, "DestinationDisplay") ?? field(rec, "314"),
      arrivalDate: field(rec, "8"),
      departureDate: field(rec, "10"),
      tourTime: field(rec, "16"),
      opcGifting: listField(rec, "289"),
      totalWGS: field(rec, "460"),
      totalMCC: field(rec, "594"),
    };

  // Drop the undefined keys so `Object.keys(meta).length` is a real answer to
  // "is there anything to show?" — the render sites gate on exactly that.
  for (const k of Object.keys(meta) as Array<keyof RecordMeta>) {
    if (meta[k] === undefined) delete meta[k];
  }
  return meta;
}
