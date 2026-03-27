/**
 * Integration tests for judge/kv.ts — populateJudgeQueue, claimNextItem,
 * recordDecision, saveAppeal / getAppeal.
 */

import { assertEquals, assertExists } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../../../kv-factory.ts";
import { orgKey } from "../../data/kv/org.ts";
import {
  populateJudgeQueue,
  claimNextItem,
  recordDecision,
  saveAppeal,
  getAppeal,
} from "./mod.ts";
import type { JudgeItem, JudgeDecision, AppealRecord } from "./mod.ts";

// -- env --

Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("QSTASH_URL", "http://localhost:9999");
Deno.env.set("QSTASH_TOKEN", "test-token");
Deno.env.set("GROQ_API_KEY", "test-key");

// -- helpers --

async function withKv<T>(fn: (kv: Deno.Kv) => Promise<T>): Promise<T> {
  const kv = await Deno.openKv(":memory:");
  setKvInstance(kv);
  try {
    return await fn(kv);
  } finally {
    resetKvInstance();
    kv.close();
  }
}

const ORG = "test-org-judge";

function makeQuestion(answer: string, header = "H") {
  return { answer, header, populated: "pop", thinking: "think", defense: "def" };
}

// ---- Test 1: populateJudgeQueue stores ALL questions in KV ----

Deno.test("populateJudgeQueue: stores all questions including Yes answers", async () => {
  await withKv(async (kv) => {
    const finding = "judge-finding-1";
    await populateJudgeQueue(ORG, finding, [
      makeQuestion("Yes", "Q0"),
      makeQuestion("No", "Q1"),
      makeQuestion("Yes", "Q2"),
    ]);

    // All 3 should be in judge-pending (unlike review which only stores No)
    const items: JudgeItem[] = [];
    for await (const entry of kv.list<JudgeItem>({ prefix: orgKey(ORG, "judge-pending", finding) })) {
      items.push(entry.value);
    }
    assertEquals(items.length, 3, "all 3 questions should be queued");

    // Counter should be 3
    const counter = await kv.get<number>(orgKey(ORG, "judge-audit-pending", finding));
    assertEquals(counter.value, 3);
  });
});

// ---- Test 2: populateJudgeQueue stores correct JudgeItem shape ----

Deno.test("populateJudgeQueue: stored item has correct shape", async () => {
  await withKv(async (kv) => {
    const finding = "judge-finding-shape";
    await populateJudgeQueue(ORG, finding, [
      { answer: "No", header: "Did the agent comply?", populated: "pop", thinking: "think", defense: "def" },
    ]);

    const entry = await kv.get<JudgeItem>(orgKey(ORG, "judge-pending", finding, 0));
    assertExists(entry.value);
    assertEquals(entry.value!.findingId, finding);
    assertEquals(entry.value!.questionIndex, 0);
    assertEquals(entry.value!.header, "Did the agent comply?");
    assertEquals(entry.value!.answer, "No");
  });
});

// ---- Test 3: claimNextItem returns item and creates judge-lock ----

Deno.test(
  "claimNextItem: returns item and creates lock in KV",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "judge-finding-claim";
      await populateJudgeQueue(ORG, finding, [
        makeQuestion("Yes", "Q0"),
        makeQuestion("No", "Q1"),
      ]);

      const result = await claimNextItem(ORG, "judge-alice");

      assertExists(result.current);
      assertEquals(result.current!.findingId, finding);
      assertEquals(typeof result.current!.questionIndex, "number");

      // Lock entry must exist
      const qi = result.current!.questionIndex;
      const lockEntry = await kv.get<{ claimedBy: string }>(
        orgKey(ORG, "judge-lock", finding, qi),
      );
      assertExists(lockEntry.value);
      assertEquals(lockEntry.value!.claimedBy, "judge-alice");
    });
  },
);

// ---- Test 4: recordDecision (uphold) stores judge-decided entry ----

Deno.test(
  "recordDecision: uphold stores JudgeDecision at judge-decided key",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "judge-finding-uphold";
      await populateJudgeQueue(ORG, finding, [makeQuestion("Yes", "Q0")]);

      const claimed = await claimNextItem(ORG, "judge-bob");
      assertExists(claimed.current);
      const qi = claimed.current!.questionIndex;

      const res = await recordDecision(ORG, finding, qi, "uphold", "judge-bob");
      assertEquals(res.success, true);

      const decidedEntry = await kv.get<JudgeDecision>(
        orgKey(ORG, "judge-decided", finding, qi),
      );
      assertExists(decidedEntry.value);
      assertEquals(decidedEntry.value!.decision, "uphold");
      assertEquals(decidedEntry.value!.judge, "judge-bob");
      assertEquals(decidedEntry.value!.findingId, finding);

      // pending entry should be gone
      const pendingEntry = await kv.get(orgKey(ORG, "judge-pending", finding, qi));
      assertEquals(pendingEntry.value, null);
    });
  },
);

// ---- Test 5: recordDecision (overturn) stores correct decision value ----

Deno.test(
  "recordDecision: overturn stores decision=overturn at judge-decided key",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "judge-finding-overturn";
      await populateJudgeQueue(ORG, finding, [makeQuestion("No", "Q0")]);

      const claimed = await claimNextItem(ORG, "judge-carol");
      assertExists(claimed.current);
      const qi = claimed.current!.questionIndex;

      const res = await recordDecision(ORG, finding, qi, "overturn", "judge-carol", "logic");
      assertEquals(res.success, true);

      const decidedEntry = await kv.get<JudgeDecision>(
        orgKey(ORG, "judge-decided", finding, qi),
      );
      assertExists(decidedEntry.value);
      assertEquals(decidedEntry.value!.decision, "overturn");
      assertEquals(decidedEntry.value!.reason, "logic");
    });
  },
);

// ---- Test 6: saveAppeal / getAppeal round-trip ----

Deno.test("saveAppeal / getAppeal: round-trip stores and retrieves appeal record", async () => {
  await withKv(async (_kv) => {
    const finding = "judge-finding-appeal";
    const record: AppealRecord = {
      findingId: finding,
      appealedAt: 1700000000000,
      status: "pending",
      auditor: "auditor-dan",
      comment: "I disagree with this finding.",
    };

    await saveAppeal(ORG, record);

    const retrieved = await getAppeal(ORG, finding);
    assertExists(retrieved);
    assertEquals(retrieved!.findingId, finding);
    assertEquals(retrieved!.status, "pending");
    assertEquals(retrieved!.auditor, "auditor-dan");
    assertEquals(retrieved!.comment, "I disagree with this finding.");
  });
});
