/** The wording and behaviour of the three appeal modals (REQ-024..028), from
 *  the user's marked-up screenshots: each modal says when to use it, there is
 *  no em dash, the Genie × is visible, Direct Upload warns to trim and takes a
 *  dropped file, and Appeal Decision's switch buttons sit centred. */
import { story } from "#shots";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

async function failedAudit(): Promise<string> {
  const id = "e2e-modals-" + crypto.randomUUID().slice(0, 8);
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
      { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "", answer: "Yes" },
    ],
    completedAt: Date.now(),
    record: { RecordId: "900004", VoName: "DS MB - Demo Agent" },
    recordingId: "27694351",
    genieIds: ["27694351"],
    recordingIdField: "VoGenie",
    owner: "api",
  });
  return id;
}

/** Let the entrance animation settle and click the inert title, so the frame
 *  shows the open modal. */
// deno-lint-ignore no-explicit-any
async function showModal(page: any): Promise<void> {
  const title = page.locator(".appeal-overlay-box .appeal-reaudit-title, .appeal-overlay-box .appeal-confirm-title").first();
  await title.waitFor();
  await page.waitForTimeout(400);
  await title.click();
}

/** Everything a user reads in the open modal: its text plus every placeholder. */
// deno-lint-ignore no-explicit-any
async function modalText(page: any): Promise<string> {
  const box = page.locator(".appeal-overlay-box");
  const placeholders = await box.locator("[placeholder]").evaluateAll(
    // deno-lint-ignore no-explicit-any
    (els: any[]) => els.map((e) => e.getAttribute("placeholder")).join("\n"),
  );
  return (await box.innerText()) + "\n" + placeholders;
}

Deno.test(`REQ-024: each modal opens with its own "use this when" line, says Wrong Genie, and shows no em dash`, (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);

    await page.getByRole("button", { name: "Add Genie" }).click();
    await showModal(page);
    const genie = await modalText(page);
    expect(/Use this when multiple Genies were used for the verification, or the wrong Genie was audited\./i.test(genie), "Add Genie leads with when to use it");
    expect(/Wrong Genie:/.test(genie), "the overwrite bullet is labelled Wrong Genie");
    expect(!genie.includes("—"), "no em dash in Add Genie");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Direct Upload" }).click();
    await showModal(page);
    const upload = await modalText(page);
    expect(/Use this when the verification was not captured on a Genie\./i.test(upload), "Direct Upload leads with when to use it");
    expect(/Verification is captured on a Genie\?\s*Use Add Genie/.test(upload), "the hop back reads Verification is captured on a Genie? Use Add Genie");
    expect(!upload.includes("—"), "no em dash in Direct Upload");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    const appeal = await modalText(page);
    expect(/Use this when you think the verification was graded incorrectly\./i.test(appeal), "Appeal Decision leads with when to use it");
    expect(!appeal.includes("—"), "no em dash in Appeal Decision");
  }));

Deno.test("REQ-025: every Genie row shows its × and it works on the last one too", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);
    await page.getByRole("button", { name: "Add Genie" }).click();
    await showModal(page);

    const x = page.locator(".recording-remove");
    expect(await x.first().isVisible(), "the × shows next to the audit's only Genie");
    await page.getByRole("button", { name: "+ Add Another" }).click();
    expect.eq(await x.count(), 2, "each row has its own ×");
    expect(await x.nth(1).isVisible(), "and the new row's × is visible too");
    await x.nth(1).click();
    expect.eq(await page.locator(".recording-input").count(), 1, "× removes that row");
    await x.first().click();
    expect.eq(await page.locator(".recording-input").first().inputValue(), "", "× on the last row clears it so a different Genie can be typed");
  }));

Deno.test("REQ-026: Direct Upload warns to trim the audio to the verification, and never calls trimming optional", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);
    await page.getByRole("button", { name: "Direct Upload" }).click();
    await showModal(page);

    const warn = page.locator(".appeal-warn");
    expect(await warn.isVisible(), "a warning callout is shown");
    const text = await warn.innerText();
    expect(text.includes("⚠"), "with a warning sign");
    expect(/Please trim the audio to the correct start and end times of the verification\. Not doing this will result in AI errors\./i.test(text), "saying to trim to the verification or the AI makes errors");

    const file = await Deno.makeTempFile({ suffix: ".mp3" });
    await Deno.writeFile(file, new Uint8Array(2048));
    await page.locator("input[type=file]").setInputFiles(file);
    await page.locator(".snip-editor").waitFor();
    expect(!/optional/i.test(await page.locator(".appeal-overlay-box").innerText()), "nothing in the modal calls trimming optional");
    await Deno.remove(file);
  }));

Deno.test("REQ-027: a file dropped on the Direct Upload modal is selected, and clicking still opens the picker", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);
    await page.getByRole("button", { name: "Direct Upload" }).click();
    await showModal(page);

    const area = page.locator(".upload-area");
    expect(/drag/i.test(await area.innerText()), "the drop area says a file can be dragged in");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), area.click()]);
    expect(!!chooser, "clicking the area opens the file picker");
    await page.keyboard.press("Escape");
    if (!(await area.isVisible())) {
      await page.getByRole("button", { name: "Direct Upload" }).click();
      await showModal(page);
    }

    const dt = await page.evaluateHandle(() => {
      // deno-lint-ignore no-explicit-any
      const d = new (globalThis as any).DataTransfer();
      d.items.add(new File([new Uint8Array(2048)], "verification.mp3", { type: "audio/mpeg" }));
      return d;
    });
    await area.dispatchEvent("dragenter", { dataTransfer: dt });
    await area.dispatchEvent("dragover", { dataTransfer: dt });
    expect(await page.locator(".appeal-overlay-box.drag-over").count() === 1, "the modal highlights while a file is over it");
    await area.dispatchEvent("drop", { dataTransfer: dt });
    await page.locator(".file-info-name").waitFor();
    expect.eq(await page.locator(".file-info-name").innerText(), "verification.mp3", "the dropped file is selected");
    expect(await page.locator(".fork-submit").isEnabled(), "and Submit Re-Audit is ready");
  }));

Deno.test("REQ-028: Appeal Decision's Add Genie instead / Direct Upload instead sit centred on their card", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);
    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);

    const card = await page.locator(".appeal-redirect").boundingBox();
    const a = await page.getByRole("button", { name: "Add Genie instead" }).boundingBox();
    const b = await page.getByRole("button", { name: "Direct Upload instead" }).boundingBox();
    const cardMid = card.x + card.width / 2;
    const pairMid = (a.x + (b.x + b.width)) / 2;
    expect(Math.abs(cardMid - pairMid) < 4, `the pair is centred on the card (card ${cardMid}, pair ${pairMid})`);
  }));

/** Computed font size in px of the first element matching `sel` in the open modal. */
// deno-lint-ignore no-explicit-any
async function fontPx(page: any, sel: string): Promise<number> {
  return await page.locator(`.appeal-overlay-box ${sel}`).first().evaluate(
    // deno-lint-ignore no-explicit-any
    (el: any) => parseFloat((globalThis as any).getComputedStyle(el).fontSize),
  );
}

Deno.test("REQ-029: the explainer text in all three modals is 14px, two up from 12", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await failedAudit();
    await page.goto(`/audit/report?id=${id}`);

    await page.getByRole("button", { name: "Add Genie" }).click();
    await showModal(page);
    expect.eq(await fontPx(page, ".appeal-explain"), 14, "Add Genie's explainer");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Direct Upload" }).click();
    await showModal(page);
    expect.eq(await fontPx(page, ".appeal-explain"), 14, "Direct Upload's explainer");
    expect.eq(await fontPx(page, ".appeal-warn"), 14, "the trim warning");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await showModal(page);
    expect.eq(await fontPx(page, ".appeal-confirm-body"), 14, "Appeal Decision's explainer");
    expect.eq(await fontPx(page, ".appeal-redirect-text"), 14, "the missing-audio callout");
  }));
