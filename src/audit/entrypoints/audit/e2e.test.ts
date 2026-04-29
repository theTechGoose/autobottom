/** E2E tests for the AuditController appeal endpoints — verifies that
 *  reauditWithGenies and fileAppeal return JSON with the expected fields,
 *  not bare {} which produced the "HTTP 200" UX bug. */

import { assert, assertEquals } from "#assert";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

// Force qstash into local-mode so enqueueStep doesn't hit Upstash during tests.
Deno.env.set("LOCAL_QUEUE", "true");

Deno.test({ name: "audit e2e — placeholder", sanitizeOps: false, sanitizeResources: false, fn: () => assert(true) });

Deno.test({ name: "AuditController.reauditWithGenies — returns ok+newFindingId for Invalid Genie input (regression)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG = "test-org-ctrl-" + crypto.randomUUID().slice(0, 8) as unknown as Parameters<typeof saveFinding>[0];
  Deno.env.set("DEFAULT_ORG_ID", String(ORG));

  const findingId = "fid-ctrl-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id: findingId,
    auditJobId: "job-" + crypto.randomUUID().slice(0, 8),
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    record: { RecordId: "465828" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
    owner: "test@x.com",
  });

  const { AuditController } = await import("./mod.ts");
  const controller = new AuditController();

  // Pass the body the way danet's @Body decorator delivers it — the parsed JSON object.
  const result = await controller.reauditWithGenies({
    findingId,
    recordingIds: ["27229612", "27229612"],
    comment: "test",
    agentEmail: "adamp@monsterrg.com",
  } as unknown as Parameters<typeof controller.reauditWithGenies>[0]);

  // Critical fields the AppealModal island reads:
  const r = result as Record<string, unknown>;
  assertEquals(r.ok, true, "controller must return ok:true on success");
  assert(typeof r.newFindingId === "string" && (r.newFindingId as string).length > 0, `newFindingId required, got: ${JSON.stringify(result)}`);
  assert(typeof r.reportUrl === "string" && (r.reportUrl as string).includes(r.newFindingId as string), `reportUrl must reference newFindingId`);
  assertEquals(r.appealType, "additional-recording", "27229612 was old.recordingId so this is additional, not different");
  assertEquals(r.agentEmail, "adamp@monsterrg.com");
}});

Deno.test({ name: "AuditController.reauditWithGenies — missing findingId returns ok:false+error JSON, not bare 500", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { AuditController } = await import("./mod.ts");
  const controller = new AuditController();

  const result = await controller.reauditWithGenies({
    recordingIds: ["123456"],
  } as unknown as Parameters<typeof controller.reauditWithGenies>[0]);

  const r = result as Record<string, unknown>;
  assertEquals(r.ok, false);
  assert(typeof r.error === "string" && (r.error as string).toLowerCase().includes("findingid"));
}});

Deno.test({ name: "AuditController.reauditWithGenies — empty recordingIds returns ok:false+error", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const { AuditController } = await import("./mod.ts");
  const controller = new AuditController();

  const result = await controller.reauditWithGenies({
    findingId: "x",
    recordingIds: [],
  } as unknown as Parameters<typeof controller.reauditWithGenies>[0]);

  const r = result as Record<string, unknown>;
  assertEquals(r.ok, false);
  assert(typeof r.error === "string" && (r.error as string).toLowerCase().includes("recordingids"));
}});

Deno.test({ name: "AuditController.fileAppeal — Invalid Genie returns ok:false+error JSON, not bare 500", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG2 = "test-org-fa-" + crypto.randomUUID().slice(0, 8) as unknown as Parameters<typeof saveFinding>[0];
  Deno.env.set("DEFAULT_ORG_ID", String(ORG2));

  const findingId = "fid-fa-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG2, {
    id: findingId,
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    answeredQuestions: [],
    record: { RecordId: "999" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
  });

  const { AuditController } = await import("./mod.ts");
  const controller = new AuditController();

  const result = await controller.fileAppeal({
    findingId,
    auditor: "test@x.com",
    appealedQuestions: [0],
  } as unknown as Parameters<typeof controller.fileAppeal>[0]);

  const r = result as Record<string, unknown>;
  assertEquals(r.ok, false, "Invalid Genie has no answeredQuestions to appeal");
  assert(typeof r.error === "string", "must include error message");
  assert(
    (r.error as string).toLowerCase().includes("no answered questions"),
    `expected 'no answered questions' in error, got: ${r.error}`,
  );
}});

Deno.test({ name: "AuditController.fileAppeal — happy path returns ok+queued+judgeUrl", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  resetFirestoreCredentials();
  const ORG3 = "test-org-fa2-" + crypto.randomUUID().slice(0, 8) as unknown as Parameters<typeof saveFinding>[0];
  Deno.env.set("DEFAULT_ORG_ID", String(ORG3));

  const findingId = "fid-fa-happy-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG3, {
    id: findingId,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Q1", populated: "P1", thinking: "T1", defense: "D1", answer: "Yes" },
      { header: "Q2", populated: "P2", thinking: "T2", defense: "D2", answer: "No" },
    ],
    record: { RecordId: "999" },
    recordingId: "27229612",
    recordingIdField: "VoGenie",
  });

  const { AuditController } = await import("./mod.ts");
  const controller = new AuditController();

  const result = await controller.fileAppeal({
    findingId,
    auditor: "test@x.com",
    appealedQuestions: [1],
  } as unknown as Parameters<typeof controller.fileAppeal>[0]);

  const r = result as Record<string, unknown>;
  assertEquals(r.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  assertEquals(r.queued, 1);
  assertEquals(r.judgeUrl, "/judge");
}});
