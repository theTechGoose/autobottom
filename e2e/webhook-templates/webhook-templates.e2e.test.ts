/** The webhook config picks the templates package audits use (REQ-031): every
 *  email tab gets a package template, and Judge Finish a package dismissal
 *  template, saved next to the existing ones. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { getWebhookConfig } from "@admin/domain/data/admin-repository/mod.ts";
import { saveEmailTemplate } from "@reporting/domain/data/email-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof createUser>[0];

Deno.test("REQ-031: the webhook config picks a package template, and a package dismissal template on Judge Finish", (t) =>
  story(t, async ({ page, expect }) => {
    const tag = crypto.randomUUID().slice(0, 6);
    const internal = await saveEmailTemplate(ORG, { name: `Audit Result ${tag}`, subject: "Audit for: {{resId}} {{passedOrFailed}}", html: "<p>{{resLink}}</p>" });
    const partner = await saveEmailTemplate(ORG, { name: `Audit Result (Package) ${tag}`, subject: "Audit for: {{subjectGuest}} {{passedOrFailed}}", html: "<p>{{guestName}}</p>" });
    const verdict = await saveEmailTemplate(ORG, { name: `Appeal Result ${tag}`, subject: "Your Appeal for {{resId}}: {{finalScore}}", html: "<p/>" });
    const pkgDismissal = await saveEmailTemplate(ORG, { name: `Appeal Dismissed (Package) ${tag}`, subject: "Your Appeal was Dismissed", html: "<p/>" });

    const email = `e2e-admin-${tag}@monsterrg.com`;
    await createUser(ORG, email, "e2e-pass-123", "admin");
    await page.goto("/login");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "e2e-pass-123");
    await page.click("button[type=submit]");
    await page.waitForURL("**/admin/dashboard");

    // Audit Complete is the tab the modal opens on.
    await page.locator(".sb-link[data-modal=webhook-modal]").click();
    const modal = page.locator("#webhook-modal-content");
    await modal.getByText("Package Email Template").waitFor();
    await modal.locator("select[name=emailTemplateId]").selectOption(internal.id);
    await modal.locator("select[name=packageEmailTemplateId]").selectOption(partner.id);
    await modal.getByRole("button", { name: "Save" }).click();
    await modal.locator("#wh-save-msg").getByText("Saved").waitFor();

    const terminate = await getWebhookConfig(ORG, "terminate");
    expect(terminate?.emailTemplateId === internal.id, "Audit Complete keeps the date-leg template");
    expect(terminate?.packageEmailTemplateId === partner.id, "Audit Complete saves the package template");

    await modal.getByRole("button", { name: "Judge Finish" }).click();
    await modal.getByText("Package Dismissal Email Template").waitFor();
    await modal.locator("select[name=emailTemplateId]").selectOption(verdict.id);
    await modal.locator("select[name=packageDismissalTemplateId]").selectOption(pkgDismissal.id);
    await modal.getByRole("button", { name: "Save" }).click();
    await modal.locator("#wh-save-msg").getByText("Saved").waitFor();

    const judge = await getWebhookConfig(ORG, "judge");
    expect(judge?.emailTemplateId === verdict.id, "Judge Finish keeps the verdict template");
    expect(judge?.packageDismissalTemplateId === pkgDismissal.id, "Judge Finish saves the package dismissal template");
    expect(!judge?.packageEmailTemplateId, "an unpicked package template is left unset, so it falls back");

    // Reopening the tab shows what was saved.
    await modal.getByRole("button", { name: "Audit Complete" }).click();
    await modal.getByText("Package Email Template").waitFor();
    expect(await modal.locator("select[name=packageEmailTemplateId]").inputValue() === partner.id, "the saved package template is selected on reopen");
    // Stamp a closing frame on the picker itself, showing the saved package template.
    await modal.getByText("Package Email Template").click();
  }));
