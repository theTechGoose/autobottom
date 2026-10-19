/** REQ-016: audits transcribed before REQ-015 get their per-recording line
 *  times back by re-reading their own AssemblyAI transcripts. AssemblyAI is
 *  stubbed; storage is the emulator. */
import { assert, assertEquals } from "#assert";
import { backfillRecordingLines } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { getFinding, getTranscript, saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };
const utt = (speaker: string, text: string, start: number) => ({ speaker, text, start, end: start + 1000 });

const TRANSCRIPTS: Record<string, unknown> = {
  "tid-A": { status: "completed", utterances: [utt("A", "hi", 0), utt("B", "hello", 2000)] },
  "tid-B": { status: "completed", utterances: [utt("A", "calling back", 0)] },
};
// What step-poll-transcript joined these into, before line times were stored.
const JOINED = "[AGENT]: hi\n[CUSTOMER]: hello\n[AGENT]: calling back";

function stubAssemblyAi(): { polled: string[]; undo: () => void } {
  const original = globalThis.fetch;
  const polled: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    if (url.includes("api.assemblyai.com")) {
      const id = url.match(/\/transcript\/([^/?]+)$/)?.[1] ?? "";
      polled.push(id);
      return new Response(JSON.stringify(TRANSCRIPTS[id] ?? { status: "error" }), { status: 200 });
    }
    return original(input, init);
  }) as typeof globalThis.fetch;
  return { polled, undo: () => { globalThis.fetch = original; } };
}

async function seed(over: Record<string, unknown> = {}): Promise<{ orgId: OrgId; id: string }> {
  resetFirestoreCredentials();
  const tag = crypto.randomUUID().slice(0, 8);
  const orgId = ("test-rlb-" + tag) as unknown as OrgId;
  const id = "fid-rlb-" + tag;
  await saveFinding(orgId, {
    id, findingStatus: "finished", record: { RecordId: 1 },
    s3RecordingKeys: ["a.mp3", "b.mp3"],
    assemblyAiTranscriptIds: ["tid-A", "tid-B"],
    rawTranscript: JOINED,
    ...over,
  });
  await saveTranscript(orgId, id, JOINED, "diarized text");
  return { orgId, id };
}

Deno.test({
  name: "REQ-016: an old multi-recording audit gets its per-recording line times from its own transcripts",
  ...kvOpts,
  fn: async () => {
    const { orgId, id } = await seed();
    const stub = stubAssemblyAi();
    try {
      const [r] = await backfillRecordingLines(orgId, [id], { apply: true });
      assertEquals(r.outcome, "updated");
      assertEquals(stub.polled, ["tid-A", "tid-B"]);
      const f = await getFinding(orgId, id) as Record<string, unknown>;
      assertEquals(f.recordingLineTimes, [0, 2000, 0]);
      assertEquals(f.recordingLineIdx, [0, 0, 1]);
      const t = await getTranscript(orgId, id);
      assertEquals(t?.recordingLineTimes, [0, 2000, 0]);
      assertEquals(t?.diarized, "diarized text", "the rest of the transcript doc is kept");
    } finally {
      stub.undo();
    }
  },
});

Deno.test({
  name: "REQ-016: a dry run writes nothing",
  ...kvOpts,
  fn: async () => {
    const { orgId, id } = await seed();
    const stub = stubAssemblyAi();
    try {
      const [r] = await backfillRecordingLines(orgId, [id], { apply: false });
      assertEquals(r.outcome, "would-update");
      const f = await getFinding(orgId, id) as Record<string, unknown>;
      assert(!f.recordingLineTimes);
    } finally {
      stub.undo();
    }
  },
});

Deno.test({
  name: "REQ-016: skipped when the stored text no longer matches the transcripts",
  ...kvOpts,
  fn: async () => {
    const { orgId, id } = await seed({ rawTranscript: "[AGENT]: something else" });
    await saveTranscript(orgId, id, "[AGENT]: something else");
    const stub = stubAssemblyAi();
    try {
      const [r] = await backfillRecordingLines(orgId, [id], { apply: true });
      assertEquals(r.outcome, "skipped");
      assert(!(await getFinding(orgId, id) as Record<string, unknown>).recordingLineTimes);
    } finally {
      stub.undo();
    }
  },
});

Deno.test({
  name: "REQ-016: skipped when a recording was never submitted and the mapping is unknown",
  ...kvOpts,
  fn: async () => {
    // Three recordings, two transcripts, no record of which is which.
    const { orgId, id } = await seed({ s3RecordingKeys: ["a.mp3", "b.mp3", "c.mp3"] });
    const stub = stubAssemblyAi();
    try {
      const [r] = await backfillRecordingLines(orgId, [id], { apply: true });
      assertEquals(r.outcome, "skipped");
      assertEquals(stub.polled, [], "no AssemblyAI calls for an audit it can't fix");
    } finally {
      stub.undo();
    }
  },
});

Deno.test({
  name: "REQ-016: single-recording audits and audits that already have times are left alone",
  ...kvOpts,
  fn: async () => {
    const single = await seed({ s3RecordingKeys: ["a.mp3"], assemblyAiTranscriptIds: undefined });
    const done = await seed({ recordingLineTimes: [0, 2000, 0], recordingLineIdx: [0, 0, 1] });
    const stub = stubAssemblyAi();
    try {
      const [a] = await backfillRecordingLines(single.orgId, [single.id], { apply: true });
      const [b] = await backfillRecordingLines(done.orgId, [done.id], { apply: true });
      assertEquals(a.outcome, "not-multi");
      assertEquals(b.outcome, "has-times");
      assertEquals(stub.polled, []);
    } finally {
      stub.undo();
    }
  },
});

Deno.test({
  name: "REQ-016: a multi-recording audit with no transcript ids says so",
  ...kvOpts,
  fn: async () => {
    const { orgId, id } = await seed({ assemblyAiTranscriptIds: undefined });
    const stub = stubAssemblyAi();
    try {
      const [r] = await backfillRecordingLines(orgId, [id], { apply: true });
      assertEquals(r.outcome, "skipped");
      assertEquals(r.reason, "no AssemblyAI transcript ids stored on the finding");
    } finally {
      stub.undo();
    }
  },
});
