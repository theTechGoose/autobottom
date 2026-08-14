/** Guards the QuickBase field-ID mapping. These numbers are the whole point of
 *  the module — a transposed digit silently shows the wrong guest's details, so
 *  every ID is pinned here against the shape the three original call sites
 *  (step-finalize, review-queue rehydrate, judge-repository) hand-built. */
import { assertEquals } from "#assert";
import { buildRecordMeta } from "./mod.ts";

Deno.test("buildRecordMeta — date-leg maps every QuickBase field ID", () => {
  const meta = buildRecordMeta({
    VoName: "VO 12 - Jane Doe",
    GuestName: "Sam Guest",
    "33": "Pat Guest",
    "49": "Married",
    "297": "Suite / 4",
    DestinationDisplay: "Cancun",
    "8": "2026-09-01",
    "10": "2026-09-08",
    "16": "9:30 AM",
    "289": "$50 Resort Credit,8/7 Monster Week",
    "460": "1200",
    "594": "yes",
  }, "RecordingId");

  assertEquals(meta, {
    voName: "VO 12 - Jane Doe",
    guestName: "Sam Guest",
    spouseName: "Pat Guest",
    maritalStatus: "Married",
    roomTypeMaxOccupancy: "Suite / 4",
    destination: "Cancun",
    arrivalDate: "2026-09-01",
    departureDate: "2026-09-08",
    tourTime: "9:30 AM",
    opcGifting: "$50 Resort Credit, 8/7 Monster Week",
    totalWGS: "1200",
    totalMCC: "yes",
  });
});

Deno.test("buildRecordMeta — OPC Gifting reads as a list either way it arrives", () => {
  // The QB client flattens the multitext with String() before it lands on the
  // finding; the webhook-body fallback path hands the raw array straight
  // through. Both must render the same spaced list for a human.
  const joined = buildRecordMeta({ "289": "$50 Resort Credit,8/7 Monster Week" }, undefined);
  const raw = buildRecordMeta({ "289": ["$50 Resort Credit", "8/7 Monster Week"] }, undefined);
  assertEquals(joined.opcGifting, "$50 Resort Credit, 8/7 Monster Week");
  assertEquals(raw.opcGifting, "$50 Resort Credit, 8/7 Monster Week");

  // A single value stays a single value, and an empty list is absent, not "".
  assertEquals(buildRecordMeta({ "289": "$50 Resort Credit" }, undefined).opcGifting, "$50 Resort Credit");
  assertEquals(buildRecordMeta({ "289": [] }, undefined), {});
  assertEquals(buildRecordMeta({ "289": ",  ," }, undefined), {});
});

Deno.test("buildRecordMeta — package (GenieNumber) uses the partner field set", () => {
  const meta = buildRecordMeta({
    VoName: "Jamie Partner",
    GuestName: "Sam Guest",
    "67": "Single",
    OfficeName: "ODS WFH",
    "145": "3499.00",
    "345": "1",
    "306": "yes",
    // Date-leg-only fields must NOT leak into the package shape.
    "33": "Pat Guest",
    "16": "9:30 AM",
    "289": "$50 Resort Credit",
    "460": "1200",
  }, "GenieNumber");

  assertEquals(meta, {
    voName: "Jamie Partner",
    guestName: "Sam Guest",
    maritalStatus: "Single",
    officeName: "ODS WFH",
    totalAmountPaid: "3499.00",
    hasMCC: "1",
    mspSubscription: "yes",
  });
});

Deno.test("buildRecordMeta — date-leg falls back to fid 32 / 314", () => {
  const meta = buildRecordMeta({ "32": "Fallback Guest", "314": "Punta Cana" }, undefined);
  assertEquals(meta.guestName, "Fallback Guest");
  assertEquals(meta.destination, "Punta Cana");
});

Deno.test("buildRecordMeta — named fields win over the numeric fallbacks", () => {
  const meta = buildRecordMeta(
    { GuestName: "Named", "32": "Numeric", DestinationDisplay: "Named Dest", "314": "Numeric Dest" },
    undefined,
  );
  assertEquals(meta.guestName, "Named");
  assertEquals(meta.destination, "Named Dest");
});

Deno.test("buildRecordMeta — empty fields are dropped, so an empty record is empty", () => {
  // The render sites gate on Object.keys(meta).length > 0; a record of blanks
  // must not present as "has details" and draw a grid of em-dashes.
  assertEquals(buildRecordMeta({ GuestName: "", "49": "" }, undefined), {});
  assertEquals(buildRecordMeta({}, undefined), {});
  assertEquals(buildRecordMeta(undefined, undefined), {});
  assertEquals(buildRecordMeta(null, "GenieNumber"), {});
});

Deno.test("buildRecordMeta — a partial record keeps only what is there", () => {
  const meta = buildRecordMeta({ GuestName: "Solo" }, undefined);
  assertEquals(meta, { guestName: "Solo" });
});
