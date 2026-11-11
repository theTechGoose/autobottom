/** Overturn Review (REQ-047..051): an appeal a judge overturned anything on
 *  waits on /judge/overturn-review for the team's call. A story seeds a
 *  reviewed, appealed audit into the emulator project `serve` reads, has the
 *  judge decide it through the real decision path, then drives the page as a
 *  judge (or admin, for the off switch). */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { getFinding, saveFinding, saveTranscript } from "@audit/domain/data/audit-repository/mod.ts";
import { getAppeal, recordJudgeDecision, saveAppeal } from "@judge/domain/data/judge-repository/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { setOverturnReviewEnabled } from "@judge/domain/business/overturn-review/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];
const PASS = "e2e-pass-123";
const tag = () => crypto.randomUUID().slice(0, 6);

/** A reviewed audit with two failed questions, appealed on both, then judged —
 *  by default the judge overturns Q0 and upholds Q1 (a mixed appeal). */
async function judgedAppeal(judge: string, calls: Array<"overturn" | "uphold"> = ["overturn", "uphold"]): Promise<string> {
  const id = `e2e-ovr-${tag()}`;
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    owner: "e2e-tm@monsterrg.com",
    appealComment: "Guest confirmed ownership at 2:10",
    answeredQuestions: [
      { header: "TimeShare Owner", populated: "Does the guest own a timeshare?", thinking: "No mention", defense: "", answer: "No" },
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
      { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "", answer: "Yes" },
    ],
    completedAt: Date.now() - 60_000,
    record: { RecordId: "900300", VoName: "DS MB - Demo Agent" },
    recordingId: "27694351",
    genieIds: ["27694351"],
    recordingIdField: "VoGenie",
  } as unknown as Parameters<typeof saveFinding>[1]);
  const said = "[AGENT]: Do you own a timeshare?\n[CUSTOMER]: Yes, we do.";
  await saveTranscript(ORG, id, said, said);
  await saveAppeal(ORG, { findingId: id, appealedAt: Date.now() - 30_000, status: "pending", auditor: "e2e-tm@monsterrg.com", appealedQuestions: ["0", "1"] });
  for (const i of [0, 1]) {
    await setStored("review-decided", ORG, [id, i], {
      findingId: id, questionIndex: i, header: i ? "Correct Dates" : "TimeShare Owner", answer: "No", thinking: "", defense: "",
      decision: "confirm", reviewer: `e2e-reviewer${i}@monsterrg.com`, decidedAt: Date.now() - 50_000,
    });
    await setStored("judge-pending", ORG, [id, i], {
      findingId: id, questionIndex: i, header: i ? "Correct Dates" : "TimeShare Owner", populated: "", thinking: "", defense: "", answer: "No",
    });
  }
  await setStored("judge-audit-pending", ORG, [id], 2);
  for (const [i, c] of calls.entries()) {
    await recordJudgeDecision(ORG, id, i, c, judge, c === "overturn" ? "error" : "Dates were wrong on the call");
  }
  for (let i = 0; i < 100 && !(await getStored("overturn-review", ORG, id)); i++) await new Promise((r) => setTimeout(r, 100));
  return id;
}

async function login(role: "judge" | "admin"): Promise<string> {
  const email = `e2e-${role}-${tag()}@monsterrg.com`;
  await createUser(ORG, email, PASS, role);
  return email;
}

// deno-lint-ignore no-explicit-any
async function signIn(page: any, email: string, landing: string): Promise<void> {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASS);
  await page.click("button[type=submit]");
  await page.waitForURL(`**${landing}`);
}

Deno.test("REQ-047: a judge's overturn lands the whole appeal in Overturn Review instead of closing it", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge);

    expect.eq((await getAppeal(ORG, id))?.status, "pending", "the appeal is not final");
    const answers = ((await getFinding(ORG, id))?.answeredQuestions as Array<Record<string, unknown>>).map((q) => q.answer);
    expect.eq(JSON.stringify(answers), JSON.stringify(["No", "No", "Yes"]), "the score has not moved");

    await signIn(page, judge, "/judge");
    await page.goto("/judge/dashboard");
    await page.getByRole("link", { name: "Overturn Review" }).first().click();
    await page.waitForURL("**/judge/overturn-review");
    await page.goto(`/judge/overturn-review?findingId=${id}`);
    const pills = page.locator("#ovr-panel .failed-q-pill");
    expect(await pills.nth(0).getByText("Overturned").isVisible(), "the overturn is held");
    expect(await pills.nth(1).getByText("Upheld").isVisible(), "and the upheld question rides along with it");
  }));

Deno.test("REQ-048: the Overturn Review page shows the reviewer who failed it, the judge who passed it, and the transcript", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge);
    await signIn(page, judge, "/judge");
    await page.goto(`/judge/overturn-review?findingId=${id}`);

    const panel = page.locator("#ovr-panel");
    await panel.waitFor();
    expect(await panel.locator(".verdict-meta-chip", { hasText: "e2e-reviewer0@monsterrg.com" }).isVisible(), "the reviewer who confirmed the fail");
    expect(await panel.locator(".verdict-meta-chip", { hasText: judge }).isVisible(), "the judge who overturned it");
    expect(await page.getByText("Guest confirmed ownership at 2:10").isVisible(), "the auditor's appeal comment");
    expect(await page.locator(".queue-right").getByText("we do").isVisible(), "the transcript beside it, like the reviewer queue");
  }));

Deno.test("REQ-048 AMENDMENT: overturned questions sit at the top, and the judge's reason is not shown", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge, ["uphold", "overturn"]);
    await signIn(page, judge, "/judge");
    await page.goto(`/judge/overturn-review?findingId=${id}`);

    const names = await page.locator("#ovr-panel .failed-q-pill .failed-q-name").allInnerTexts();
    expect.eq(names[0], "Correct Dates", "the overturned question is first even though it is Q2");
    expect.eq(await page.getByText("Bot error").count(), 0, "no judge reason anywhere");
    expect(await page.locator(".verdict-question-header").getByText("Correct Dates").isVisible(), "and it is the question shown");

    await page.locator("#ovr-panel .failed-q-pill").nth(1).locator("button").click();
    await page.locator(".verdict-question-header", { hasText: "TimeShare Owner" }).waitFor();
    expect(await page.locator("#ovr-panel .verdict-footer").getByText("Upheld by the judge").isVisible(), "picking the upheld question shows it, with no call to make");
  }));

Deno.test("REQ-049: a judge reverses an overturn only with a note; the last call makes the appeal final", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge);
    const team = await login("judge");
    await signIn(page, team, "/judge");
    await page.goto(`/judge/overturn-review?findingId=${id}`);

    const footer = page.locator("#ovr-panel .verdict-footer");
    expect.eq(await footer.locator("button").count(), 2, "two options only");
    expect(await footer.getByRole("button", { name: "Keep Overturn" }).isVisible(), "Keep Overturn");
    await footer.getByRole("button", { name: "Reverse Overturn" }).click();

    const modal = page.locator(".ovr-reverse-modal");
    await modal.waitFor();
    expect(await modal.getByRole("button", { name: "Submit & Reverse" }).isDisabled(), "no comment, no reversal");
    expect.eq((await getAppeal(ORG, id))?.status, "pending", "nothing was decided");

    await modal.locator("textarea").fill("Guest only said they were thinking about one");
    await modal.getByRole("button", { name: "Submit & Reverse" }).click();
    await page.locator("#ovr-toast .toast").getByText(`Appeal ${id} is final`).waitFor();
    expect.eq(await page.locator("#ovr-panel").getByText(`Appeal ${id} is final`).count(), 0, "the confirmation is a toast, not in the info panel");

    const appeal = await getAppeal(ORG, id);
    expect.eq(appeal?.status, "complete", "the appeal closed");
    expect.eq(appeal?.overturnedCount, 0, "the reversed overturn counts as upheld");
    const decided = await getStored<Record<string, unknown>>("judge-decided", ORG, id, 0);
    expect.eq(decided?.reason, "Guest only said they were thinking about one", "the comment is the uphold reason the email shows");
  }));

Deno.test("REQ-049 AMENDMENT: Keep Overturn makes the overturn final", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge);
    await signIn(page, judge, "/judge");
    await page.goto(`/judge/overturn-review?findingId=${id}`);

    await page.locator("#ovr-panel .verdict-footer").getByRole("button", { name: "Keep Overturn" }).click();
    await page.locator("#ovr-toast .toast").getByText(`Appeal ${id} is final`).waitFor();
    expect.eq(await page.locator("#ovr-panel").getByText(`Appeal ${id} is final`).count(), 0, "the confirmation is a toast, not in the info panel");
    expect.eq((await getAppeal(ORG, id))?.overturnedCount, 1, "the overturn stands");
  }));

Deno.test("REQ-051 AMENDMENT: the on/off switch lives in Data Maintenance, not on the queue", (t) =>
  story(t, async ({ page, expect }) => {
    const admin = await login("admin");
    await signIn(page, admin, "/admin/dashboard");
    try {
      await page.goto("/judge/overturn-review");
      expect.eq(await page.locator(".ovr-toggle").count(), 0, "no switch on the queue page");

      await page.goto("/admin/dashboard");
      await page.locator(".sb-link[data-modal=maintenance-modal]").click();
      await page.locator("#maint-shell").getByRole("button", { name: "Overturn Review" }).click();
      const sw = page.locator("#ovr-switch");
      await sw.getByRole("button", { name: "Turn off" }).click();
      await sw.getByText("Off — overturns close and email right away").waitFor();
      expect(true, "switched off");

      const judge = await login("judge");
      const id = `e2e-ovr-off-${tag()}`;
      await saveFinding(ORG, {
        id, findingStatus: "finished", owner: "e2e-tm@monsterrg.com", completedAt: Date.now(),
        answeredQuestions: [{ header: "TimeShare Owner", answer: "No" }], record: { RecordId: "900301" },
      } as unknown as Parameters<typeof saveFinding>[1]);
      await saveAppeal(ORG, { findingId: id, appealedAt: Date.now(), status: "pending", auditor: "e2e-tm@monsterrg.com", appealedQuestions: ["0"] });
      await setStored("judge-audit-pending", ORG, [id], 1);
      await recordJudgeDecision(ORG, id, 0, "overturn", judge, "error");
      for (let i = 0; i < 100 && (await getAppeal(ORG, id))?.status !== "complete"; i++) await new Promise((r) => setTimeout(r, 100));
      expect.eq((await getAppeal(ORG, id))?.status, "complete", "with the queue off the overturn is final at once");

      await sw.getByRole("button", { name: "Turn on" }).click();
      await sw.getByText("On — overturned appeals wait for the team").waitFor();
      expect(true, "switched back on");
    } finally {
      await setOverturnReviewEnabled(ORG, true);
    }
  }));
