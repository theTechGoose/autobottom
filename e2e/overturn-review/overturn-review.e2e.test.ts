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

/** A reviewed audit with two failed questions, appealed on both, then judged:
 *  the judge overturns Q0 and upholds Q1 (a mixed appeal). */
async function judgedAppeal(judge: string): Promise<string> {
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
  await recordJudgeDecision(ORG, id, 0, "overturn", judge, "error");
  await recordJudgeDecision(ORG, id, 1, "uphold", judge, "Dates were wrong on the call");
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
    const panel = page.locator("#ovr-panel");
    expect(await panel.locator(`[data-qi="0"]`).getByText("Overturned by judge").isVisible(), "the overturn is held");
    expect(await panel.locator(`[data-qi="1"]`).getByText("Upheld by judge").isVisible(), "and the upheld question rides along with it");
  }));

Deno.test("REQ-048: the Overturn Review page shows the reviewer who failed it, the judge who passed it, and the transcript", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge);
    await signIn(page, judge, "/judge");
    await page.goto(`/judge/overturn-review?findingId=${id}`);

    const q0 = page.locator(`#ovr-panel [data-qi="0"]`);
    await q0.waitFor();
    expect(await q0.getByText("e2e-reviewer0@monsterrg.com").isVisible(), "the reviewer who confirmed the fail");
    expect(await q0.getByText(judge).isVisible(), "the judge who overturned it");
    expect(await q0.getByText("Bot error").isVisible(), "and why");
    expect(await page.getByText("Guest confirmed ownership at 2:10").isVisible(), "the auditor's appeal comment");
    expect(await page.locator(".queue-right").getByText("we do").isVisible(), "the transcript beside it, like the judge queue");
  }));

Deno.test("REQ-049: a judge reverses an overturn only with a note; the last call makes the appeal final", (t) =>
  story(t, async ({ page, expect }) => {
    const judge = await login("judge");
    const id = await judgedAppeal(judge);
    const team = await login("judge");
    await signIn(page, team, "/judge");
    await page.goto(`/judge/overturn-review?findingId=${id}`);

    const q0 = page.locator(`#ovr-panel [data-qi="0"]`);
    await q0.getByRole("button", { name: "Reverse — uphold the fail" }).click();
    expect.eq(await q0.locator("textarea[name=note]").evaluate((el: { validity: { valueMissing: boolean } }) => el.validity.valueMissing), true, "an empty note is refused");
    expect.eq((await getAppeal(ORG, id))?.status, "pending", "nothing was decided");

    await q0.locator("textarea[name=note]").fill("Guest only said they were thinking about one");
    await q0.getByRole("button", { name: "Reverse — uphold the fail" }).click();
    await page.getByText(`Appeal ${id} is final`).waitFor();
    expect(true, "the banner says the appeal is final");

    const appeal = await getAppeal(ORG, id);
    expect.eq(appeal?.status, "complete", "the appeal closed");
    expect.eq(appeal?.overturnedCount, 0, "the reversed overturn counts as upheld");
    const decided = await getStored<Record<string, unknown>>("judge-decided", ORG, id, 0);
    expect.eq(decided?.reason, "Guest only said they were thinking about one", "the note is the uphold reason the email shows");
  }));

Deno.test("REQ-051: an admin can switch Overturn Review off, and overturns then close right away", (t) =>
  story(t, async ({ page, expect }) => {
    const admin = await login("admin");
    await signIn(page, admin, "/admin/dashboard");
    await page.goto("/judge/overturn-review");
    try {
      await page.locator(".ovr-toggle", { hasText: "Turn off" }).click();
      await page.getByText("Overturn Review is off").waitFor();
      expect(true, "the page says the queue is off");

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

      await page.locator(".ovr-toggle", { hasText: "Turn on" }).click();
      await page.locator(".ovr-toggle", { hasText: "Turn off" }).waitFor();
      expect.eq(await page.getByText("Overturn Review is off").count(), 0, "switched back on");
    } finally {
      await setOverturnReviewEnabled(ORG, true);
    }
  }));
