/** The three appeal buttons — Add Genie, Direct Upload, Appeal Decision
 *  (REQ-017..020).
 *
 *  Agents filed judge appeals to say the audio cut out or the second genie was
 *  in the notes, because the single File Appeal button hid the new-audio paths
 *  behind a choice card. These stories seed a finished, failed audit into the
 *  emulator project `serve` reads and drive the public report (and the manager
 *  remediation page) the way an agent or manager does.
 *
 *  The two re-audit submits answer from a stubbed route: the real ones enqueue
 *  the new audit on QStash, which the gate never touches. The judge appeal is
 *  filed for real. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

/** A finished audit with one failed question, on two genies. */
async function failedAudit(): Promise<string> {
  const id = "e2e-actions-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
      { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "", answer: "Yes" },
    ],
    completedAt: Date.now(),
    record: { RecordId: "900003", VoName: "DS MB - Demo Agent" },
    recordingId: "27694351",
    genieIds: ["27694351"],
    recordingIdField: "VoGenie",
    owner: "api",
  });
  return id;
}

const BUTTONS = ["Add Genie", "Direct Upload", "Appeal Decision"];

// deno-lint-ignore no-explicit-any
async function buttonOrder(page: any, scope: string): Promise<string[]> {
  return await page.locator(`${scope} .appeal-trigger button`).allInnerTexts();
}

/** Frames are taken per action, and a click's frame lands mid-way through the
 *  modal's entrance animation. Let it settle, then click its (inert) title so
 *  the evidence shows the open modal. */
// deno-lint-ignore no-explicit-any
async function showModal(page: any): Promise<void> {
  const title = page.locator(".appeal-overlay-box .appeal-reaudit-title, .appeal-overlay-box .appeal-confirm-title").first();
  await title.waitFor();
  await page.waitForTimeout(400);
  await title.click();
}

Deno.test("REQ-017: the report shows Add Genie, Direct Upload and Appeal Decision centred under the score, each opening its own modal", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);

    expect.eq(JSON.stringify(await buttonOrder(page, "body")), JSON.stringify(BUTTONS), "three buttons, new-audio paths first");
    expect.eq(await page.getByRole("button", { name: "File Appeal" }).count(), 0, "the old single button is gone");

    const score = await page.locator(".rpt-score").boundingBox();
    const row = await page.locator(".appeal-trigger").boundingBox();
    expect(score && row && row.y > score.y, "the buttons sit under the score");
    const viewport = page.viewportSize();
    const centre = row ? row.x + row.width / 2 : 0;
    expect(viewport && Math.abs(centre - viewport.width / 2) < viewport.width * 0.1, "and are centred on the page");

    await page.getByRole("button", { name: "Add Genie" }).click();
    await showModal(page);
    expect(await page.locator(".recording-input").count() > 0, "Add Genie opens the genie form directly");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Direct Upload" }).click();
    await showModal(page);
    expect(await page.locator(".upload-area").isVisible(), "Direct Upload opens the file picker directly");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    expect(await page.locator(".appeal-confirm-list").isVisible(), "Appeal Decision opens the question list directly");
  }));

Deno.test("REQ-017: the manager remediation topbar shows the same three buttons", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    const email = `e2e-admin-${crypto.randomUUID().slice(0, 8)}@monsterrg.com`;
    await createUser(ORG, email, "e2e-pass-123", "admin");

    await page.goto("/login");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "e2e-pass-123");
    await page.click("button[type=submit]");
    await page.waitForURL("**/admin/dashboard");

    await page.goto(`/manager/remediate/${id}`);
    await page.locator(".appeal-trigger--inline").waitFor();
    expect.eq(JSON.stringify(await buttonOrder(page, "body")), JSON.stringify(BUTTONS), "same labels, same order");
    await page.getByRole("button", { name: "Add Genie" }).click();
    await showModal(page);
    expect(await page.locator(".recording-input").count() > 0, "and they open the same modals");
  }));

Deno.test("REQ-018: each modal explains what its path does — Add Genie says the original can be overwritten and more can be added", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);

    await page.getByRole("button", { name: "Add Genie" }).click();
    await showModal(page);
    const genie = await page.locator(".appeal-overlay-box").innerText();
    expect(/audio cut out/i.test(genie), "Add Genie says when to use it");
    expect(/\+ Add Another/.test(genie) && /joined/i.test(genie), "it explains adding more genies joins them into one call");
    expect(/overwrit/i.test(genie) && /different recording/i.test(genie), "it explains the original genie can be overwritten");
    expect(/new audit/i.test(genie), "it says submitting makes a new audit");
    expect.eq(await page.locator(".recording-input").first().inputValue(), "27694351", "the form still starts with the audit's genie");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Direct Upload" }).click();
    await showModal(page);
    const upload = await page.locator(".appeal-overlay-box").innerText();
    expect(/isn.t in Genie/i.test(upload), "Direct Upload says it is for audio that isn't in Genie");
    expect(/trim/i.test(upload) && /new audit/i.test(upload), "it explains trimming and that a new audit runs");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    const appeal = await page.locator(".appeal-overlay-box").innerText();
    expect(/judge/i.test(appeal) && /this audit.s recording/i.test(appeal), "Appeal Decision says a judge re-hears this audit's recording only");
  }));

Deno.test("REQ-019: Appeal Decision says a judge can't hear missing audio and switches straight to Add Genie or Direct Upload", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    const box = page.locator(".appeal-overlay-box");
    expect(/A judge can.t hear audio that isn.t there/i.test(await box.innerText()), "the missing-audio line is there");

    await box.getByRole("button", { name: "Add Genie instead" }).click();
    await showModal(page);
    expect(await page.locator(".recording-input").count() > 0, "the button switches to the Add Genie modal");
    expect.eq(await page.locator(".appeal-confirm-list").count(), 0, "and the Appeal Decision modal is closed");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    await page.locator(".appeal-overlay-box").getByRole("button", { name: "Direct Upload instead" }).click();
    await showModal(page);
    expect(await page.locator(".upload-area").isVisible(), "the other button switches to Direct Upload");
  }));

Deno.test("REQ-020: filing an Appeal Decision replaces all three buttons with Appeal Filed", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    await page.locator(".appeal-confirm-row input[type=checkbox]").first().check();
    await page.locator(".appeal-confirm-submit").click();
    await page.getByText("Appeal Submitted!").waitFor();
    await page.getByRole("button", { name: "Close" }).click();

    expect(await page.getByRole("button", { name: "Appeal Filed" }).isDisabled(), "one locked Appeal Filed pill");
    expect.eq((await buttonOrder(page, "body")).length, 1, "the three buttons are gone");

    await page.reload();
    expect(await page.getByRole("button", { name: "Appeal Filed" }).isDisabled(), "and it stays locked after a refresh");
    expect.eq((await buttonOrder(page, "body")).length, 1, "still only the one pill");
  }));

Deno.test("REQ-020: a submitted Add Genie or Direct Upload replaces all three buttons with View New Report", (t) =>
  story(t, async ({ page, expect }) => {
    for (const path of ["Add Genie", "Direct Upload"]) {
      const id = await failedAudit();
      const newId = id + "-new";
      await page.route("**/api/audit/appeal/*-recording", (r: { fulfill(o: unknown): Promise<void> }) =>
        r.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, newFindingId: newId, reportUrl: `/audit/report?id=${newId}`, appealType: "additional-recording" }),
        }));
      await page.goto(`/audit/report?id=${id}`);

      await page.getByRole("button", { name: path }).click();
      await showModal(page);
      if (path === "Add Genie") {
        await page.getByRole("button", { name: "+ Add Another" }).click();
        await page.locator(".recording-input").nth(1).fill("27694459");
      } else {
        const file = await Deno.makeTempFile({ suffix: ".mp3" });
        await Deno.writeFile(file, new Uint8Array(1024));
        await page.locator("input[type=file]").setInputFiles(file);
        await Deno.remove(file);
      }
      await page.locator(".fork-submit").click();
      await page.getByText("Audit Re-submitted!").waitFor();
      await page.locator(".appeal-overlay-box").getByRole("button", { name: "Close" }).click();

      const link = page.locator(".appeal-trigger a");
      expect.eq(await link.innerText(), "View New Report", `${path}: one View New Report link`);
      expect.eq(await link.getAttribute("href"), `/audit/report?id=${newId}`, `${path}: it opens the new audit`);
      expect.eq((await buttonOrder(page, "body")).length, 0, `${path}: the three buttons are gone`);
      await page.unroute("**/api/audit/appeal/*-recording");
    }
  }));
