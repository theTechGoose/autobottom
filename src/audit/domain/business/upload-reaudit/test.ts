import { assert } from "#assert";
Deno.test("upload-reaudit — startUploadReaudit export exists", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.startUploadReaudit === "function");
});

Deno.test({ name: "upload-reaudit — old finding links to the new one (reAuditedTo)", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  Deno.env.set("LOCAL_QUEUE", "true");
  const { saveFinding, getFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { startUploadReaudit } = await import("./mod.ts");
  const org = "test-org-ura-" + crypto.randomUUID().slice(0, 8) as unknown as Parameters<typeof saveFinding>[0];
  const findingId = "fid-upload-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(org, {
    id: findingId,
    auditJobId: "job-" + crypto.randomUUID().slice(0, 8),
    findingStatus: "finished",
    record: { RecordId: "512664" },
    recordingId: "27682973",
    recordingIdField: "VoGenie",
    owner: "test@x.com",
  });

  const result = await startUploadReaudit(org, findingId, {
    file: new Uint8Array([1, 2, 3]),
    agentEmail: "test@x.com",
  });

  const old = await getFinding(org, findingId) as Record<string, unknown>;
  assert(old.reAuditedAt);
  assert(old.reAuditedTo === result.newFindingId, `reAuditedTo=${old.reAuditedTo}`);
}});
