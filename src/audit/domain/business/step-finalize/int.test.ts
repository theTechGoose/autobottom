/** stepFinalize's pre-review "perfect score" email fires only on a real 100%.
 *
 *  The terminate webhook's email handler is swapped for a recorder, so the
 *  test sees exactly what finalize would have mailed. */

import { assertEquals } from "#assert";
import { stepFinalize } from "./mod.ts";
import { resetFirestoreCredentials } from "@core/data/firestore/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { registerWebhookEmailHandler } from "@admin/domain/data/admin-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

const kvOpts = { sanitizeResources: false, sanitizeOps: false };

async function finalizeWith(answers: string[]): Promise<Record<string, unknown>[]> {
  resetFirestoreCredentials();
  const tag = crypto.randomUUID().slice(0, 8);
  const orgId = ("test-final-" + tag) as unknown as OrgId;
  const findingId = "fid-final-" + tag;
  await saveFinding(orgId, {
    id: findingId,
    findingStatus: "asking",
    record: { RecordId: 1 },
    feedback: { heading: "h", text: "already set", viewUrl: "", disputeUrl: "", recordingUrl: "" },
    answeredQuestions: answers.map((answer, i) => ({ header: `Q${i}`, populated: `Q${i}?`, answer, thinking: "t", defense: "d" })),
  });
  const fired: Record<string, unknown>[] = [];
  registerWebhookEmailHandler("terminate", async (o, payload) => {
    if (o === orgId) fired.push(payload as Record<string, unknown>);
  });
  const res = await stepFinalize(new Request("https://test.local/audit/step/finalize", {
    method: "POST",
    body: JSON.stringify({ findingId, orgId }),
    headers: { "content-type": "application/json" },
  }));
  assertEquals(res.status, 200);
  return fired;
}

Deno.test({
  name: "REQ-013: an audit with an Error answer and no No answers sends no perfect-score email",
  ...kvOpts,
  fn: async () => {
    // rrJvbO40W1Vk49iGFt7XC: 24 Yes + 1 Error ("Matching IDs") mailed "100%".
    const fired = await finalizeWith([...Array(24).fill("Yes"), "Error"]);
    assertEquals(fired.length, 0, "96% is not a perfect score — it waits for review");
  },
});

Deno.test({
  name: "REQ-013: an all-Yes audit still sends the perfect-score email at 100",
  ...kvOpts,
  fn: async () => {
    const fired = await finalizeWith(["Yes", "Yes", "Yes"]);
    assertEquals(fired.length, 1);
    assertEquals(fired[0].score, 100);
    assertEquals(fired[0].reason, "perfect_score");
  },
});
