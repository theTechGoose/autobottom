/** Agent dashboard KV operations: fetch audit results for a specific agent. */

import { Kv } from "../../data/kv/mod.ts";
import type { OrgId } from "../../data/kv/mod.ts";

// -- Types --

export interface AgentDashboardData {
  email: string;
  totalAudits: number;
  avgScore: number;
  recentAudits: Array<{
    findingId: string;
    recordId: string;
    recordingId: string;
    totalQuestions: number;
    passedCount: number;
    failedCount: number;
    completedAt: string;
    jobTimestamp: string;
  }>;
  weeklyTrend: Array<{
    weekStart: string;
    audits: number;
    avgScore: number;
  }>;
}

// -- Dashboard Data --

export async function getAgentDashboardData(orgId: OrgId, agentEmail: string): Promise<AgentDashboardData> {
  const kv = await Kv.getInstance();
  const db = kv.db;

  // Collect unique finding IDs from chunked KV keys
  const findingIds = new Set<string>();
  const iter = db.list({ prefix: Kv.orgKey(orgId, "audit-finding") });
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKey;
    if (key.length >= 3 && typeof key[2] === "string") {
      findingIds.add(key[2] as string);
    }
  }

  // Load findings owned by this agent
  const audits: Array<{
    findingId: string;
    recordId: string;
    recordingId: string;
    totalQuestions: number;
    passedCount: number;
    failedCount: number;
    completedAt: number;
    jobTimestamp: string;
  }> = [];

  let totalYes = 0;
  let totalQuestions = 0;

  for (const findingId of findingIds) {
    const finding = await kv.getFinding(orgId, findingId);
    if (!finding) continue;
    if (finding.findingStatus !== "finished") continue;
    if (finding.owner !== agentEmail) continue;

    const questions: Array<{ answer: string }> = finding.answeredQuestions ?? [];
    const passed = questions.filter((q) => q.answer === "Yes").length;
    const failed = questions.filter((q) => q.answer === "No").length;
    const total = questions.length;

    totalYes += passed;
    totalQuestions += total;

    // Use stats-completed timestamp or fall back to Date.now()
    const completedTs = finding.completedAt ?? Date.now();

    audits.push({
      findingId,
      recordId: finding.record?.RecordId ?? "",
      recordingId: finding.recordingId ?? "",
      totalQuestions: total,
      passedCount: passed,
      failedCount: failed,
      completedAt: completedTs,
      jobTimestamp: finding.job?.timestamp ?? "",
    });
  }

  // Sort by completedAt descending, limit to 50
  audits.sort((a, b) => b.completedAt - a.completedAt);
  const recentAudits = audits.slice(0, 50).map((a) => ({
    ...a,
    completedAt: new Date(a.completedAt).toISOString(),
  }));

  const avgScore = totalQuestions > 0 ? Math.round((totalYes / totalQuestions) * 10000) / 100 : 0;

  // Weekly trend: last 8 weeks
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weeklyTrend: AgentDashboardData["weeklyTrend"] = [];

  for (let w = 7; w >= 0; w--) {
    const weekStart = now - (w + 1) * WEEK_MS;
    const weekEnd = now - w * WEEK_MS;

    const weekAudits = audits.filter((a) => a.completedAt >= weekStart && a.completedAt < weekEnd);
    const weekYes = weekAudits.reduce((sum, a) => sum + a.passedCount, 0);
    const weekTotal = weekAudits.reduce((sum, a) => sum + a.totalQuestions, 0);
    const weekAvg = weekTotal > 0 ? Math.round((weekYes / weekTotal) * 10000) / 100 : 0;

    weeklyTrend.push({
      weekStart: new Date(weekStart).toISOString().split("T")[0],
      audits: weekAudits.length,
      avgScore: weekAvg,
    });
  }

  return {
    email: agentEmail,
    totalAudits: audits.length,
    avgScore,
    recentAudits,
    weeklyTrend,
  };
}
