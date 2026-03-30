/** Tests for reviewer audit ownership model.
 *  Validates that reviewers get all questions for one audit,
 *  decisions are tracked correctly, and completion logic works. */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// -- Simulate the frontend audit state model --

interface AuditItem {
  findingId: string;
  questionIndex: number;
  reviewIndex: number;
  totalForFinding: number;
  header: string;
}

interface AuditState {
  auditItems: AuditItem[];
  auditDecisions: Record<number, "confirm" | "flip">;
  currentAuditIdx: number;
  auditFindingId: string | null;
}

function createState(): AuditState {
  return { auditItems: [], auditDecisions: {}, currentAuditIdx: 0, auditFindingId: null };
}

function loadAudit(state: AuditState, items: AuditItem[]): void {
  const newFid = items[0]?.findingId ?? null;
  if (newFid !== state.auditFindingId) {
    state.auditFindingId = newFid;
    state.auditItems = items.slice();
    state.auditDecisions = {};
    state.currentAuditIdx = 0;
  }
}

function recordDecision(state: AuditState, decision: "confirm" | "flip"): void {
  const item = state.auditItems[state.currentAuditIdx];
  if (!item) return;
  state.auditDecisions[item.questionIndex] = decision;
}

function advanceToNextUndecided(state: AuditState): boolean {
  for (let i = 1; i <= state.auditItems.length; i++) {
    const nextIdx = (state.currentAuditIdx + i) % state.auditItems.length;
    if (!state.auditDecisions[state.auditItems[nextIdx].questionIndex]) {
      state.currentAuditIdx = nextIdx;
      return true;
    }
  }
  return false; // all decided
}

function countUndecided(state: AuditState): number {
  let count = 0;
  for (const item of state.auditItems) {
    if (!state.auditDecisions[item.questionIndex]) count++;
  }
  return count;
}

function makeItems(findingId: string, count: number): AuditItem[] {
  return Array.from({ length: count }, (_, i) => ({
    findingId,
    questionIndex: i * 3, // non-sequential to test real-world indices
    reviewIndex: i + 1,
    totalForFinding: count,
    header: `Question ${i + 1}`,
  }));
}

// -- Tests --

Deno.test("loadAudit — initializes state for new audit", () => {
  const state = createState();
  const items = makeItems("finding-1", 3);
  loadAudit(state, items);
  assertEquals(state.auditFindingId, "finding-1");
  assertEquals(state.auditItems.length, 3);
  assertEquals(state.currentAuditIdx, 0);
  assertEquals(Object.keys(state.auditDecisions).length, 0);
});

Deno.test("loadAudit — resets state when new audit loads", () => {
  const state = createState();
  loadAudit(state, makeItems("finding-1", 3));
  recordDecision(state, "confirm");
  assertEquals(Object.keys(state.auditDecisions).length, 1);

  // Load a different audit
  loadAudit(state, makeItems("finding-2", 5));
  assertEquals(state.auditFindingId, "finding-2");
  assertEquals(state.auditItems.length, 5);
  assertEquals(state.currentAuditIdx, 0);
  assertEquals(Object.keys(state.auditDecisions).length, 0);
});

Deno.test("loadAudit — same audit does NOT reset decisions", () => {
  const state = createState();
  const items = makeItems("finding-1", 3);
  loadAudit(state, items);
  recordDecision(state, "confirm");
  assertEquals(Object.keys(state.auditDecisions).length, 1);

  // Re-load same audit (e.g. from server refresh)
  loadAudit(state, items);
  assertEquals(Object.keys(state.auditDecisions).length, 1); // preserved
});

Deno.test("recordDecision — stores decision by questionIndex", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 3));
  recordDecision(state, "flip");
  assertEquals(state.auditDecisions[0], "flip"); // questionIndex = 0
});

Deno.test("advanceToNextUndecided — advances past decided questions", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 4));
  // Decide first question
  recordDecision(state, "confirm");
  const advanced = advanceToNextUndecided(state);
  assert(advanced);
  assertEquals(state.currentAuditIdx, 1);
});

Deno.test("advanceToNextUndecided — wraps around", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 3));
  // Start at last question
  state.currentAuditIdx = 2;
  recordDecision(state, "confirm");
  // Decide idx 0 too
  state.auditDecisions[state.auditItems[0].questionIndex] = "confirm";
  // Should wrap to idx 1
  const advanced = advanceToNextUndecided(state);
  assert(advanced);
  assertEquals(state.currentAuditIdx, 1);
});

Deno.test("advanceToNextUndecided — returns false when all decided", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 2));
  state.auditDecisions[state.auditItems[0].questionIndex] = "confirm";
  state.auditDecisions[state.auditItems[1].questionIndex] = "flip";
  const advanced = advanceToNextUndecided(state);
  assert(!advanced);
});

Deno.test("countUndecided — correct count", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 5));
  assertEquals(countUndecided(state), 5);
  state.auditDecisions[state.auditItems[0].questionIndex] = "confirm";
  assertEquals(countUndecided(state), 4);
  state.auditDecisions[state.auditItems[2].questionIndex] = "flip";
  assertEquals(countUndecided(state), 3);
});

Deno.test("countUndecided === 1 triggers confirm modal", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 3));
  state.auditDecisions[state.auditItems[0].questionIndex] = "confirm";
  state.auditDecisions[state.auditItems[1].questionIndex] = "flip";
  // Only 1 undecided — this is when the confirm modal should show
  assertEquals(countUndecided(state), 1);
});

Deno.test("pill click — navigates to specific question", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 5));
  // Simulate clicking pill for question 3 (idx 2)
  state.currentAuditIdx = 2;
  assertEquals(state.auditItems[state.currentAuditIdx].reviewIndex, 3);
  assertEquals(state.auditItems[state.currentAuditIdx].header, "Question 3");
});

Deno.test("full audit flow — decide all questions sequentially", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 3));

  // Question 1: confirm
  assertEquals(countUndecided(state), 3);
  recordDecision(state, "confirm");
  assert(advanceToNextUndecided(state));
  assertEquals(state.currentAuditIdx, 1);

  // Question 2: flip
  assertEquals(countUndecided(state), 2);
  recordDecision(state, "flip");
  assert(advanceToNextUndecided(state));
  assertEquals(state.currentAuditIdx, 2);

  // Question 3 (last): confirm modal should trigger
  assertEquals(countUndecided(state), 1);
  recordDecision(state, "confirm");
  const canAdvance = advanceToNextUndecided(state);
  assert(!canAdvance); // all decided

  // Verify final state
  assertEquals(countUndecided(state), 0);
  assertEquals(Object.keys(state.auditDecisions).length, 3);
});

Deno.test("undo — removing decision from auditDecisions restores undecided", () => {
  const state = createState();
  loadAudit(state, makeItems("f1", 3));
  recordDecision(state, "confirm");
  advanceToNextUndecided(state);
  recordDecision(state, "flip");
  assertEquals(countUndecided(state), 1);

  // Undo last decision
  delete state.auditDecisions[state.auditItems[1].questionIndex];
  assertEquals(countUndecided(state), 2);
});
