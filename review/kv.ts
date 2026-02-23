/** Review-specific KV operations: queue, locks, auth, settings, completion. */

import { getFinding, getAllAnswersForFinding, getTranscript, fireWebhook } from "../lib/kv.ts";
import { populateManagerQueue } from "../manager/kv.ts";

let _kv: Deno.Kv | undefined;

async function kv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

// -- Types --

export interface ReviewItem {
  findingId: string;
  questionIndex: number;
  header: string;
  populated: string;
  thinking: string;
  defense: string;
  answer: string;
}

export interface ReviewDecision extends ReviewItem {
  decision: "confirm" | "flip";
  reviewer: string;
  decidedAt: number;
}

// -- Queue Population --

export async function populateReviewQueue(
  findingId: string,
  answeredQuestions: Array<{ answer: string; header: string; populated: string; thinking: string; defense: string }>,
) {
  const db = await kv();
  const noAnswers = answeredQuestions
    .map((q, i) => ({ ...q, index: i }))
    .filter((q) => q.answer === "No");

  if (noAnswers.length === 0) return;

  const atomic = db.atomic();
  for (const q of noAnswers) {
    const item: ReviewItem = {
      findingId,
      questionIndex: q.index,
      header: q.header,
      populated: q.populated,
      thinking: q.thinking,
      defense: q.defense,
      answer: q.answer,
    };
    atomic.set(["review-pending", findingId, q.index], item);
  }
  atomic.set(["review-audit-pending", findingId], noAnswers.length);
  await atomic.commit();

  console.log(`[REVIEW] ${findingId}: Queued ${noAnswers.length} items for review`);
}

// -- Claim Next Item --

export async function claimNextItem(reviewer: string): Promise<{
  current: ReviewItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: ReviewItem | null;
  remaining: number;
}> {
  const db = await kv();
  const now = Date.now();
  const LOCK_TTL = 30 * 60 * 1000; // 30 minutes

  let current: ReviewItem | null = null;
  let peek: ReviewItem | null = null;
  let remaining = 0;

  const iter = db.list<ReviewItem>({ prefix: ["review-pending"] });
  for await (const entry of iter) {
    remaining++;
    const item = entry.value;
    const lockKey = ["review-lock", item.findingId, item.questionIndex];

    if (!current) {
      // Try to claim this item
      const lockEntry = await db.get(lockKey);
      const res = await db.atomic()
        .check(lockEntry)
        .set(lockKey, { claimedBy: reviewer, claimedAt: now }, { expireIn: LOCK_TTL })
        .commit();

      if (res.ok) {
        current = item;
        continue;
      }
    } else if (!peek) {
      // Try to find a peekable (unlocked) item
      const lockEntry = await db.get(lockKey);
      if (lockEntry.value === null) {
        peek = item;
      }
    }
    // Don't break early — continue iterating to get accurate remaining count
  }

  // Adjust remaining: don't count the one we just claimed
  if (current) remaining--;

  let transcript = null;
  if (current) {
    transcript = await getTranscript(current.findingId);
  }

  return { current, transcript, peek, remaining };
}

// -- Record Decision --

export async function recordDecision(
  findingId: string,
  questionIndex: number,
  decision: "confirm" | "flip",
  reviewer: string,
): Promise<{ success: boolean; auditComplete: boolean }> {
  const db = await kv();

  // Check lock — if owned by another reviewer, reject. Otherwise proceed.
  const lockKey = ["review-lock", findingId, questionIndex];
  const lockEntry = await db.get<{ claimedBy: string }>(lockKey);
  if (lockEntry.value && lockEntry.value.claimedBy !== reviewer) {
    console.log(`[REVIEW] recordDecision REJECTED: lock owned by ${lockEntry.value.claimedBy}, not ${reviewer}`);
    return { success: false, auditComplete: false };
  }

  // Load pending item
  const pendingKey = ["review-pending", findingId, questionIndex];
  const pendingEntry = await db.get<ReviewItem>(pendingKey);
  if (!pendingEntry.value) {
    console.log(`[REVIEW] recordDecision REJECTED: no pending entry for ${findingId}/${questionIndex}`);
    return { success: false, auditComplete: false };
  }

  const decided: ReviewDecision = {
    ...pendingEntry.value,
    decision,
    reviewer,
    decidedAt: Date.now(),
  };

  // Load current counter
  const counterKey = ["review-audit-pending", findingId];
  const counterEntry = await db.get<number>(counterKey);
  const currentCount = counterEntry.value ?? 1;
  const newCount = currentCount - 1;

  // Write decided + delete pending + delete lock + update counter
  // Check pending versionstamp to prevent double-decide on concurrent requests
  const atomic = db.atomic()
    .check(pendingEntry)
    .delete(lockKey)
    .delete(pendingKey)
    .set(["review-decided", findingId, questionIndex], decided);

  if (newCount <= 0) {
    atomic.delete(counterKey);
  } else {
    atomic.set(counterKey, newCount);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    console.log(`[REVIEW] recordDecision REJECTED: atomic commit failed for ${findingId}/${questionIndex}`);
    return { success: false, auditComplete: false };
  }

  console.log(`[REVIEW] recordDecision OK: ${findingId}/${questionIndex} = ${decision}`);

  const auditComplete = newCount <= 0;

  // Fire completion POST and populate manager queue in background if audit is complete
  if (auditComplete) {
    postCorrectedAudit(findingId).catch((err) =>
      console.error(`[REVIEW] ${findingId}: Completion POST failed:`, err)
    );
    populateManagerQueue(findingId).catch((err) =>
      console.error(`[REVIEW] ${findingId}: Manager queue population failed:`, err)
    );
  }

  return { success: true, auditComplete };
}

// -- Go Back (Undo) --

export async function undoDecision(
  reviewer: string,
): Promise<{
  restored: ReviewItem | null;
  transcript: { raw: string; diarized: string } | null;
  peek: ReviewItem | null;
  remaining: number;
}> {
  const db = await kv();

  // First, release any current lock held by this reviewer
  const lockIter = db.list<{ claimedBy: string }>({ prefix: ["review-lock"] });
  for await (const entry of lockIter) {
    if (entry.value.claimedBy === reviewer) {
      await db.delete(entry.key);
    }
  }

  // Find the most recent decision by this reviewer
  let latestDecided: { entry: Deno.KvEntry<ReviewDecision>; decidedAt: number } | null = null;
  const decidedIter = db.list<ReviewDecision>({ prefix: ["review-decided"] });
  for await (const entry of decidedIter) {
    if (entry.value.reviewer === reviewer) {
      if (!latestDecided || entry.value.decidedAt > latestDecided.decidedAt) {
        latestDecided = { entry, decidedAt: entry.value.decidedAt };
      }
    }
  }

  if (!latestDecided) {
    return { restored: null, transcript: null, peek: null, remaining: 0 };
  }

  const decided = latestDecided.entry.value;
  const { findingId, questionIndex } = decided;
  const item: ReviewItem = {
    findingId: decided.findingId,
    questionIndex: decided.questionIndex,
    header: decided.header,
    populated: decided.populated,
    thinking: decided.thinking,
    defense: decided.defense,
    answer: decided.answer,
  };

  // Move back: delete decided, restore to pending, increment counter
  const counterKey = ["review-audit-pending", findingId];
  const counterEntry = await db.get<number>(counterKey);
  const newCount = (counterEntry.value ?? 0) + 1;

  const atomic = db.atomic()
    .check(latestDecided.entry)
    .check(counterEntry)
    .delete(latestDecided.entry.key)
    .set(["review-pending", findingId, questionIndex], item)
    .set(counterKey, newCount)
    .set(
      ["review-lock", findingId, questionIndex],
      { claimedBy: reviewer, claimedAt: Date.now() },
      { expireIn: 30 * 60 * 1000 },
    );

  const res = await atomic.commit();
  if (!res.ok) {
    return { restored: null, transcript: null, peek: null, remaining: 0 };
  }

  const transcript = await getTranscript(findingId);

  // Find peek
  let peek: ReviewItem | null = null;
  let remaining = 0;
  const pendingIter = db.list<ReviewItem>({ prefix: ["review-pending"] });
  for await (const entry of pendingIter) {
    remaining++;
    if (!peek && !(entry.value.findingId === findingId && entry.value.questionIndex === questionIndex)) {
      const lk = ["review-lock", entry.value.findingId, entry.value.questionIndex];
      const lkEntry = await db.get(lk);
      if (lkEntry.value === null) {
        peek = entry.value;
      }
    }
  }

  return { restored: item, transcript, peek, remaining };
}

// -- Audit Completion POST --

async function postCorrectedAudit(findingId: string) {
  const db = await kv();

  const finding = await getFinding(findingId);
  if (!finding) {
    console.error(`[REVIEW] ${findingId}: Finding not found for completion POST`);
    return;
  }

  const allAnswers = await getAllAnswersForFinding(findingId);

  // Load all decided items for this finding
  const decisions: ReviewDecision[] = [];
  const iter = db.list<ReviewDecision>({ prefix: ["review-decided", findingId] });
  for await (const entry of iter) {
    decisions.push(entry.value);
  }

  // Apply flips: change answer from "No" to "Yes" for flipped decisions
  const correctedAnswers = allAnswers.map((a: any, i: number) => {
    const decision = decisions.find((d) => d.questionIndex === i);
    if (decision?.decision === "flip") {
      return { ...a, answer: "Yes", reviewedBy: decision.reviewer, reviewAction: "flip" };
    }
    if (decision?.decision === "confirm") {
      return { ...a, reviewedBy: decision.reviewer, reviewAction: "confirm" };
    }
    return a;
  });

  await fireWebhook("terminate", {
    findingId,
    finding: { ...finding, answeredQuestions: correctedAnswers },
    correctedAnswers,
    reviewedAt: new Date().toISOString(),
  });
}

// -- Auth --

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createUser(username: string, password: string, role: string = "reviewer", supervisor?: string) {
  const db = await kv();
  const passwordHash = await hashPassword(password);
  await db.set(["review-user", username], { passwordHash, role, supervisor: supervisor || null });
}

export async function listUsers(): Promise<Array<{ username: string; role: string; supervisor: string | null }>> {
  const db = await kv();
  const users: Array<{ username: string; role: string; supervisor: string | null }> = [];
  const iter = db.list<{ passwordHash: string; role: string; supervisor?: string | null }>({ prefix: ["review-user"] });
  for await (const entry of iter) {
    const username = entry.key[1] as string;
    users.push({ username, role: entry.value.role, supervisor: entry.value.supervisor ?? null });
  }
  return users;
}

export async function verifyUser(username: string, password: string): Promise<boolean> {
  const db = await kv();
  const entry = await db.get<{ passwordHash: string }>(["review-user", username]);
  if (!entry.value) return false;
  const hash = await hashPassword(password);
  return hash === entry.value.passwordHash;
}

export async function hasAnyUsers(): Promise<boolean> {
  const db = await kv();
  const iter = db.list({ prefix: ["review-user"] });
  for await (const _ of iter) {
    return true;
  }
  return false;
}

export async function createSession(username: string): Promise<string> {
  const db = await kv();
  const token = crypto.randomUUID();
  await db.set(["review-session", token], { username, createdAt: Date.now() }, { expireIn: 24 * 60 * 60 * 1000 });
  return token;
}

export async function getSession(token: string): Promise<string | null> {
  const db = await kv();
  const entry = await db.get<{ username: string }>(["review-session", token]);
  return entry.value?.username ?? null;
}

export async function deleteSession(token: string) {
  const db = await kv();
  await db.delete(["review-session", token]);
}

// -- Stats --

export async function getReviewStats(): Promise<{ pending: number; decided: number }> {
  const db = await kv();
  let pending = 0;
  let decided = 0;

  for await (const _ of db.list({ prefix: ["review-pending"] })) pending++;
  for await (const _ of db.list({ prefix: ["review-decided"] })) decided++;

  return { pending, decided };
}

// -- Backfill --

export async function backfillFromFinished() {
  const db = await kv();
  let queued = 0;

  // Collect unique finding IDs from chunked KV keys (pattern: ["audit-finding", id, chunkIndex])
  const findingIds = new Set<string>();
  const iter = db.list({ prefix: ["audit-finding"] });
  for await (const entry of iter) {
    const key = entry.key as Deno.KvKey;
    // key shape: ["audit-finding", findingId, chunkIndexOrMeta]
    if (key.length >= 2 && typeof key[1] === "string") {
      findingIds.add(key[1]);
    }
  }

  for (const findingId of findingIds) {
    const finding = await getFinding(findingId);
    if (!finding) continue;
    if (finding.findingStatus !== "finished") continue;
    if (!finding.answeredQuestions?.length) continue;

    // Skip if already has review items
    const existingCheck = await db.get(["review-audit-pending", findingId]);
    if (existingCheck.value !== null) continue;

    // Also check if any decided items exist
    let hasDecided = false;
    const decidedIter = db.list({ prefix: ["review-decided", findingId] });
    for await (const _ of decidedIter) {
      hasDecided = true;
      break;
    }
    if (hasDecided) continue;

    const noAnswers = (finding.answeredQuestions as any[])
      .map((q: any, i: number) => ({ ...q, index: i }))
      .filter((q: any) => q.answer === "No");

    if (noAnswers.length === 0) continue;

    const atomic = db.atomic();
    for (const q of noAnswers) {
      const item: ReviewItem = {
        findingId,
        questionIndex: q.index,
        header: q.header ?? "",
        populated: q.populated ?? "",
        thinking: q.thinking ?? "",
        defense: q.defense ?? "",
        answer: q.answer,
      };
      atomic.set(["review-pending", findingId, q.index], item);
    }
    atomic.set(["review-audit-pending", findingId], noAnswers.length);
    await atomic.commit();
    queued += noAnswers.length;
  }

  return { queued };
}
