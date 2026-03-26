/**
 * Integration tests for manager/kv.ts — populateManagerQueue, getManagerQueue,
 * submitRemediation.
 */

import { assertEquals, assertExists } from "@std/assert";
import { setKvInstance, resetKvInstance } from "../../../../kv-factory.ts";
import { orgKey } from "../../../../lib/org.ts";
import { saveFinding } from "../../data/kv/mod.ts";
import { mockFetch, restoreFetch } from "../../../../test-utils/mod.ts";
import {
  populateManagerQueue,
  getManagerQueue,
  submitRemediation,
} from "./mod.ts";
import type { ManagerQueueItem, ManagerRemediation } from "./mod.ts";

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

const ORG = "test-org-manager";

/** Seed a review-decided entry (confirmed failure) directly in KV. */
async function seedReviewDecided(
  kv: Deno.Kv,
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip" = "confirm",
) {
  await kv.set(orgKey(ORG, "review-decided", findingId, questionIndex), {
    findingId,
    questionIndex,
    header: `Q${questionIndex}`,
    populated: "pop",
    thinking: "think",
    defense: "def",
    answer: "No",
    decision,
    reviewer: "reviewer-test",
    decidedAt: Date.now(),
  });
}

/** Seed a minimal finding using saveFinding (which uses ChunkedKv). */
async function seedFinding(findingId: string) {
  await saveFinding(ORG, {
    id: findingId,
    owner: "owner-test",
    recordingId: "rec-001",
    record: { RecordId: "rec-001" },
    job: { timestamp: "2024-01-01T00:00:00Z" },
    answeredQuestions: [
      { answer: "No", header: "Q0" },
      { answer: "Yes", header: "Q1" },
    ],
  });
}

// ---- Test 1: populateManagerQueue creates manager-queue entry from review-decided data ----

Deno.test(
  "populateManagerQueue: creates manager-queue entry when confirmed failures exist",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "mgr-finding-1";

      // Seed a finding so getFinding returns metadata
      await seedFinding(finding);

      // Seed a confirmed-failure review decision
      await seedReviewDecided(kv, finding, 0, "confirm");

      await populateManagerQueue(ORG, finding);

      // Verify the queue entry was written
      const entry = await kv.get<ManagerQueueItem>(orgKey(ORG, "manager-queue", finding));
      assertExists(entry.value, "manager-queue entry should exist");
      assertEquals(entry.value!.findingId, finding);
      assertEquals(entry.value!.status, "pending");
      assertEquals(entry.value!.failedCount, 1);
      assertEquals(entry.value!.owner, "owner-test");
    });
  },
);

// ---- Test 2: populateManagerQueue skips when no confirmed failures ----

Deno.test(
  "populateManagerQueue: does not create entry when all decisions are flips",
  async () => {
    await withKv(async (kv) => {
      const finding = "mgr-finding-no-confirm";
      await seedFinding(finding);

      // Only a flip — not a confirmed failure
      await seedReviewDecided(kv, finding, 0, "flip");

      await populateManagerQueue(ORG, finding);

      const entry = await kv.get(orgKey(ORG, "manager-queue", finding));
      assertEquals(entry.value, null, "should not create entry for zero confirmed failures");
    });
  },
);

// ---- Test 3: populateManagerQueue is idempotent ----

Deno.test(
  "populateManagerQueue: idempotent — second call does not overwrite",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withKv(async (kv) => {
      const finding = "mgr-finding-idempotent";
      await seedFinding(finding);
      await seedReviewDecided(kv, finding, 0, "confirm");

      await populateManagerQueue(ORG, finding);
      // Manually modify to detect a re-write
      await kv.set(orgKey(ORG, "manager-queue", finding), {
        findingId: finding,
        owner: "modified-owner",
        recordId: "",
        recordingId: "",
        totalQuestions: 0,
        failedCount: 99,
        completedAt: 0,
        jobTimestamp: "",
        status: "pending",
      });

      // Second call should NOT overwrite
      await populateManagerQueue(ORG, finding);

      const entry = await kv.get<ManagerQueueItem>(orgKey(ORG, "manager-queue", finding));
      assertEquals(entry.value!.failedCount, 99, "second call should not overwrite existing entry");
    });
  },
);

// ---- Test 4: getManagerQueue returns all queue items ----

Deno.test("getManagerQueue: returns all manager-queue items", async () => {
  await withKv(async (kv) => {
    const item1: ManagerQueueItem = {
      findingId: "mgr-q-1",
      owner: "owner-a",
      recordId: "r1",
      recordingId: "rec1",
      totalQuestions: 5,
      failedCount: 2,
      completedAt: Date.now(),
      jobTimestamp: "",
      status: "pending",
    };
    const item2: ManagerQueueItem = {
      findingId: "mgr-q-2",
      owner: "owner-b",
      recordId: "r2",
      recordingId: "rec2",
      totalQuestions: 3,
      failedCount: 1,
      completedAt: Date.now(),
      jobTimestamp: "",
      status: "addressed",
    };
    await kv.set(orgKey(ORG, "manager-queue", "mgr-q-1"), item1);
    await kv.set(orgKey(ORG, "manager-queue", "mgr-q-2"), item2);

    const items = await getManagerQueue(ORG);
    assertEquals(items.length, 2);

    const findingIds = items.map((i) => i.findingId).sort();
    assertEquals(findingIds, ["mgr-q-1", "mgr-q-2"]);
  });
});

// ---- Test 5: submitRemediation stores remediation and sets status to "addressed" ----

Deno.test(
  "submitRemediation: stores remediation record and updates queue item status",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // Mock fetch for the fireWebhook call (no webhook config set, so it won't fire,
    // but mock any outbound calls anyway to be safe)
    mockFetch(/.*/, () => new Response("{}", { status: 200 }));
    try {
      await withKv(async (kv) => {
        const finding = "mgr-finding-remediate";

        // Seed a queue item
        const queueItem: ManagerQueueItem = {
          findingId: finding,
          owner: "owner-test",
          recordId: "r1",
          recordingId: "rec1",
          totalQuestions: 2,
          failedCount: 1,
          completedAt: Date.now() - 1000,
          jobTimestamp: "",
          status: "pending",
        };
        await kv.set(orgKey(ORG, "manager-queue", finding), queueItem);

        // Also seed a finding so the webhook path doesn't error
        await seedFinding(finding);

        const res = await submitRemediation(ORG, finding, "Addressed by coaching session.", "manager-frank");

        assertEquals(res.success, true);

        // Remediation record should exist
        const remEntry = await kv.get<ManagerRemediation>(
          orgKey(ORG, "manager-remediation", finding),
        );
        assertExists(remEntry.value, "remediation entry should exist");
        assertEquals(remEntry.value!.notes, "Addressed by coaching session.");
        assertEquals(remEntry.value!.addressedBy, "manager-frank");

        // Queue item status should be "addressed"
        const qEntry = await kv.get<ManagerQueueItem>(orgKey(ORG, "manager-queue", finding));
        assertExists(qEntry.value);
        assertEquals(qEntry.value!.status, "addressed");
      });
    } finally {
      restoreFetch();
    }
  },
);
