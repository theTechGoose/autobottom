/** Ingest: how the QuickBase "VO Genie #" field is split into `genieIds`.
 *
 *  The rule is that a genie ID is DIGITS, so every run of digits in the field
 *  is one ID and whatever sits between them is a separator (`splitGenieIds`,
 *  `core/business/genie-ids/mod.ts`). These fixtures are the same three audits
 *  saved once per separator a human has actually typed — "," ";" "|" — and
 *  each one must land the same way.
 *
 *  It used to split on a comma and nothing else, so any other separator kept
 *  the field as ONE string:
 *
 *    "27660806; 27660810"  →  genieIdList = ["27660806; 27660810"]
 *                          →  genieIds    = undefined   (needs length > 1)
 *                          →  recordingId = "27660806; 27660810"
 *
 *  With `genieIds` unset, step-init never took the multi-genie branch: no
 *  second download, no stitched.mp3, and the leftover `recordingId` was
 *  trimmed at the first non-digit down to "27660806" — so the audit silently
 *  graded ONE call and reported no error.
 *
 *  The comma control at the bottom is the harness check: if it ever goes red
 *  the test setup is broken, not the separator handling. */

import { assert, assertEquals } from "#assert";
import { getFinding } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

const FIXTURES = new URL("../../../../fixtures/mutliple-genies/", import.meta.url);

interface Fixture {
  record: Record<string, unknown>;
  recordingIdField: string;
}

function loadFixture(name: string): Fixture {
  const raw = Deno.readTextFileSync(new URL(name, FIXTURES));
  const f = JSON.parse(raw) as Fixture;
  return { record: f.record, recordingIdField: f.recordingIdField };
}

/** Every outbound call a create-audit request makes, stubbed:
 *    QuickBase  → empty result set, so the controller falls back to body.record
 *                 (that is where the fixture's semicolon value lives).
 *    QStash     → captured, never executed, so no genie download / grading runs.
 *    Firestore + S3 emulators pass through — the finding is really written and
 *    really read back. */
function installStubs(): { restore: () => void } {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    if (url.includes("/records/query")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes(":9002") || url.includes("/audit/step/")) {
      return new Response(JSON.stringify({ messageId: "stub" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if ([":8099", ":9001", ":9003"].some((port) => url.includes(port))) return originalFetch(input, init);
    return new Response("", { status: 500 });
  }) as typeof globalThis.fetch;
  return { restore: () => { globalThis.fetch = originalFetch; } };
}

/** Drive the real ingest endpoint with this fixture's record and hand back the
 *  finding it wrote. */
async function ingest(fixture: Fixture, tag: string): Promise<Record<string, unknown>> {
  const orgId = `test-genie-sep-${tag}-${crypto.randomUUID().slice(0, 8)}` as unknown as OrgId;
  Deno.env.set("DEFAULT_ORG_ID", String(orgId));
  const stubs = installStubs();
  try {
    const { AuditController } = await import("./mod.ts");
    const controller = new AuditController();
    const rid = String(fixture.record.RecordId ?? "");
    const result = await controller.createDateLegAudit(
      { record: fixture.record, recordingIdField: fixture.recordingIdField, owner: "test@x.com" },
      // callback_url / qlab_config / override / audit_id are absent on a real
      // ingest call. They must be undefined, not "": the controller picks
      // `override ?? genieIdList[0]`, and "" is not nullish, so an empty string
      // would silently become the recordingId.
      rid, undefined as unknown as string, undefined as unknown as string,
      undefined as unknown as string, undefined as unknown as string,
    ) as { findingId: string };
    const finding = await getFinding(orgId, result.findingId, { cache: false });
    assert(finding, `ingest wrote no finding for ${tag}`);
    return finding!;
  } finally {
    stubs.restore();
  }
}

/** One entry per audit. Each is loaded once per separator below, so a new
 *  separator is one string here, not three more fixtures' worth of tests. */
const AUDITS: Array<{ stem: string; tag: string; expected: string[] }> = [
  { stem: "Ab5OvJaL1Mq49c7dz5Vp7", tag: "two-legs", expected: ["27660806", "27660810"] },
  { stem: "FD4umsgBmp5M_WkmFaGV5", tag: "typo-leg", expected: ["27656948", "26756953"] },
  { stem: "XRjSxHcEulpcGtDc9OVy5", tag: "same-twice", expected: ["27621999", "27621999"] },
];

const SEPARATORS = ["semicolon", "pipe"];

for (const separator of SEPARATORS) {
  for (const { stem, tag, expected } of AUDITS) {
    const fixture = loadFixture(`${stem}-${separator}.json`);
    const raw = String(fixture.record[fixture.recordingIdField]);

    Deno.test({
      name: `ingest — ${separator}: "${raw}" splits into two genies (${tag})`,
      ...kvOpts,
      fn: async () => {
        const finding = await ingest(fixture, `${tag}-${separator}`);
        assertEquals(
          finding.genieIds,
          expected,
          `a ${separator}-separated field must yield both genies; got ${JSON.stringify(finding.genieIds ?? null)}`,
        );
      },
    });

    Deno.test({
      name: `ingest — ${separator} field leaves no separator in recordingId (${tag})`,
      ...kvOpts,
      fn: async () => {
        const finding = await ingest(fixture, `${tag}-${separator}-rid`);
        assertEquals(
          finding.recordingId,
          expected[0],
          `recordingId must be the first genie alone, not the whole raw field; got ${JSON.stringify(finding.recordingId)}`,
        );
      },
    });
  }
}

/** Control: the same audit with the separator it actually has in QuickBase
 *  today. Passes now — if this one ever goes red the harness is broken, not
 *  the separator handling. */
Deno.test({
  name: `ingest — comma control: "27660806,27660810" splits into two genies`,
  ...kvOpts,
  fn: async () => {
    const finding = await ingest(loadFixture("Ab5OvJaL1Mq49c7dz5Vp7.json"), "comma-control");
    assertEquals(finding.genieIds, ["27660806", "27660810"]);
    assertEquals(finding.recordingId, "27660806");
  },
});
