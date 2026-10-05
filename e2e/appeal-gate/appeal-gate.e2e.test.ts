/** An audit in the review queue can't be appealed until its review is finished
 *  (REQ-003 / REQ-004) — driven against the served app.
 *
 *  Each story seeds its own finding into the emulator project `serve` reads
 *  (`deno task test:e2e` points FIREBASE_PROJECT_ID at it), then reads the
 *  public report page and calls the appeal endpoints the File Appeal button
 *  uses, the way an agent following the terminate email would. */
import { http } from "#shots";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import {
  finalizeReviewedAudit,
  populateReviewQueue,
  recordDecision,
} from "@review/domain/business/review-queue/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

const ANSWERED = [
  { header: "Matching IDs", populated: "Did the agent match IDs?", thinking: "No ID check heard", defense: "", answer: "No" },
  { header: "Attending Presentation Together?", populated: "Both attending?", thinking: "Confirmed", defense: "", answer: "Yes" },
  { header: "Active Bankruptcy", populated: "Asked about bankruptcy?", thinking: "Not asked", defense: "", answer: "No" },
];

/** A finished audit with two failed questions (0 and 2), queued for review. */
async function queuedAudit(): Promise<string> {
  const id = "e2e-appeal-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: ANSWERED,
    completedAt: Date.now(),
    record: { RecordId: "900001", VoName: "DS MB - Demo Agent" },
    recordingId: "27200000",
    recordingIdField: "VoGenie",
    owner: "api",
  });
  await populateReviewQueue(ORG, id, ANSWERED, "VoGenie", "900001");
  return id;
}

const appealBody = (id: string) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ findingId: id, auditor: "agent@monsterrg.com", appealedQuestions: [0, 2] }),
});

Deno.test("REQ-003: a report awaiting review shows Awaiting Review and refuses every appeal", (t) =>
  http(t, async ({ http, expect }) => {
    const id = await queuedAudit();

    const page = await (await http(`/audit/report?id=${id}`)).text();
    expect(page.includes("Awaiting Review"), "the report shows the locked Awaiting Review button");
    expect(!page.includes(">File Appeal<"), "the report offers no live File Appeal button");

    const appeal = await (await http("/api/audit/appeal", appealBody(id))).json();
    expect.eq(appeal.ok, false, "a judge appeal is refused");
    expect(String(appeal.error).includes("awaiting review"), "the refusal says the audit is awaiting review");

    const reaudit = await (await http("/api/audit/appeal/different-recording", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingId: id, recordingIds: ["27200001"], agentEmail: "agent@monsterrg.com" }),
    })).json();
    expect.eq(reaudit.ok, false, "a different-recording re-audit is refused");
    expect(String(reaudit.error).includes("awaiting review"), "that refusal says the audit is awaiting review");
  }));

Deno.test("REQ-004: File Appeal opens only after a reviewer finishes ALL the failed questions", (t) =>
  http(t, async ({ http, expect }) => {
    const id = await queuedAudit();

    await recordDecision(ORG, id, 0, "confirm", "reviewer@monsterrg.com");
    const partly = await (await http(`/audit/report?id=${id}`)).text();
    expect(partly.includes("Awaiting Review"), "one failed question still undecided — the button stays locked");

    await recordDecision(ORG, id, 2, "confirm", "reviewer@monsterrg.com");
    await finalizeReviewedAudit(ORG, id, "reviewer@monsterrg.com");
    const reviewed = await (await http(`/audit/report?id=${id}`)).text();
    expect(reviewed.includes(">File Appeal<"), "the finished review shows the live File Appeal button");
    expect(!reviewed.includes("Awaiting Review"), "and no Awaiting Review lock");

    const appeal = await (await http("/api/audit/appeal", appealBody(id))).json();
    expect.eq(appeal.ok, true, "the appeal now goes through");
  }));
