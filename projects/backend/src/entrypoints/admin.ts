/** HTTP handlers for admin API routes. */

import { requireAdminAuth, json } from "./helpers.ts";
import { getTokenUsage } from "../domain/data/groq/mod.ts";
import {
  getStats, getPipelineConfig, setPipelineConfig,
  saveFinding, saveTranscript, saveBatchAnswers,
  getWebhookConfig, saveWebhookConfig,
  listEmailReportConfigs, saveEmailReportConfig, deleteEmailReportConfig,
  getAllAnswersForFinding,
  getGamificationSettings, saveGamificationSettings,
  listCustomStoreItems, saveCustomStoreItem, deleteCustomStoreItem,
  getGameState, saveGameState,
} from "../domain/data/kv/mod.ts";
import type { WebhookConfig, WebhookKind, GamificationSettings } from "../domain/data/kv/mod.ts";
import { orgKey } from "../domain/data/kv/org.ts";
import type { OrgId } from "../domain/data/kv/org.ts";
import { kvFactory } from "../domain/data/kv/factory.ts";
import { env } from "../env.ts";
import { getReviewStats, populateReviewQueue } from "../domain/coordinators/review/mod.ts";
import { getAppealStats, populateJudgeQueue, saveAppeal, recordDecision as recordJudgeDecision } from "../domain/coordinators/judge/mod.ts";
import {
  createOrg, createUser, deleteUser, getUser, listUsers,
  createSession, sessionCookie,
} from "../domain/coordinators/auth/mod.ts";
import { STORE_CATALOG, rarityFromPrice } from "../domain/business/gamification/badges/mod.ts";
import type { StoreItem } from "../domain/business/gamification/badges/mod.ts";
import { trackCompleted } from "../domain/data/kv/mod.ts";

// -- Dashboard --

export async function handleDashboardData(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const [pipelineStats, tokens, review, appeals] = await Promise.all([
    getStats(auth.orgId),
    getTokenUsage(1),
    getReviewStats(auth.orgId),
    getAppealStats(auth.orgId),
  ]);

  return json({
    pipeline: {
      inPipe: pipelineStats.active.length,
      active: pipelineStats.active,
      completed24h: pipelineStats.completedCount,
      completedTs: pipelineStats.completed.map((c: any) => c.ts),
      errors24h: pipelineStats.errors.length,
      errors: pipelineStats.errors,
      errorsTs: pipelineStats.errors.map((e: any) => e.ts),
      retries24h: pipelineStats.retries.length,
      retriesTs: pipelineStats.retries.map((r: any) => r.ts),
    },
    review,
    tokens,
    appeals,
  });
}

export async function handleAdminMe(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role });
}

// -- Badge Editor --

export async function handleBadgeEditorItems(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const custom = await listCustomStoreItems(auth.orgId);
  return json({ builtIn: STORE_CATALOG, custom });
}

export async function handleBadgeEditorSave(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { id, name, type, price, icon, description, preview } = body;
  if (!id || !name || !type || price == null || !icon) {
    return json({ error: "id, name, type, price, and icon are required" }, 400);
  }

  // Block overwriting built-in IDs
  if (STORE_CATALOG.some((i) => i.id === id)) {
    return json({ error: "cannot overwrite a built-in item" }, 400);
  }

  const item: StoreItem = {
    id,
    name,
    type,
    price: Number(price),
    icon,
    description: description || "",
    rarity: rarityFromPrice(Number(price)),
    preview: preview || undefined,
  };

  await saveCustomStoreItem(auth.orgId, item);
  return json({ ok: true, item });
}

export async function handleBadgeEditorDelete(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { id } = body;
  if (!id) return json({ error: "id required" }, 400);

  // Block deleting built-in IDs
  if (STORE_CATALOG.some((i) => i.id === id)) {
    return json({ error: "cannot delete a built-in item" }, 400);
  }

  await deleteCustomStoreItem(auth.orgId, id);
  return json({ ok: true });
}

// -- Settings --

export function extractSettingsKind(req: Request): WebhookKind | null {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const kind = parts[3];
  const kindMap: Record<string, WebhookKind> = {
    terminate: "terminate", review: "terminate",
    appeal: "appeal", judge: "appeal",
    manager: "manager",
    "judge-finish": "judge",
  };
  return kindMap[kind] ?? null;
}

export async function handleAdminGetSettings(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const kind = extractSettingsKind(req);
  if (!kind) return json({ error: "kind must be terminate, appeal, or manager" }, 400);
  const config = await getWebhookConfig(auth.orgId, kind);
  return json(config ?? { postUrl: "", postHeaders: {} });
}

export async function handleAdminSaveSettings(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const kind = extractSettingsKind(req);
  if (!kind) return json({ error: "kind must be terminate, appeal, or manager" }, 400);
  const body = await req.json();
  const config: WebhookConfig = {
    postUrl: body.postUrl ?? "",
    postHeaders: body.postHeaders ?? {},
  };
  await saveWebhookConfig(auth.orgId, kind, config);
  return json({ ok: true });
}

// -- Users --

export async function handleAdminListUsers(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const users = await listUsers(auth.orgId);
  return json(users);
}

export async function handleAdminAddUser(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { email, password, role, supervisor } = body;
  if (!email || !password) return json({ error: "email and password required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "email must be a valid email address" }, 400);

  const validRoles = ["admin", "judge", "manager", "reviewer", "user"];
  const userRole = validRoles.includes(role) ? role : "reviewer";

  if ((userRole === "judge" || userRole === "manager") && supervisor) {
    const sup = await getUser(auth.orgId, supervisor);
    if (!sup || sup.role !== "admin") return json({ error: "judges and managers must be assigned to an admin" }, 400);
  } else if ((userRole === "reviewer" || userRole === "user") && supervisor) {
    const sup = await getUser(auth.orgId, supervisor);
    if (!sup || (sup.role !== "judge" && sup.role !== "manager")) return json({ error: "reviewers must be assigned to a judge or manager" }, 400);
  }

  await createUser(auth.orgId, email, password, userRole as any, supervisor || undefined);
  return json({ ok: true, email, role: userRole, supervisor: supervisor || null });
}

// -- Pipeline Config --

export async function handleGetPipelineConfig(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  return json(await getPipelineConfig(auth.orgId));
}

export async function handleSetPipelineConfig(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const update: Record<string, number> = {};
  if (typeof body.maxRetries === "number") update.maxRetries = body.maxRetries;
  if (typeof body.retryDelaySeconds === "number") update.retryDelaySeconds = body.retryDelaySeconds;
  if (Object.keys(update).length === 0) {
    return json({ error: "provide maxRetries and/or retryDelaySeconds" }, 400);
  }
  const result = await setPipelineConfig(auth.orgId, update);
  return json(result);
}

// -- Admin Gamification --

export async function handleAdminGetGamification(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const settings = await getGamificationSettings(auth.orgId);
  return json(settings ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null });
}

export async function handleAdminSaveGamification(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json() as GamificationSettings;
  await saveGamificationSettings(auth.orgId, body);
  return json({ ok: true });
}

// -- Queues + Parallelism --

const QUEUE_NAME = "audit-pipeline";

export async function handleGetQueues(_req: Request): Promise<Response> {
  const res = await fetch(`${env.qstashUrl}/v2/queues`, {
    headers: { Authorization: `Bearer ${env.qstashToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  return json(await res.json());
}

export async function handleSetQueue(req: Request): Promise<Response> {
  const body = await req.json();
  const { queueName, parallelism } = body;
  if (!queueName || parallelism == null) {
    return json({ error: "queueName and parallelism required" }, 400);
  }

  const res = await fetch(`${env.qstashUrl}/v2/queues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queueName, parallelism }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  return json(await res.json());
}

export async function handleGetParallelism(_req: Request): Promise<Response> {
  const res = await fetch(`${env.qstashUrl}/v2/queues/${QUEUE_NAME}`, {
    headers: { Authorization: `Bearer ${env.qstashToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  const data = await res.json();
  return json({ parallelism: data.parallelism ?? null });
}

export async function handleSetParallelism(req: Request): Promise<Response> {
  const body = await req.json();
  const { parallelism } = body;
  if (parallelism == null || typeof parallelism !== "number" || parallelism < 1) {
    return json({ error: "parallelism must be a number >= 1" }, 400);
  }
  const res = await fetch(`${env.qstashUrl}/v2/queues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queueName: QUEUE_NAME, parallelism }),
  });
  if (!res.ok) {
    const text = await res.text();
    return json({ error: `QStash error: ${res.status} ${text}` }, res.status);
  }
  return json({ ok: true, parallelism });
}

// -- Email Reports --

export async function handleListEmailReports(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const configs = await listEmailReportConfigs(auth.orgId);
  return json(configs);
}

export async function handleSaveEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  if (!body.name || !body.recipients || !body.sections) {
    return json({ error: "name, recipients, and sections required" }, 400);
  }
  const saved = await saveEmailReportConfig(auth.orgId, body);
  return json(saved);
}

export async function handleDeleteEmailReport(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  if (!body.id) return json({ error: "id required" }, 400);
  await deleteEmailReportConfig(auth.orgId, body.id);
  return json({ ok: true });
}

// -- Token Usage --

export async function handleTokenUsage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? "1");
  const usage = await getTokenUsage(hours);
  return json(usage);
}

// -- Force Nos (testing) --

export async function handleForceNos(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const findingId = url.searchParams.get("id");
  if (!findingId) return json({ error: "id required" }, 400);

  const { getFinding: getF } = await import("../domain/data/kv/mod.ts");
  const finding = await getF(auth.orgId, findingId);
  if (!finding) return json({ error: "finding not found" }, 404);
  if (!finding.answeredQuestions?.length) return json({ error: "no answered questions yet" }, 400);

  let flipped = 0;
  for (const q of finding.answeredQuestions) {
    if (q.answer === "Yes") {
      q.answer = "No";
      q.thinking = "[FORCED NO FOR TESTING] " + (q.thinking || "");
      flipped++;
    }
  }
  await saveFinding(auth.orgId, finding);
  await populateReviewQueue(auth.orgId, findingId, finding.answeredQuestions);

  return json({ ok: true, flipped, totalNos: finding.answeredQuestions.filter((q: any) => q.answer === "No").length });
}

// -- Seed --

async function loadSeedData(): Promise<any[]> {
  const seedPath = new URL("../../assets/seed-data.json", import.meta.url);
  const raw = await Deno.readTextFile(seedPath);
  return JSON.parse(raw);
}

export async function handleSeedDryRun(_req: Request): Promise<Response> {
  const findings = await loadSeedData();
  const summary = findings.map((f: any) => ({
    id: f.id,
    recordingId: f.recordingId,
    answerCount: f.answeredQuestions?.length ?? 0,
    noCount: (f.answeredQuestions ?? []).filter((q: any) => q.answer === "No").length,
  }));
  return json({ dryRun: true, count: findings.length, findings: summary });
}

export async function seedOrgData(orgId: OrgId): Promise<{ seeded: number; managerSeeded: number; judgeSeeded: number; qlabSeeded: number; orgId: OrgId }> {
  const findings = await loadSeedData();
  const db = await kvFactory();

  // Create admin user (ignore if already exists)
  try { await createUser(orgId, "admin@autobot.dev", "admin", "admin"); } catch { /* exists */ }

  // Seed test team (password: 0000) with proper supervisor hierarchy:
  //   admin@monsterrg.com (admin)
  //     |- judge@monsterrg.com (judge)       supervised by admin
  //     |- manager@monsterrg.com (manager)   supervised by admin
  //     |- reviewer@monsterrg.com (reviewer)  supervised by judge
  //     |- reviewer2@monsterrg.com (reviewer) supervised by judge
  //     +-- agent@monsterrg.com (user)         supervised by manager
  const testUsers: Array<[string, string, string | undefined]> = [
    ["admin@monsterrg.com", "admin", undefined],
    ["judge@monsterrg.com", "judge", "admin@monsterrg.com"],
    ["manager@monsterrg.com", "manager", "admin@monsterrg.com"],
    ["reviewer@monsterrg.com", "reviewer", "judge@monsterrg.com"],
    ["reviewer2@monsterrg.com", "reviewer", "judge@monsterrg.com"],
    ["agent@monsterrg.com", "user", "manager@monsterrg.com"],
  ];
  // Super-admin user (password: dooks) - gates /super-admin access
  const saStale = await db.get(["email-index", "ai@monsterrg.com"]);
  if (saStale.value) {
    const saOrgId = (saStale.value as any).orgId;
    await db.delete([saOrgId, "user", "ai@monsterrg.com"]);
    await db.delete(["email-index", "ai@monsterrg.com"]);
  }
  await createUser(orgId, "ai@monsterrg.com", "dooks", "admin");
  console.log("[SEED] Created ai@monsterrg.com (super-admin)");

  for (const [email, role, supervisor] of testUsers) {
    const staleIndex = await db.get(["email-index", email]);
    if (staleIndex.value) {
      const staleOrgId = (staleIndex.value as any).orgId;
      await db.delete([staleOrgId, "user", email]);
      await db.delete(["email-index", email]);
    }
    await createUser(orgId, email, "0000", role as any, supervisor);
    console.log(`[SEED] Created ${email} (${role}${supervisor ? `, reports to ${supervisor}` : ""})`);
  }

  // Clean up legacy orphan users from previous seed format
  const teamEmails = new Set(testUsers.map(([e]) => e));
  teamEmails.add("admin@autobot.dev");
  const allUsers = await listUsers(orgId);
  for (const u of allUsers) {
    if (!teamEmails.has(u.email)) {
      await deleteUser(orgId, u.email);
      console.log(`[SEED] Removed orphan user: ${u.email}`);
    }
  }

  const { populateManagerQueue, submitRemediation } = await import("../domain/coordinators/manager/mod.ts");
  let seeded = 0;

  for (const finding of findings) {
    finding.recordingPath = "test-recordings/demo-recording.mp3";

    await saveFinding(orgId, finding);

    if (finding.rawTranscript) {
      await saveTranscript(orgId, finding.id, finding.rawTranscript, finding.diarizedTranscript);
    }

    if (finding.answeredQuestions?.length) {
      await saveBatchAnswers(orgId, finding.id, 0, finding.answeredQuestions);
    }

    if (finding.answeredQuestions?.length) {
      await populateReviewQueue(orgId, finding.id, finding.answeredQuestions);
    }

    await trackCompleted(orgId, finding.id);

    seeded++;
    console.log(`[SEED] ${seeded}/${findings.length} -- ${finding.id}`);
  }

  // -- Manager seed --
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const reviewers = ["reviewer@monsterrg.com", "reviewer2@monsterrg.com"];
  let managerSeeded = 0;

  for (let i = 0; i < Math.min(12, findings.length); i++) {
    const finding = findings[i];
    const noQuestions = (finding.answeredQuestions ?? [])
      .map((q: any, idx: number) => ({ ...q, idx }))
      .filter((q: any) => q.answer === "No");

    if (noQuestions.length === 0) continue;

    // Clear review-pending entries (simulate reviewer completing them)
    for (const q of noQuestions) {
      await db.delete(orgKey(orgId, "review-pending", finding.id, q.idx));
    }
    await db.delete(orgKey(orgId, "review-audit-pending", finding.id));

    // Write review-decided entries
    const reviewer = reviewers[i % reviewers.length];
    const completedAt = now - Math.floor(Math.random() * 8 * WEEK_MS);
    for (const q of noQuestions) {
      const decision = Math.random() < 0.75 ? "confirm" : "flip";
      await db.set(orgKey(orgId, "review-decided", finding.id, q.idx), {
        findingId: finding.id,
        questionIndex: q.idx,
        header: q.header ?? "",
        populated: q.populated ?? "",
        thinking: q.thinking ?? "",
        defense: q.defense ?? "",
        answer: q.answer,
        decision,
        reviewer,
        decidedAt: completedAt,
      });
    }

    await populateManagerQueue(orgId, finding.id);

    // Override completedAt to spread across weeks for trend data
    const queueEntry = await db.get(orgKey(orgId, "manager-queue", finding.id));
    if (queueEntry.value) {
      const updated = { ...(queueEntry.value as Record<string, any>), completedAt };
      await db.set(orgKey(orgId, "manager-queue", finding.id), updated);
    }

    // Remediate ~half
    if (i < 6) {
      const remediatedAt = completedAt + Math.floor(Math.random() * 3 * DAY_MS);
      await submitRemediation(
        orgId,
        finding.id,
        [
          "Spoke with agent about proper greeting protocol. Agent acknowledged the gap and will follow the script going forward.",
          "Coached agent on verification steps. Reviewed call together and identified where they skipped the ID check. Written warning issued.",
          "Agent was already aware of the issue. Discussed alternative phrasing for disclosure requirements. No further action needed.",
          "Scheduled 1-on-1 coaching session. Agent needs refresher on cancellation policy disclosure. Follow-up audit in 2 weeks.",
          "Team meeting held to address this pattern. Updated the call script to make the required step more prominent.",
          "Agent terminated after repeated failures on compliance questions. This was the third offense in 30 days.",
        ][i],
        "manager@monsterrg.com",
      );
      const remEntry = await db.get(orgKey(orgId, "manager-remediation", finding.id));
      if (remEntry.value) {
        const updated = { ...(remEntry.value as Record<string, any>), addressedAt: remediatedAt };
        await db.set(orgKey(orgId, "manager-remediation", finding.id), updated);
      }
    }

    managerSeeded++;
  }
  console.log(`[SEED] Manager queue seeded: ${managerSeeded} items`);

  // -- Judge / Appeal seed --
  // All users already created above with proper supervisor hierarchy
  const judges = ["judge@monsterrg.com"];
  const auditors = ["agent@monsterrg.com"];
  let judgeSeeded = 0;

  const appealFindings = findings.slice(2, 10);
  for (let i = 0; i < appealFindings.length; i++) {
    const finding = appealFindings[i];
    if (!finding.answeredQuestions?.length) continue;

    const auditor = auditors[i % auditors.length];
    finding.owner = auditor;
    await saveFinding(orgId, finding);

    const appealedAt = now - Math.floor(Math.random() * 6 * WEEK_MS);
    const isComplete = i < 6;

    await saveAppeal(orgId, {
      findingId: finding.id,
      appealedAt,
      status: isComplete ? "complete" : "pending",
      judgedBy: isComplete ? judges[i % judges.length] : undefined,
      auditor,
    });

    await populateJudgeQueue(orgId, finding.id, finding.answeredQuestions);

    if (isComplete) {
      const judge = judges[i % judges.length];
      for (let qi = 0; qi < finding.answeredQuestions.length; qi++) {
        const decision = Math.random() < 0.2 ? "overturn" as const : "uphold" as const;
        await recordJudgeDecision(orgId, finding.id, qi, decision, judge);
      }
    }

    judgeSeeded++;
    console.log(`[SEED] Judge appeal ${judgeSeeded}: ${finding.id} (${isComplete ? "complete" : "pending"})`);
  }
  console.log(`[SEED] Judge seeded: ${judgeSeeded} appeals`);

  // -- Question Lab seed --
  const qlabKv = await import("../domain/coordinators/question-lab/mod.ts");

  const config = await qlabKv.createConfig(orgId, "Verification Audit");

  const questionsData: Array<{
    name: string;
    text: string;
    autoYesExp: string;
    tests: Array<{ snippet: string; expected: "yes" | "no" }>;
  }> = [
    {
      name: "Guest Name",
      text: "Did the agent verify the guest's full name during the call?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Hi, good afternoon. Is this Ms. Jane Doe?\n[CUSTOMER]: Yes.\n[AGENT]: Awesome. This is James. I'm with Acme Travel Group.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: Hello, I'm calling from Acme Travel Group about your upcoming booking.\n[CUSTOMER]: Okay.\n[AGENT]: Let me just pull up your details here.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Age Verification",
      text: "Did the agent confirm the guest meets the minimum age requirement (28 years old)?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Are you at least 28 years old, Ms. Jane?\n[CUSTOMER]: Oh, God, yes.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: So you'll both be attending the presentation during your stay.\n[CUSTOMER]: Yes, we will.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Confirmation Expectations",
      text: "Did the agent explain when and how the guest will receive their confirmation (email within 48 hours or 30 days before trip)?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Now, last but not least, ma'am, you're going to get that confirmation email within 48 hours if you have any questions.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: About 30 days before your trip, you receive a text and email for confirmation.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: All right, so everything is booked. We look forward to seeing you there!\n[CUSTOMER]: Great, thank you!`,
          expected: "no",
        },
      ],
    },
    {
      name: "MCC Recurring Charges",
      text: "Did the agent disclose that the Cruise Club membership will begin recurring charges after 6 months?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: After your six month free trial of the Cruise Club ends, you will be billed $14.99 per month unless you cancel.\n[CUSTOMER]: Okay, got it.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: You also get a six month free membership to our cruise club as part of the White Glove service Plus, with savings on Carnival, Norwegian, and Margarita cruises.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Married/Cohabiting Qualifier",
      text: "Did the agent confirm whether the guest is married or cohabiting with their significant other (not separated)?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Now, you and your significant other are legally married or living together. You're not separated or going through a separation. Is that correct?\n[CUSTOMER]: That's correct.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: Just to confirm you are single as in not separated or living with someone. Is that correct?\n[CUSTOMER]: Correct, I'm single.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: And will your partner be attending with you?\n[CUSTOMER]: No, I'll be going alone.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Correct Location",
      text: "Did the agent state the correct destination/location for the booking?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: Now, I have you arriving in Branson, Missouri, on July 24th of 2026.\n[CUSTOMER]: That's right.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: So your trip is all set for next summer.\n[CUSTOMER]: And that's to Branson, right?\n[AGENT]: Let me check on that for you.`,
          expected: "no",
        },
      ],
    },
    {
      name: "Reschedule Process",
      text: "Did the agent explain the reschedule process and any associated fees or deposit forfeiture?",
      autoYesExp: "",
      tests: [
        {
          snippet: `[AGENT]: If you need to reschedule, just call us at least 30 days before your trip. There's a $75 reschedule fee, but your deposit stays intact.\n[CUSTOMER]: That sounds reasonable.`,
          expected: "yes",
        },
        {
          snippet: `[AGENT]: By declining the White Glove Plus, you will forfeit your 150 refundable deposit if you do not show for your dates.\n[CUSTOMER]: Understood.`,
          expected: "no",
        },
      ],
    },
  ];

  let qlabSeeded = 0;
  for (const qData of questionsData) {
    const question = await qlabKv.createQuestion(orgId, config.id, qData.name, qData.text);
    if (!question) continue;
    if (qData.autoYesExp) {
      await qlabKv.updateQuestion(orgId, question.id, { autoYesExp: qData.autoYesExp });
    }
    for (const t of qData.tests) {
      await qlabKv.createTest(orgId, question.id, t.snippet, t.expected);
      qlabSeeded++;
    }
  }

  console.log(`[SEED] Question Lab seeded: ${questionsData.length} questions, ${qlabSeeded} tests in config "${config.name}"`);

  // -- Cosmetics seed (avatar frames, flairs, name colors, fonts, animations) --
  const cosmeticProfiles: Array<[string, string[], number, number]> = [
    // [email, purchases, xp, tokens]
    ["admin@monsterrg.com",  ["frame_legendary", "flair_crown", "color_prismatic", "font_chrome", "anim_nova"], 15000, 600],
    ["judge@monsterrg.com",  ["frame_galaxy", "flair_skull", "color_vaporwave", "font_neon_script", "anim_lightning"], 10000, 400],
    ["manager@monsterrg.com", ["frame_diamond", "flair_diamond", "color_aurora", "font_gothic", "anim_fireworks"], 7000, 300],
    ["reviewer@monsterrg.com", ["frame_toxic", "flair_flame", "color_inferno", "font_bold", "anim_matrix"], 4500, 200],
    ["reviewer2@monsterrg.com", ["frame_frost", "flair_bolt", "color_ocean", "font_serif", "anim_petals"], 2500, 150],
    ["agent@monsterrg.com",  ["frame_emerald", "flair_star", "color_gold", "font_mono", "anim_sparkle"], 1200, 80],
  ];

  for (const [email, purchases, xp, tokens] of cosmeticProfiles) {
    const existing = await getGameState(orgId, email);
    await saveGameState(orgId, email, {
      ...existing,
      totalXp: Math.max(existing.totalXp, xp),
      tokenBalance: Math.max(existing.tokenBalance, tokens),
      purchases: [...new Set([...existing.purchases, ...purchases])],
    });
    console.log(`[SEED] Cosmetics for ${email}: ${purchases.join(", ")}`);
  }
  console.log("[SEED] Cosmetics seeded for all test users");

  return { seeded, managerSeeded, judgeSeeded, qlabSeeded, orgId };
}

export async function handleSeed(_req: Request): Promise<Response> {
  const db = await kvFactory();

  // Create or reuse default org
  let orgId: OrgId;
  const existingOrg = await db.get<string>(["default-org"]);
  if (existingOrg.value) {
    orgId = existingOrg.value;
  } else {
    orgId = await createOrg("Auto-Bot Dev", "admin@autobot.dev");
    await db.set(["default-org"], orgId);
  }

  const result = await seedOrgData(orgId);
  return json({ ok: true, ...result });
}

// -- Reset Finding --

export async function handleResetFinding(req: Request): Promise<Response> {
  const auth = await requireAdminAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { findingId } = body;
  if (!findingId) return json({ error: "findingId required" }, 400);

  const db = await kvFactory();
  let deleted = 0;

  // Prefixes with sub-keys (org-scoped)
  const listPrefixes = [
    orgKey(auth.orgId, "review-pending", findingId),
    orgKey(auth.orgId, "review-decided", findingId),
    orgKey(auth.orgId, "review-lock", findingId),
    orgKey(auth.orgId, "judge-pending", findingId),
    orgKey(auth.orgId, "judge-decided", findingId),
    orgKey(auth.orgId, "judge-lock", findingId),
  ];
  for (const prefix of listPrefixes) {
    for await (const entry of db.list({ prefix })) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  // Exact keys (org-scoped)
  const exactKeys: Deno.KvKey[] = [
    orgKey(auth.orgId, "review-audit-pending", findingId),
    orgKey(auth.orgId, "judge-audit-pending", findingId),
    orgKey(auth.orgId, "appeal", findingId),
    orgKey(auth.orgId, "manager-queue", findingId),
    orgKey(auth.orgId, "manager-remediation", findingId),
  ];
  for (const key of exactKeys) {
    const entry = await db.get(key);
    if (entry.versionstamp) {
      await db.delete(key);
      deleted++;
    }
  }

  // Re-populate review queue
  let queued = 0;
  const answers = await getAllAnswersForFinding(auth.orgId, findingId);
  if (answers?.length) {
    await populateReviewQueue(auth.orgId, findingId, answers);
    queued = answers.filter((q: any) => q.answer === "No").length;
  }

  console.log(`[ADMIN] Reset finding ${findingId}: ${deleted} deleted, ${queued} re-queued`);
  return json({ ok: true, deleted, queued, findingId });
}

// -- Wipe KV --

export async function handleWipeKv(_req: Request): Promise<Response> {
  const db = await kvFactory();
  let deleted = 0;
  const iter = db.list({ prefix: [] });
  for await (const entry of iter) {
    await db.delete(entry.key);
    deleted++;
  }
  console.log(`[ADMIN] Wiped ${deleted} KV entries`);
  return json({ ok: true, deleted });
}
