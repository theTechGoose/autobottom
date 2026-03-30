/**
 * E2E tests for agent coordinator — getAgentDashboardData.
 *
 * getAgentDashboardData reads finished findings from KV for a given agent
 * email and computes dashboard stats (totalAudits, avgScore, recentAudits,
 * weeklyTrend).
 */

import { assertEquals } from "@std/assert";
import { Kv } from "../../data/kv/mod.ts";
import { KvTestHelpers } from "../../data/kv/test-helpers.ts";
import { getAgentDashboardData } from "./mod.ts";

// -- helpers -----------------------------------------------------------------

async function withKv<T>(fn: (kv: Kv) => Promise<T>): Promise<T> {
  const kv = await KvTestHelpers.fresh();
  Kv.setInstance(kv);
  try {
    return await fn(kv);
  } finally {
    Kv.resetInstance();
    kv.db.close();
  }
}

const ORG = "test-org-agent";

function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding-1",
    findingStatus: "finished",
    owner: "agent@example.com",
    recordingId: "rec-001",
    record: { RecordId: "rec-001" },
    job: { timestamp: "2024-01-01T00:00:00Z" },
    answeredQuestions: [],
    completedAt: Date.now(),
    ...overrides,
  };
}

// -- Test 1: Returns correct dashboard for agent with finished findings ------

Deno.test({
  name: "getAgentDashboardData: returns correct stats for agent with finished audits",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      // Seed two finished findings for our agent
      await kv.saveFinding(ORG, makeFinding({
        id: "finding-dash-1",
        answeredQuestions: [
          { answer: "Yes" },
          { answer: "Yes" },
          { answer: "No" },
        ],
        completedAt: Date.now() - 1000,
      }));
      await kv.saveFinding(ORG, makeFinding({
        id: "finding-dash-2",
        answeredQuestions: [
          { answer: "Yes" },
          { answer: "Yes" },
          { answer: "Yes" },
          { answer: "Yes" },
        ],
        completedAt: Date.now() - 2000,
      }));

      const data = await getAgentDashboardData(ORG, "agent@example.com");

      assertEquals(data.email, "agent@example.com");
      assertEquals(data.totalAudits, 2);
      // 6 Yes out of 7 total = 85.71%
      assertEquals(data.avgScore, 85.71);
      assertEquals(data.recentAudits.length, 2);
      // weeklyTrend always has 8 entries (last 8 weeks)
      assertEquals(data.weeklyTrend.length, 8);
    });
  },
});

// -- Test 2: Returns empty dashboard when agent has no findings --------------

Deno.test({
  name: "getAgentDashboardData: returns zero stats for agent with no audits",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async () => {
      const data = await getAgentDashboardData(ORG, "nobody@example.com");

      assertEquals(data.email, "nobody@example.com");
      assertEquals(data.totalAudits, 0);
      assertEquals(data.avgScore, 0);
      assertEquals(data.recentAudits.length, 0);
      assertEquals(data.weeklyTrend.length, 8);
    });
  },
});

// -- Test 3: Filters out findings not owned by the requested agent -----------

Deno.test({
  name: "getAgentDashboardData: only includes findings owned by the requested agent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      // Finding owned by a different agent
      await kv.saveFinding(ORG, makeFinding({
        id: "finding-other-agent",
        owner: "other-agent@example.com",
        answeredQuestions: [{ answer: "No" }, { answer: "No" }],
        completedAt: Date.now(),
      }));

      // Finding owned by our agent
      await kv.saveFinding(ORG, makeFinding({
        id: "finding-our-agent",
        owner: "agent@example.com",
        answeredQuestions: [{ answer: "Yes" }],
        completedAt: Date.now(),
      }));

      const data = await getAgentDashboardData(ORG, "agent@example.com");

      assertEquals(data.totalAudits, 1);
      assertEquals(data.avgScore, 100);
      assertEquals(data.recentAudits.length, 1);
      assertEquals(data.recentAudits[0].findingId, "finding-our-agent");
    });
  },
});

// -- Test 4: Filters out non-finished findings -------------------------------

Deno.test({
  name: "getAgentDashboardData: excludes non-finished findings",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withKv(async (kv) => {
      // In-progress finding
      await kv.saveFinding(ORG, makeFinding({
        id: "finding-in-progress",
        findingStatus: "asking-questions",
        answeredQuestions: [{ answer: "Yes" }],
        completedAt: Date.now(),
      }));

      // Finished finding
      await kv.saveFinding(ORG, makeFinding({
        id: "finding-done",
        findingStatus: "finished",
        answeredQuestions: [{ answer: "No" }, { answer: "No" }],
        completedAt: Date.now(),
      }));

      const data = await getAgentDashboardData(ORG, "agent@example.com");

      assertEquals(data.totalAudits, 1);
      assertEquals(data.avgScore, 0);
      assertEquals(data.recentAudits[0].findingId, "finding-done");
    });
  },
});
