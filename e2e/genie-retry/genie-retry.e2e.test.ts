/** Data Maintenance → Genie Retry re-runs the audits that finished as
 *  "Invalid Genie" (REQ-009).
 *
 *  In prod the button found 96 audits and queued none: every tick died inside
 *  the reset before anything was requeued. This story seeds Invalid Genie
 *  audits into the emulator project `serve` reads, logs in as an admin, and
 *  presses the button the way an operator does, then waits for the run to
 *  actually put audits in flight. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { writeAuditDoneIndex } from "@audit/domain/data/stats-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

/** A finished audit whose recording could not be downloaded. */
async function invalidGenieAudit(i: number): Promise<void> {
  const id = "e2e-genie-retry-" + crypto.randomUUID().slice(0, 8);
  const completedAt = Date.now() - 60_000 + i * 1000;
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    rawTranscript: "Invalid Genie",
    completedAt,
    record: { RecordId: `90010${i}`, VoName: "DS MB - Demo Agent" },
    recordingId: `2769947${i}`,
    recordingIdField: "VoGenie",
    owner: "api",
  });
  await writeAuditDoneIndex(ORG, {
    findingId: id,
    completedAt,
    completed: true,
    reason: "invalid_genie",
    recordId: `90010${i}`,
    recordingId: `2769947${i}`,
    voName: "DS MB - Demo Agent",
  } as Parameters<typeof writeAuditDoneIndex>[1]);
}

Deno.test("REQ-009: Find & re-run invalid genies puts the window's Invalid Genie audits back in flight", (t) =>
  story(t, async ({ page, expect }) => {
    const email = `e2e-admin-${crypto.randomUUID().slice(0, 8)}@monsterrg.com`;
    await createUser(ORG, email, "e2e-pass-123", "admin");
    for (let i = 0; i < 3; i++) await invalidGenieAudit(i);

    await page.goto("/login");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "e2e-pass-123");
    await page.click("button[type=submit]");
    await page.waitForURL("**/admin/dashboard");

    await page.getByText("Data Maintenance", { exact: true }).first().click();
    await page.getByRole("button", { name: "Genie Retry" }).click();

    const today = new Date().toISOString().slice(0, 10);
    await page.fill("input[name=since]", today);
    await page.fill("input[name=until]", today);
    page.once("dialog", (d: { accept(): Promise<void> }) => d.accept());
    await page.getByRole("button", { name: "Find & re-run invalid genies" }).click();

    const msg = page.locator("#genie-retry-msg");
    await msg.getByText(/Re-running audits/i).waitFor();
    // The first tick runs 4s after the bar appears; it must requeue a batch.
    await msg.getByText(/Re-running audits… [1-9]\d* in flight/i).waitFor({ timeout: 20_000 });
    // Frames are taken per action, so click the progress card to stamp one
    // showing the audits in flight (the card only polls on load, not click).
    await msg.click();
    const text = await msg.innerText();
    expect(/Re-running audits… [1-9]\d* in flight/i.test(text), "the run has audits in flight, not 0");
    expect(!/not found/i.test(text), "the run was not lost between ticks");
  }));
