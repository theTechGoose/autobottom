/**
 * Characterization tests for populateReviewQueue in review/kv.ts.
 * These tests lock in the current behavior before any refactoring.
 */

import { assertEquals, assertExists } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../data/kv/factory.ts";
import { orgKey } from "../../../../lib/org.ts";
import type { ReviewItem, ReviewDecision } from "./mod.ts";
import {
  populateReviewQueue,
  claimNextItem,
  recordDecision,
  getReviewStats,
} from "./mod.ts";

// ---- helpers ----------------------------------------------------------

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

const ORG = "test-org";
const FINDING = "finding-abc";

function makeQuestion(answer: string, overrides?: Partial<{ header: string; populated: string; thinking: string; defense: string }>) {
  return {
    answer,
    header: overrides?.header ?? "Test header",
    populated: overrides?.populated ?? "Test populated",
    thinking: overrides?.thinking ?? "Test thinking",
    defense: overrides?.defense ?? "Test defense",
  };
}

// ---- Test 1: Populates review queue with "No" answers only ------------

Deno.test("populateReviewQueue: populates queue for all-No answers", async () => {
  await withKv(async (kv) => {
    const questions = [
      makeQuestion("No", { header: "Q0" }),
      makeQuestion("No", { header: "Q1" }),
    ];

    await populateReviewQueue(ORG, FINDING, questions);

    const item0 = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 0));
    const item1 = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 1));

    assertEquals(item0.value !== null, true);
    assertEquals(item1.value !== null, true);
    assertEquals(item0.value!.header, "Q0");
    assertEquals(item1.value!.header, "Q1");
  });
});

// ---- Test 2: Does nothing when all answers are "Yes" ------------------

Deno.test("populateReviewQueue: does nothing when all answers are Yes", async () => {
  await withKv(async (kv) => {
    const questions = [
      makeQuestion("Yes"),
      makeQuestion("Yes"),
      makeQuestion("Yes"),
    ];

    await populateReviewQueue(ORG, FINDING, questions);

    // No review-pending entries should exist
    const entries: unknown[] = [];
    for await (const entry of kv.list({ prefix: orgKey(ORG, "review-pending") })) {
      entries.push(entry);
    }
    assertEquals(entries.length, 0);

    // No review-audit-pending entry should exist
    const counter = await kv.get(orgKey(ORG, "review-audit-pending", FINDING));
    assertEquals(counter.value, null);
  });
});

// ---- Test 3: Preserves correct question index from original array position

Deno.test("populateReviewQueue: preserves original array index for each No answer", async () => {
  await withKv(async (kv) => {
    const questions = [
      makeQuestion("Yes"),   // index 0 — should be skipped
      makeQuestion("No"),    // index 1 — should be queued at index 1
      makeQuestion("Yes"),   // index 2 — should be skipped
      makeQuestion("No"),    // index 3 — should be queued at index 3
    ];

    await populateReviewQueue(ORG, FINDING, questions);

    // Index 0 and 2 should not exist
    const skip0 = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 0));
    const skip2 = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 2));
    assertEquals(skip0.value, null);
    assertEquals(skip2.value, null);

    // Index 1 and 3 should exist with correct questionIndex
    const item1 = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 1));
    const item3 = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 3));
    assertEquals(item1.value!.questionIndex, 1);
    assertEquals(item3.value!.questionIndex, 3);
  });
});

// ---- Test 4: Sets review-audit-pending count correctly ----------------

Deno.test("populateReviewQueue: sets review-audit-pending to count of No answers", async () => {
  await withKv(async (kv) => {
    const questions = [
      makeQuestion("No"),
      makeQuestion("Yes"),
      makeQuestion("No"),
      makeQuestion("No"),
      makeQuestion("Yes"),
    ];

    await populateReviewQueue(ORG, FINDING, questions);

    const counter = await kv.get<number>(orgKey(ORG, "review-audit-pending", FINDING));
    // 3 "No" answers in the array above
    assertEquals(counter.value, 3);
  });
});

// ---- Test 5: Creates correct ReviewItem shape in KV -------------------

Deno.test("populateReviewQueue: ReviewItem stored in KV has correct shape", async () => {
  await withKv(async (kv) => {
    const questions = [
      {
        answer: "No",
        header: "Did the agent verify identity?",
        populated: "The agent asked for name and date of birth.",
        thinking: "Step-by-step reasoning here.",
        defense: "Defense text here.",
      },
    ];

    await populateReviewQueue(ORG, FINDING, questions);

    const entry = await kv.get<ReviewItem>(orgKey(ORG, "review-pending", FINDING, 0));
    const item = entry.value!;

    assertEquals(item.findingId, FINDING);
    assertEquals(item.questionIndex, 0);
    assertEquals(item.header, "Did the agent verify identity?");
    assertEquals(item.populated, "The agent asked for name and date of birth.");
    assertEquals(item.thinking, "Step-by-step reasoning here.");
    assertEquals(item.defense, "Defense text here.");
    assertEquals(item.answer, "No");
  });
});

// ---- Test 6: Handles mixed Yes/No answers correctly -------------------

Deno.test("populateReviewQueue: only No items are queued in mixed array", async () => {
  await withKv(async (kv) => {
    const questions = [
      makeQuestion("Yes", { header: "Q-yes-0" }),
      makeQuestion("No",  { header: "Q-no-1" }),
      makeQuestion("Yes", { header: "Q-yes-2" }),
      makeQuestion("No",  { header: "Q-no-3" }),
      makeQuestion("Yes", { header: "Q-yes-4" }),
    ];

    await populateReviewQueue(ORG, FINDING, questions);

    // Collect all pending keys
    const pendingKeys: number[] = [];
    for await (const entry of kv.list<ReviewItem>({ prefix: orgKey(ORG, "review-pending") })) {
      pendingKeys.push(entry.value.questionIndex);
    }
    pendingKeys.sort((a, b) => a - b);

    // Only indices 1 and 3 should be in the queue
    assertEquals(pendingKeys, [1, 3]);

    // Counter should be 2
    const counter = await kv.get<number>(orgKey(ORG, "review-audit-pending", FINDING));
    assertEquals(counter.value, 2);
  });
});

// ===========================================================================
// Integration tests for claimNextItem, recordDecision, getReviewStats
// (merged from review/kv_int_test.ts)
// ===========================================================================

// -- env --

Deno.env.set("SELF_URL", "http://localhost:8000");
Deno.env.set("DENO_KV_URL", "http://localhost:4512");
Deno.env.set("KV_SERVICE_URL", "http://localhost:4512");
Deno.env.set("LOCAL_QUEUE", "true");
Deno.env.set("QSTASH_URL", "http://localhost:9999");
Deno.env.set("QSTASH_TOKEN", "test-token");
Deno.env.set("GROQ_API_KEY", "test-key");

const ORG_INT = "test-org-int";

function makeQuestionInt(answer: string, header = "Q") {
  return { answer, header, populated: "pop", thinking: "think", defense: "def" };
}

// ---- Test 1: claimNextItem returns correct item shape and creates a lock ----

Deno.test(
  "claimNextItem: returns item with correct shape and creates lock in KV",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "finding-claim-1";
      await populateReviewQueue(ORG_INT, finding, [
        makeQuestionInt("No", "Did the agent greet?"),
        makeQuestionInt("No", "Did the agent verify?"),
      ]);

      const result = await claimNextItem(ORG_INT, "reviewer-alice");

      // Claimed item is non-null
      assertExists(result.current);
      assertEquals(result.current!.findingId, finding);
      assertEquals(typeof result.current!.questionIndex, "number");
      assertEquals(result.current!.answer, "No");
      assertExists(result.current!.header);

      // A lock entry must exist for the claimed item
      const claimedIdx = result.current!.questionIndex;
      const lockEntry = await kv.get<{ claimedBy: string; claimedAt: number }>(
        orgKey(ORG_INT, "review-lock", finding, claimedIdx),
      );
      assertExists(lockEntry.value, "lock entry should exist in KV");
      assertEquals(lockEntry.value!.claimedBy, "reviewer-alice");
    });
  },
);

// ---- Test 2: claimNextItem remaining count is accurate after claim ----

Deno.test(
  "claimNextItem: remaining count excludes the claimed item",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (_kv) => {
      const finding = "finding-remaining";
      // Queue 3 No-answer items
      await populateReviewQueue(ORG_INT, finding, [
        makeQuestionInt("No"),
        makeQuestionInt("No"),
        makeQuestionInt("No"),
      ]);

      const result = await claimNextItem(ORG_INT, "reviewer-bob");

      // 3 queued, 1 claimed => remaining = 2
      assertEquals(result.remaining, 2);
    });
  },
);

// ---- Test 3: recordDecision stores decision in KV at review-decided key ----

Deno.test(
  "recordDecision: stores ReviewDecision at review-decided key in KV",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "finding-record-1";
      await populateReviewQueue(ORG_INT, finding, [makeQuestionInt("No", "Q0")]);

      // Claim so the lock is set
      const claimed = await claimNextItem(ORG_INT, "reviewer-carol");
      assertExists(claimed.current);
      const qi = claimed.current!.questionIndex;

      const res = await recordDecision(ORG_INT, finding, qi, "confirm", "reviewer-carol");

      assertEquals(res.success, true);

      // Verify review-decided entry exists with correct fields
      const decidedEntry = await kv.get<ReviewDecision>(
        orgKey(ORG_INT, "review-decided", finding, qi),
      );
      assertExists(decidedEntry.value, "review-decided entry should exist");
      assertEquals(decidedEntry.value!.decision, "confirm");
      assertEquals(decidedEntry.value!.reviewer, "reviewer-carol");
      assertEquals(decidedEntry.value!.findingId, finding);
      assertEquals(decidedEntry.value!.questionIndex, qi);

      // The pending entry should be deleted
      const pendingEntry = await kv.get(orgKey(ORG_INT, "review-pending", finding, qi));
      assertEquals(pendingEntry.value, null, "pending entry should be removed after decision");
    });
  },
);

// ---- Test 4: recordDecision rejects when lock is held by another reviewer ----

Deno.test(
  "recordDecision: rejects when lock is owned by a different reviewer",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (_kv) => {
      const finding = "finding-lock-reject";
      await populateReviewQueue(ORG_INT, finding, [makeQuestionInt("No")]);

      // Alice claims
      const claimed = await claimNextItem(ORG_INT, "reviewer-alice");
      assertExists(claimed.current);
      const qi = claimed.current!.questionIndex;

      // Bob tries to record a decision on the same item
      const res = await recordDecision(ORG_INT, finding, qi, "flip", "reviewer-bob");
      assertEquals(res.success, false);
    });
  },
);

// ---- Test 5: getReviewStats returns correct pending and decided counts ----

Deno.test(
  "getReviewStats: returns accurate pending and decided counts",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (_kv) => {
      const finding = "finding-stats";
      await populateReviewQueue(ORG_INT, finding, [
        makeQuestionInt("No"),
        makeQuestionInt("No"),
        makeQuestionInt("No"),
      ]);

      // Before any decisions: 3 pending, 0 decided
      const before = await getReviewStats(ORG_INT);
      assertEquals(before.pending, 3);
      assertEquals(before.decided, 0);

      // Claim and decide one item
      const claimed = await claimNextItem(ORG_INT, "reviewer-dave");
      assertExists(claimed.current);
      const qi = claimed.current!.questionIndex;
      await recordDecision(ORG_INT, finding, qi, "confirm", "reviewer-dave");

      // After one decision: 2 pending, 1 decided
      const after = await getReviewStats(ORG_INT);
      assertEquals(after.pending, 2);
      assertEquals(after.decided, 1);
    });
  },
);

// ---- Test 6: auditComplete fires when last decision is recorded ----

Deno.test(
  "recordDecision: auditComplete is true when all items decided",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (_kv) => {
      const finding = "finding-audit-complete";
      await populateReviewQueue(ORG_INT, finding, [makeQuestionInt("No")]);

      const claimed = await claimNextItem(ORG_INT, "reviewer-eve");
      assertExists(claimed.current);
      const qi = claimed.current!.questionIndex;

      const res = await recordDecision(ORG_INT, finding, qi, "flip", "reviewer-eve");
      assertEquals(res.success, true);
      assertEquals(res.auditComplete, true);
    });
  },
);
