/** The VO dashboard (REQ-034..041): a login tied to one department's failed
 *  audits — VBA PM's go to vbapmvo@monsterrg.com — reviewed by a write-up
 *  instead of remediated, with the review showing up on the manager's queue.
 *
 *  Each story invents its own department name so stories never see each
 *  other's rows in the shared emulator project `serve` reads. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import { populateManagerQueue } from "@manager/domain/data/manager-repository/mod.ts";
import { voDefaultWindow } from "@core/business/tm-review/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];
const PASS = "e2e-pass-123";
const tag = () => crypto.randomUUID().slice(0, 6);

/** A failed audit for `dept`, queued for the manager, timed inside the VO
 *  dashboard's default window whatever day the suite runs on. */
async function failedAudit(dept: string, name: string, opts: { wgs?: boolean } = {}): Promise<string> {
  const id = `e2e-vo-${tag()}`;
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
      { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "", answer: "Yes" },
    ],
    completedAt: Date.now(),
    record: { RecordId: "900100", VoName: `${dept} - ${name}`, ActivatingOffice: dept, Shift: "PM", ...(opts.wgs ? { 460: "1" } : {}) },
    recordingId: "27694351",
    genieIds: ["27694351"],
    recordingIdField: "VoGenie",
    owner: "api",
  });
  await populateManagerQueue(ORG, id);
  const row = await getStored<Record<string, unknown>>("manager-queue", ORG, id);
  await setStored("manager-queue", ORG, [id], { ...row, completedAt: voDefaultWindow(Date.now()).since + 3_600_000 });
  return id;
}

async function login(role: "vo" | "manager" | "admin", dept?: string): Promise<string> {
  const email = `e2e-${role}-${tag()}@monsterrg.com`;
  await createUser(ORG, email, PASS, role);
  if (dept) await saveManagerScope(ORG, email, { departments: [dept], shifts: [] });
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

// deno-lint-ignore no-explicit-any
async function reviewRow(page: any, id: string, note: string): Promise<void> {
  await page.locator(`#vo-queue-table tr[data-finding-id="${id}"] button.vo-review-btn`).click();
  await page.locator("#vo-review-modal.open textarea[name=note]").fill(note);
  await page.locator("#vo-review-modal.open button[type=submit]").click();
  await page.locator(`#vo-reviewed-table tr[data-finding-id="${id}"]`).waitFor();
}

Deno.test("REQ-034: a VO login lands on its own dashboard showing only its department's failed audits", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const mine = await failedAudit(dept, "Dana Lee");
    const other = await failedAudit(`ODS ${tag()}`, "Sam Ortiz");
    const vo = await login("vo", dept);

    await signIn(page, vo, "/vo");
    expect.eq(await page.locator(".page-header h1").innerText(), "VO Dashboard", "its own dashboard");
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${mine}"]`).count(), 1, "its department's audit is there");
    expect.eq(await page.locator(`tr[data-finding-id="${other}"]`).count(), 0, "another department's audit is not");
    expect.eq(await page.getByRole("button", { name: "Remediate" }).count(), 0, "no Remediate anywhere");

    await page.goto("/manager");
    await page.waitForURL("**/vo");
    expect(page.url().endsWith("/vo"), "the manager portal sends a VO back to its dashboard");
  }));

Deno.test("REQ-035: Review takes a write-up, moves the audit to Reviewed, and nobody on the login can review it again", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);
    const second = await login("vo", dept);

    await signIn(page, vo, "/vo");
    await reviewRow(page, id, "Listened to the call, dates were read back wrong");
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${id}"]`).count(), 0, "gone from To Review");
    const done = page.locator(`#vo-reviewed-table tr[data-finding-id="${id}"]`);
    expect((await done.innerText()).includes("dates were read back wrong"), "the write-up shows on Reviewed");

    await page.goto("/api/logout");
    await signIn(page, second, "/vo");
    expect.eq(await page.locator(`#vo-reviewed-table tr[data-finding-id="${id}"]`).count(), 1, "reviewed for the whole login");
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${id}"]`).count(), 0, "not back on To Review");

    await page.goto(`/vo/audit/${id}`);
    expect.eq(await page.getByRole("button", { name: "Review" }).count(), 0, "the detail page offers no second review");
    expect((await page.locator(".vo-reviewed-stamp").innerText()).includes(vo), "it says who reviewed it");

    const res = await page.request.post(new URL("/api/vo/review", page.url()).href, { form: { findingId: id, note: "Trying again" } });
    expect.eq(res.status(), 409, "a second review is refused");
  }));

Deno.test("REQ-036: a reviewed audit's Remediated box ticks once the manager remediates", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);

    await signIn(page, vo, "/vo");
    await reviewRow(page, id, "Covered it");
    const box = () => page.locator(`#vo-reviewed-table tr[data-finding-id="${id}"] input[type=checkbox]`);
    expect.eq(await box().isChecked(), false, "not remediated yet");
    expect(await box().isDisabled(), "the VO can't tick it");

    const row = await getStored<Record<string, unknown>>("manager-queue", ORG, id);
    await setStored("manager-queue", ORG, [id], { ...row, status: "remediated", remediatedBy: "mgr@monsterrg.com", remediatedAt: Date.now(), notes: "Coached" });
    await page.reload();
    expect.eq(await box().isChecked(), true, "ticked after the manager remediated");
  }));

Deno.test("REQ-037: filing an appeal from the VO side takes the audit off the VO queue and the manager's queue", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);
    const mgr = await login("manager", dept);

    // The manager's page defaults to the last 7 days; the seeded audit sits at
    // the start of the VO window, which on a Monday is last week. All time.
    await signIn(page, mgr, "/manager");
    await page.goto("/manager?since=0");
    expect.eq(await page.locator(`#manager-queue-table tr[data-finding-id="${id}"]`).count(), 1, "on the manager's queue before the appeal");
    await page.goto("/api/logout");

    await signIn(page, vo, "/vo");
    await page.locator(`#vo-queue-table tr[data-finding-id="${id}"] td`).first().click();
    await page.waitForURL(`**/vo/audit/${id}**`);
    await page.getByRole("button", { name: "Appeal Decision" }).click();
    await page.locator(".appeal-confirm-row input[type=checkbox]").first().check();
    await page.locator(".appeal-confirm-submit").click();
    await page.getByText("Appeal Submitted!").waitFor();

    await page.goto("/vo");
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${id}"]`).count(), 0, "off the VO queue");
    expect(/appealed/i.test(await page.locator(`#vo-reviewed-table tr[data-finding-id="${id}"]`).innerText()), "shown as appealed");

    await page.goto("/api/logout");
    await signIn(page, mgr, "/manager");
    await page.goto("/manager?since=0");
    expect.eq(await page.locator(`#manager-queue-table tr[data-finding-id="${id}"]`).count(), 0, "off the manager's queue");
  }));

Deno.test("REQ-038: the manager sees Reviewed by TM ticked with the write-up, and can still remediate", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);
    const mgr = await login("manager", dept);

    await signIn(page, vo, "/vo");
    await reviewRow(page, id, "Played back the greeting with Dana");
    await page.goto("/api/logout");

    await signIn(page, mgr, "/manager");
    await page.goto("/manager?since=0");
    expect(((await page.locator("#manager-queue-table thead").textContent()) ?? "").includes("Reviewed by TM"), "the new column");
    const row = page.locator(`#manager-queue-table tr[data-finding-id="${id}"]`);
    expect(await row.locator(".tm-review-cell input[type=checkbox]").isChecked(), "ticked");
    await row.locator(".tm-review-cell").hover();
    expect((await row.locator(".tm-review-cell").innerText()).includes("Played back the greeting"), "the write-up is readable");
    expect.eq(await row.getByRole("button", { name: "Remediate" }).count(), 1, "Remediate still there");
    await row.getByRole("button", { name: "Remediate" }).click();
    expect(await page.locator("#remediate-modal").isVisible(), "and still opens");
  }));

Deno.test("REQ-039: an admin reaches any VO login's dashboard from VO View", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);
    const admin = await login("admin");

    await signIn(page, admin, "/admin/dashboard");
    await page.goto("/vo");
    expect.eq(await page.locator(".page-header h1").innerText(), "VO View", "the picker");
    await page.locator(`a.vo-login[data-email="${vo}"]`).click();
    await page.waitForURL(`**/vo?as=${encodeURIComponent(vo)}`);
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${id}"]`).count(), 1, "that login's queue");
  }));

Deno.test("REQ-040: the only filters are dates, team member and WGS/MCC, with no Audit History, and the dates start at the most recent Monday", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const plain = await failedAudit(dept, "Dana Lee");
    const sold = await failedAudit(dept, "Kim Park", { wgs: true });
    const vo = await login("vo", dept);

    await signIn(page, vo, "/vo");
    const labels = (await page.locator("#vo-filters label.vo-filter-label").allTextContents()).map((l: string) => l.trim());
    expect.eq(JSON.stringify(labels), JSON.stringify(["Window", "Sale"]), "date window + sale boxes in the bar");
    expect.eq(await page.locator("#vo-filters select").count(), 0, "no question or sort dropdown");
    expect.eq(await page.getByText("Audit History").count(), 0, "no Audit History");
    expect.eq(Number(await page.locator("#vo-since").inputValue()), voDefaultWindow(Date.now()).since, "starts at the most recent Monday");

    await page.locator("#vo-member-buttons button", { hasText: "Kim Park" }).click();
    await page.locator(`#vo-queue-table tr[data-finding-id="${plain}"]`).waitFor({ state: "detached" });
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${sold}"]`).count(), 1, "team member picker narrows");
    await page.locator("#vo-member-buttons button", { hasText: "All" }).click();
    await page.locator(`#vo-queue-table tr[data-finding-id="${plain}"]`).waitFor();

    await page.locator("#vo-filters input[name=wgs]").check();
    await page.locator(`#vo-queue-table tr[data-finding-id="${plain}"]`).waitFor({ state: "detached" });
    expect.eq(await page.locator(`#vo-queue-table tr[data-finding-id="${sold}"]`).count(), 1, "WGS box narrows");
  }));

Deno.test("REQ-041: the VO dashboard and audit page never say 'agent'", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);

    await signIn(page, vo, "/vo");
    await page.locator(`#vo-queue-table tr[data-finding-id="${id}"] button.vo-review-btn`).click();
    expect(!/agent/i.test(await page.locator("body").innerText()), "dashboard text");
    await page.goto(`/vo/audit/${id}`);
    expect(!/agent/i.test(await page.locator("body").innerText()), "audit page text");
  }));

Deno.test("REQ-040 AMENDMENT: the filter bar spreads across the top — date presets and range on one row, Sale at the right edge", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);

    await signIn(page, vo, "/vo");
    const presets = await page.locator("#vo-filters .drp-presets").boundingBox();
    const range = await page.locator("#vo-filters .drp-trigger").boundingBox();
    const sale = await page.locator("#vo-filters .vo-sale").boundingBox();
    const bar = await page.locator("#vo-filters").boundingBox();
    expect(presets && range && Math.abs((presets.y + presets.height / 2) - (range.y + range.height / 2)) < 12,
      `presets and date range share a row (${JSON.stringify({ presets, range })})`);
    expect(range && presets && range.x > presets.x + presets.width, "the date range sits beside the presets");
    expect(sale && bar && (bar.x + bar.width) - (sale.x + sale.width) < 24,
      `Sale is pushed to the right edge (${JSON.stringify({ sale, bar })})`);
  }));

Deno.test("REQ-035 AMENDMENT: the review box only stretches downward, never past the modal", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee");
    const vo = await login("vo", dept);

    await signIn(page, vo, "/vo");
    await page.locator(`#vo-queue-table tr[data-finding-id="${id}"] button.vo-review-btn`).click();
    const box = page.locator("#vo-review-modal.open textarea[name=note]");
    await box.waitFor();
    expect.eq(await box.evaluate((el: { ownerDocument: { defaultView: { getComputedStyle(e: unknown): { resize: string } } } }) =>
      el.ownerDocument.defaultView.getComputedStyle(el).resize), "vertical", "resizes vertically only");

    // Drag the corner handle 400px right and 120px down.
    const b = (await box.boundingBox())!;
    await page.mouse.move(b.x + b.width - 3, b.y + b.height - 3);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width + 400, b.y + b.height + 120, { steps: 8 });
    await page.mouse.up();
    await box.click();

    const after = (await box.boundingBox())!;
    const modal = (await page.locator("#vo-review-modal.open .modal").boundingBox())!;
    expect(after.x + after.width <= modal.x + modal.width, `the box stays inside the modal (${JSON.stringify({ after, modal })})`);
    expect(after.height > b.height, "but it can still be made taller");
  }));
