/** Pure rules behind the department question order (REQ-053/054): the default
 *  list, how a saved list is reconciled with it, the red → green gradient, and
 *  how a queue ranks audits by their worst failed question. */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  compareBySeverity, DEFAULT_QUESTION_ORDER, effectiveOrder, severityColor, sortFailsBySeverity,
} from "@core/business/question-order/mod.ts";

Deno.test("REQ-053: the default order is the 25 agreed questions, Income worst and Guest Name last", () => {
  assertEquals(DEFAULT_QUESTION_ORDER, [
    "Income",
    "MCC Recurring Charges Disclosed?",
    "MCC Not Egregious?",
    "Married/Cohab Qualifier Question",
    "Single Qualifier Question",
    "Understand Reschedule Process",
    "Major CC",
    "US or Canadian Citizen?",
    "Age",
    "Attending Presentation Together?",
    "Matching IDs",
    "Active Bankruptcy",
    "9% Service Fee",
    "Taxes",
    "TimeShare Owner",
    "No Group Travel",
    "Preview 15 Months",
    "# in Room",
    "Correct Location",
    "Correct Days & Nights",
    "No Pets",
    "Credit Card Number is Not Read on VO?",
    "Confirmation Expectations",
    "Phone Number",
    "Guest Name",
  ]);
});

Deno.test("REQ-053: no saved list means the default order", () => {
  assertEquals(effectiveOrder(null), DEFAULT_QUESTION_ORDER);
  assertEquals(effectiveOrder([]), DEFAULT_QUESTION_ORDER);
});

Deno.test("REQ-053: a saved list keeps its order, drops duplicates, and gains any default question it lacks at the bottom", () => {
  const out = effectiveOrder(["Taxes", "Income", "Taxes", "Some New Question"]);
  assertEquals(out.slice(0, 3), ["Taxes", "Income", "Some New Question"]);
  assertEquals(out.length, 3 + DEFAULT_QUESTION_ORDER.length - 2);
  assertEquals(out.at(-1), "Guest Name");
  assertEquals(new Set(out).size, out.length);
});

/** "#rrggbb" → [r, g, b] */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

Deno.test("REQ-053: the gradient runs dark red at the top, through orange and yellow, to green at the bottom", () => {
  const n = 25;
  const [r0, g0, b0] = rgb(severityColor(0, n));
  assert(r0 > 100 && g0 < 40 && b0 < 40, `top should be dark red, got ${severityColor(0, n)}`);
  const [rm, gm] = rgb(severityColor(8, n));
  assert(rm > 180 && gm > 60 && gm < 160, `a third of the way should be orange, got ${severityColor(8, n)}`);
  const [ry, gy] = rgb(severityColor(16, n));
  assert(ry > 170 && gy > 150, `two thirds of the way should be yellow, got ${severityColor(16, n)}`);
  const [rl, gl, bl] = rgb(severityColor(24, n));
  assert(gl > rl && gl > bl, `bottom should be green, got ${severityColor(24, n)}`);
  // Every position gets its own step on the gradient.
  for (let i = 1; i < n; i++) assertNotEquals(severityColor(i, n), severityColor(i - 1, n));
});

Deno.test("REQ-053: a question the list doesn't know is colored like the bottom of the list", () => {
  assertEquals(severityColor(99, 25), severityColor(24, 25));
});

const ORDER = ["Income", "MCC Not Egregious?", "Taxes", "Age", "Guest Name"];
const item = (failedQuestions: string[], completedAt: number) => ({ failedQuestions, completedAt });

Deno.test("REQ-054: an audit ranks by its worst failed question", () => {
  const rows = [item(["Guest Name"], 3), item(["Taxes", "Guest Name"], 2), item(["Age", "Income"], 1)];
  rows.sort(compareBySeverity(() => ORDER));
  assertEquals(rows.map((r) => r.failedQuestions[0]), ["Age", "Taxes", "Guest Name"]);
});

Deno.test("REQ-054: a tie on the worst question goes to the next-worst failed question", () => {
  const rows = [item(["Income"], 9), item(["Income", "Guest Name"], 1), item(["Income", "Taxes"], 2)];
  rows.sort(compareBySeverity(() => ORDER));
  assertEquals(rows.map((r) => r.failedQuestions.join("+")), ["Income+Taxes", "Income+Guest Name", "Income"]);
});

Deno.test("REQ-054: identical failed questions go to the most recent audit", () => {
  const rows = [item(["Taxes"], 1), item(["Taxes"], 3), item(["Taxes"], 2)];
  rows.sort(compareBySeverity(() => ORDER));
  assertEquals(rows.map((r) => r.completedAt), [3, 2, 1]);
});

Deno.test("REQ-054: an unknown failed question ranks below every known one, and no failed question ranks last", () => {
  const rows = [item([], 5), item(["Mystery"], 4), item(["Guest Name"], 3)];
  rows.sort(compareBySeverity(() => ORDER));
  assertEquals(rows.map((r) => r.completedAt), [3, 4, 5]);
});

Deno.test("REQ-055: each audit is ranked by its own department's list", () => {
  const lists: Record<string, string[]> = { A: ["Taxes", "Income"], B: ["Income", "Taxes"] };
  const rows = [
    { department: "A", failedQuestions: ["Income"], completedAt: 1 },
    { department: "B", failedQuestions: ["Taxes"], completedAt: 2 },
    { department: "A", failedQuestions: ["Taxes"], completedAt: 3 },
  ];
  rows.sort(compareBySeverity((r) => lists[r.department]));
  // A's Taxes is A's #1; B's Taxes is B's #2; A's Income is A's #2 (older).
  assertEquals(rows.map((r) => r.completedAt), [3, 2, 1]);
});

Deno.test("REQ-056: a row's failed questions list worst-first", () => {
  assertEquals(sortFailsBySeverity(["Guest Name", "Mystery", "Income", "Taxes"], ORDER), ["Income", "Taxes", "Guest Name", "Mystery"]);
});
