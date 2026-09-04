import { assertEquals } from "#assert";
import { appealDirection, appealOutcomeFromFinding, isAppealExpired, judgeReasonText, summarizeAppealOutcome } from "./mod.ts";
Deno.test("appeal not expired — recent", () => { assertEquals(isAppealExpired(Date.now()), false); });
Deno.test("appeal expired — old", () => { assertEquals(isAppealExpired(Date.now() - 30 * 86400000), true); });

Deno.test("direction — every question overturned is granted", () => {
  assertEquals(appealDirection(3, 0), "granted");
});
Deno.test("direction — every question upheld is denied", () => {
  assertEquals(appealDirection(0, 2), "denied");
});
Deno.test("direction — a mix is partial", () => {
  assertEquals(appealDirection(1, 2), "partial");
});
Deno.test("direction — nothing judged is unknown, never a claimed direction", () => {
  assertEquals(appealDirection(0, 0), "unknown");
});

Deno.test("reason text — a picker code spells out, free text passes through", () => {
  assertEquals(judgeReasonText("fragment"), "Fragment — the snippet the bot judged was incomplete");
  assertEquals(judgeReasonText("She read the disclosure late"), "She read the disclosure late");
  assertEquals(judgeReasonText(undefined), "");
});

Deno.test("summary — counts, scores and one note line per decision", () => {
  const s = summarizeAppealOutcome([
    { header: "No Pets", decision: "overturn", reason: "error" },
    { header: "Correct Days & Nights", decision: "uphold", reason: "Dates were wrong on the call" },
  ], { before: 50, after: 75 });
  assertEquals(s.outcome, "partial");
  assertEquals(s.overturnedCount, 1);
  assertEquals(s.upheldCount, 1);
  assertEquals(s.scoreBefore, 50);
  assertEquals(s.scoreAfter, 75);
  assertEquals(
    s.judgeNotes,
    "Pet Policy — Overturned: Bot error — the bot got it wrong\nTravel Dates — Upheld: Dates were wrong on the call",
  );
});

Deno.test("summary — undecided questions are ignored", () => {
  const s = summarizeAppealOutcome([
    { header: "No Pets", decision: "overturn" },
    { header: "No Group Travel" },
  ]);
  assertEquals(s.overturnedCount, 1);
  assertEquals(s.upheldCount, 0);
  assertEquals(s.outcome, "granted");
  assertEquals(s.judgeNotes, "Pet Policy — Overturned");
});

Deno.test("from finding — recovers direction and the pre-appeal score", () => {
  const s = appealOutcomeFromFinding({
    answeredQuestions: [
      { header: "No Pets", answer: "Yes", judgeAction: "overturn", judgeReason: "logic" },
      { header: "No Group Travel", answer: "No", judgeAction: "uphold", judgeReason: "Stands" },
      { header: "# in Room", answer: "Yes" },
      { header: "Preview 15 Months", answer: "Yes" },
    ],
  });
  assertEquals(s.outcome, "partial");
  assertEquals(s.overturnedCount, 1);
  assertEquals(s.upheldCount, 1);
  // 3 of 4 "Yes" today; the overturn was a "No" before the appeal → 2 of 4.
  assertEquals(s.scoreAfter, 75);
  assertEquals(s.scoreBefore, 50);
});

Deno.test("from finding — an unjudged or missing finding is unknown, not granted", () => {
  assertEquals(appealOutcomeFromFinding(null).outcome, "unknown");
  assertEquals(appealOutcomeFromFinding({ answeredQuestions: [{ header: "No Pets", answer: "No" }] }).outcome, "unknown");
});
