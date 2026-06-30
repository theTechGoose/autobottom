/** Regression tests for the 76UGB0H1yVYu54OHQgGVe incident: a diarization
 *  refusal/meta reply was persisted to finding.diarizedTranscript +
 *  audit-transcript.diarized with no validation, then rendered as the report
 *  transcript. These pin the persistence-boundary guard: when diarize() yields
 *  something that isn't a real transcript, the step stores the raw transcript
 *  instead — never the garbage.
 *
 *  Groq is scripted via the __setGroqTestFetch seam (no network); Firestore
 *  falls back to in-memory via resetFirestoreCredentials(). */

import { assert, assertEquals } from "#assert";
import { stepDiarizeAsync } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding, getFinding, getTranscript, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { __setGroqTestFetch } from "@audit/domain/data/groq/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

const SYS_DIARIZE = "Transcription Formatting Bot";
const SYS_QA = "evaluating speaker diarization";
const SYS_MANAGER = "speaker-identifier bot manager";

const PROD_REFUSAL =
  "[AGENT]: Sure! Please share the audio file or the raw text of the conversation " +
  "you'd like transcribed, and I'll return a complete transcription with the required " +
  "speaker labels ([CUSTOMER] and [AGENT]) for you to evaluate.";

const RAW = [
  "All right, thank you so much. So am I speaking with Christopher? Yes, sir.",
  "Okay. And I'm Patty with Monster Reservations Group. Running through your booking. Okay.",
  "You're arriving to Myrtle Beach on the 26th of July through the 30th, correct? Yes, ma'am.",
].join(" ");

const GOOD_DIARIZED = [
  "[AGENT]: All right, thank you so much. So am I speaking with Christopher?",
  "[CUSTOMER]: Yes, sir.",
  "[AGENT]: Okay. And I'm Patty with Monster Reservations Group. Running through your booking.",
  "[CUSTOMER]: Okay.",
  "[AGENT]: You're arriving to Myrtle Beach on the 26th of July through the 30th, correct?",
  "[CUSTOMER]: Yes, ma'am.",
].join("\n");

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "openai/gpt-oss-120b",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function installGroqStub(opts: { diarizeOutput: string; qa: string; managerFeedback?: string | null }): () => void {
  const stub = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const sys = String(body?.messages?.[0]?.content ?? "");
    let content = "";
    if (sys.includes(SYS_DIARIZE)) content = opts.diarizeOutput;
    else if (sys.includes(SYS_QA)) content = opts.qa;
    else if (sys.includes(SYS_MANAGER)) {
      content = JSON.stringify({ isCorrect: opts.qa.trim() === "Yes", thinking: "stub", feedback: opts.managerFeedback ?? null });
    }
    return Promise.resolve(completion(content));
  };
  __setGroqTestFetch(stub);
  return () => __setGroqTestFetch(undefined);
}

function reqWith(body: Record<string, unknown>): Request {
  return new Request("https://test.local/audit/step/diarize-async", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function uniqueIds(): { orgId: OrgId; findingId: string } {
  const tag = crypto.randomUUID().slice(0, 8);
  return { orgId: ("test-diar-" + tag) as unknown as OrgId, findingId: "fid-diar-" + tag };
}

// ── Test A — refusal must NOT be persisted; raw transcript stored instead ────

Deno.test({
  name: "stepDiarizeAsync — refusal output stores raw transcript, never the garbage (76UGB0… regression)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, { id: findingId, findingStatus: "finished", record: { RecordId: 1 } });
    const undo = installGroqStub({ diarizeOutput: PROD_REFUSAL, qa: "This is not good enough", managerFeedback: "Apply labels." });
    try {
      const res = await stepDiarizeAsync(reqWith({ findingId, orgId, rawTranscript: RAW }));
      assertEquals(res.status, 200);

      const t = await getTranscript(orgId, findingId);
      assertEquals(t?.diarized, RAW, "canonical audit-transcript must not hold the refusal");
      assert(!(t?.diarized as string).includes("Please share"), "refusal text must not reach the transcript store");
    } finally {
      undo();
    }
  },
});

// ── Test B — valid diarization is persisted as-is ────────────────────────────

Deno.test({
  name: "stepDiarizeAsync — valid diarization is persisted to finding + audit-transcript",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, { id: findingId, findingStatus: "finished", record: { RecordId: 1 } });
    const undo = installGroqStub({ diarizeOutput: GOOD_DIARIZED, qa: "Yes" });
    try {
      const res = await stepDiarizeAsync(reqWith({ findingId, orgId, rawTranscript: RAW }));
      assertEquals(res.status, 200);

      const t = await getTranscript(orgId, findingId);
      assertEquals(t?.diarized, GOOD_DIARIZED);
    } finally {
      undo();
    }
  },
});

// ── Test B2 — valid diarization the QA bot never confirms is still kept ───────

Deno.test({
  name: "stepDiarizeAsync — valid diarization is kept even when QA never says exactly 'Yes' (not dropped to raw)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, { id: findingId, findingStatus: "finished", record: { RecordId: 1 } });
    // Output is a real labeled transcript, but the strict QA bot never emits the
    // exact "Yes" — diarize() must return the transcript, not fall back to raw.
    const undo = installGroqStub({ diarizeOutput: GOOD_DIARIZED, qa: "looks great to me", managerFeedback: null });
    try {
      const res = await stepDiarizeAsync(reqWith({ findingId, orgId, rawTranscript: RAW }));
      assertEquals(res.status, 200);
      const t = await getTranscript(orgId, findingId);
      assertEquals(t?.diarized, GOOD_DIARIZED);
    } finally {
      undo();
    }
  },
});

// ── Test C — already-diarized transcript is left untouched ───────────────────

Deno.test({
  name: "stepDiarizeAsync — skips when the transcript store is already diarized",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    await saveFinding(orgId, { id: findingId, findingStatus: "finished", record: { RecordId: 1 } });
    // Seed the transcript store with a real diarized transcript (distinct from raw).
    await saveTranscript(orgId, findingId, RAW, GOOD_DIARIZED);
    // No Groq stub installed — if the step tried to diarize it would error out,
    // proving the skip path is taken.
    const res = await stepDiarizeAsync(reqWith({ findingId, orgId, rawTranscript: RAW }));
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.skipped, true);
    const t = await getTranscript(orgId, findingId);
    assertEquals(t?.diarized, GOOD_DIARIZED, "existing diarization must be preserved");
  },
});

// ── Test D — finalize-race fix: diarize-async must NOT touch the finding doc ──

Deno.test({
  name: "stepDiarizeAsync — does NOT revert a finished finding (status/answers/score preserved)",
  ...kvOpts,
  fn: async () => {
    resetFirestoreCredentials();
    const { orgId, findingId } = uniqueIds();
    // Simulate finalize having already completed concurrently: finished + answers + score.
    await saveFinding(orgId, {
      id: findingId,
      findingStatus: "finished",
      answeredQuestions: [{ question: "Q1", answer: "Yes" }],
      score: 96,
      record: { RecordId: 1 },
    });
    const undo = installGroqStub({ diarizeOutput: GOOD_DIARIZED, qa: "Yes" });
    try {
      const res = await stepDiarizeAsync(reqWith({ findingId, orgId, rawTranscript: RAW }));
      assertEquals(res.status, 200);

      // The whole point of the fix: diarize-async never writes the finding doc,
      // so it cannot revert "finished" → "asking-questions" or wipe answers/score.
      const fresh = await getFinding(orgId, findingId);
      assertEquals(fresh?.findingStatus, "finished", "must NOT regress the finished status");
      assertEquals((fresh?.answeredQuestions as unknown[])?.length, 1, "answers must survive");
      assertEquals(fresh?.score, 96, "score must survive");

      // The diarized transcript lands in the transcript store instead.
      const t = await getTranscript(orgId, findingId);
      assertEquals(t?.diarized, GOOD_DIARIZED);
    } finally {
      undo();
    }
  },
});
