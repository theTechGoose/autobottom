/** readFullFinding fills in what the finding doc is missing from the canonical
 *  transcript store — including a multi-recording audit's per-recording line
 *  times, which the scrub view needs to play the right recording (REQ-015). */
import { assertEquals } from "#assert";
import { readFullFinding } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

Deno.test({
  name: "REQ-015: a finding doc without the recording line times gets them from the store, with the store's raw text",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const tag = crypto.randomUUID().slice(0, 8);
    const orgId = ("test-rf-" + tag) as unknown as OrgId;
    const id = "fid-rf-" + tag;
    const storeRaw = "[AGENT]: one\n[AGENT]: two\n[CUSTOMER]: three";
    await saveFinding(orgId, {
      id, findingStatus: "finished", record: { RecordId: 1 },
      // A stale working copy — the times index the STORE's lines, not these.
      rawTranscript: "[AGENT]: one two three",
      s3RecordingKeys: ["a.mp3", "b.mp3"],
    });
    await saveTranscript(orgId, id, storeRaw, storeRaw, undefined, {
      recordingLineTimes: [0, 3000, 0],
      recordingLineIdx: [0, 0, 1],
    });

    const read = await readFullFinding(orgId, id);
    assertEquals(read.kind, "found");
    const f = (read as { finding: Record<string, unknown> }).finding;
    assertEquals(f.recordingLineTimes, [0, 3000, 0]);
    assertEquals(f.recordingLineIdx, [0, 0, 1]);
    assertEquals(f.rawTranscript, storeRaw, "taken as a matched pair with the times");
  },
});
