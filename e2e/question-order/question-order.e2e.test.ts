/** Department question order (REQ-053..056): a manager arranges the worst-fails
 *  list on the Configure tab, the remediation queue lists the worst failed
 *  questions first (checkbox on by default; the Sort dropdown releases it), and
 *  the VO dashboard for that department follows the same list without being
 *  able to change it.
 *
 *  Each story invents its own department names so stories never see each
 *  other's rows or lists in the shared emulator project `serve` reads. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import { populateManagerQueue } from "@manager/domain/data/manager-repository/mod.ts";
import { DEFAULT_QUESTION_ORDER, severityColor } from "@core/business/question-order/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];
const PASS = "e2e-pass-123";
const tag = () => crypto.randomUUID().slice(0, 6);
const N = DEFAULT_QUESTION_ORDER.length;
const HOUR = 3_600_000;

/** A failed audit for `dept` that failed exactly `failed`, queued for the
 *  manager, `hoursAgo` old (inside every default window). */
async function failedAudit(dept: string, name: string, failed: string[], hoursAgo: number): Promise<string> {
  const id = `e2e-qo-${tag()}`;
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [
      ...failed.map((header) => ({ header, populated: `${header}?`, thinking: "Missed", defense: "", answer: "No" })),
      { header: "Phone Number", populated: "Phone confirmed?", thinking: "Confirmed", defense: "", answer: "Yes" },
    ],
    completedAt: Date.now() - hoursAgo * HOUR,
    record: { RecordId: "900200", VoName: `${dept} - ${name}`, ActivatingOffice: dept, Shift: "PM" },
    recordingId: "27694351",
    genieIds: ["27694351"],
    recordingIdField: "VoGenie",
    owner: "api",
  });
  await populateManagerQueue(ORG, id);
  const row = await getStored<Record<string, unknown>>("manager-queue", ORG, id);
  await setStored("manager-queue", ORG, [id], { ...row, completedAt: Date.now() - hoursAgo * HOUR });
  return id;
}

async function login(role: "vo" | "manager" | "admin", depts: string[] = []): Promise<string> {
  const email = `e2e-qo-${role}-${tag()}@monsterrg.com`;
  await createUser(ORG, email, PASS, role);
  if (depts.length) await saveManagerScope(ORG, email, { departments: depts, shifts: [] });
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
const boxes = (page: any) => page.locator(".qo-item");
// deno-lint-ignore no-explicit-any
const names = async (page: any): Promise<string[]> =>
  // deno-lint-ignore no-explicit-any
  await page.locator(".qo-item").evaluateAll((els: any[]) => els.map((e) => e.getAttribute("data-question") ?? ""));
// deno-lint-ignore no-explicit-any
const queueIds = async (page: any): Promise<string[]> =>
  await page.locator("#manager-queue-table tr[data-finding-id]").evaluateAll(
    // deno-lint-ignore no-explicit-any
    (rows: any[]) => rows.map((r) => r.getAttribute("data-finding-id") ?? ""),
  );

/** `expect.eq` compares with `!==`, so lists are compared as JSON. */
// deno-lint-ignore no-explicit-any
const eq = (expect: any, got: unknown, want: unknown, msg: string) => expect.eq(JSON.stringify(got), JSON.stringify(want), msg);

/** Wait until the queue's top row is `id` (after an htmx refresh). */
// deno-lint-ignore no-explicit-any
async function firstRowIs(page: any, id: string): Promise<void> {
  await page.waitForFunction(
    `document.querySelector("#manager-queue-table tr[data-finding-id]")?.getAttribute("data-finding-id") === ${JSON.stringify(id)}`,
  );
}

Deno.test("REQ-053: a manager opens Configure, drags a question up the red-to-green list, and the order sticks", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const mgr = await login("manager", [dept]);
    // Tall enough that all 25 boxes are on screen: a drag that has to scroll
    // mid-gesture starts on whichever box ends up under the pointer.
    await page.setViewportSize({ width: 1400, height: 1700 });
    await signIn(page, mgr, "/manager");

    await page.click("a.sb-link[href='/manager/configure'], a[href='/manager/configure']");
    await page.waitForURL("**/manager/configure");
    eq(expect, await page.locator(".page-header h1").innerText(), "Configure question order", "the Configure tab's page");
    await boxes(page).first().waitFor();
    eq(expect, await names(page), [...DEFAULT_QUESTION_ORDER], "all 25 questions, in the default order");
    eq(expect, await boxes(page).first().getAttribute("data-color"), severityColor(0, N), "top is dark red");
    eq(expect, await page.locator(".qo-item[data-question='MCC Not Egregious?'] .qo-name").innerText(), "MCC Egregious", "boxes show the names used across the app");
    eq(expect, await boxes(page).nth(8).getAttribute("data-color"), severityColor(8, N), "orange a third of the way");
    eq(expect, await boxes(page).nth(16).getAttribute("data-color"), severityColor(16, N), "yellow two thirds of the way");
    eq(expect, await boxes(page).last().getAttribute("data-color"), severityColor(N - 1, N), "bottom is green");

    // Drag Taxes (#14) onto the top box.
    await page.dragAndDrop(".qo-item[data-question='Taxes']", ".qo-item[data-question='Income']");
    await page.locator(".qo-status[data-state='saved']").waitFor();
    eq(expect, (await names(page))[0], "Taxes", "dragged to the top");
    eq(expect, await page.locator(".qo-item[data-question='Taxes']").getAttribute("data-color"), severityColor(0, N), "and it turns dark red");

    // The arrows move a box one step.
    await page.click(".qo-item[data-question='Guest Name'] .qo-up");
    await page.locator(".qo-status[data-state='saved']").waitFor();
    eq(expect, (await names(page)).slice(-2), ["Guest Name", "Phone Number"], "the up arrow moved Guest Name one step");

    await page.reload();
    await boxes(page).first().waitFor();
    eq(expect, (await names(page))[0], "Taxes", "the order was saved");
    expect((await page.locator(".qo-changed").innerText()).includes(mgr), "it says who changed it last");

    await page.click(".qo-reset");
    await page.locator(".qo-status[data-state='saved']").waitFor();
    eq(expect, await names(page), [...DEFAULT_QUESTION_ORDER], "Reset to default puts the default back");
  }));

Deno.test("REQ-053 AMENDMENT: while dragging, the cards move out of the way — the top card included — and the drop saves", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const mgr = await login("manager", [dept]);
    await page.setViewportSize({ width: 1400, height: 1700 });
    await signIn(page, mgr, "/manager");
    await page.goto("/manager/configure");
    await boxes(page).first().waitFor();

    // Pick up the TOP card (Income) and carry it down over the 4th card, without letting go.
    const center = async (sel: string) => {
      const b = await page.locator(sel).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const from = await center(".qo-item[data-question='Income']");
    const over = await center(".qo-item[data-question='Married/Cohab Qualifier Question']");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 20, { steps: 4 });
    await page.mouse.move(over.x, over.y, { steps: 12 });
    await page.waitForFunction(
      `document.querySelectorAll(".qo-item")[0]?.getAttribute("data-question") !== "Income"`,
    );
    const mid = await names(page);
    eq(expect, mid[0], "MCC Recurring Charges Disclosed?", "mid-drag, the card below Income has moved up into its slot");
    expect(mid.indexOf("Income") >= 2, `mid-drag, Income's slot has moved down with the cursor (at ${mid.indexOf("Income")})`);
    expect(await page.locator(".qo-item.qo-dragging[data-question='Income']").count() === 1, "the carried card is marked as the one moving");
    // Frame the list mid-drag: hovering the carried card keeps the cursor where it is.
    await page.locator(".qo-item.qo-dragging").hover();
    await page.mouse.up();

    await page.locator(".qo-status[data-state='saved']").waitFor();
    const after = await names(page);
    expect(after.indexOf("Income") >= 2, "dropped where the cursor left it");
    await page.reload();
    await boxes(page).first().waitFor();
    eq(expect, await names(page), after, "and that order was saved");
  }));

Deno.test("REQ-054: the queue lists the worst failed question first; unchecking orders by most recent; the Sort dropdown releases the box", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const newestMinor = await failedAudit(dept, "Dana Lee", ["Guest Name"], 1);
    const oldIncome = await failedAudit(dept, "Sam Ortiz", ["Income"], 20);
    const midAge = await failedAudit(dept, "Kim Park", ["Age"], 10);
    const mgr = await login("manager", [dept]);
    await signIn(page, mgr, "/manager");

    const box = page.locator("#q-byq");
    expect(await box.isChecked(), "Order by question failed is checked by default");
    eq(expect, await queueIds(page), [oldIncome, midAge, newestMinor], "worst failed question first (Income, Age, Guest Name)");

    await page.uncheck("#q-byq");
    await firstRowIs(page, newestMinor);
    eq(expect, await queueIds(page), [newestMinor, midAge, oldIncome], "unchecked: most recent first");

    await page.check("#q-byq");
    await firstRowIs(page, oldIncome);
    eq(expect, await queueIds(page), [oldIncome, midAge, newestMinor], "checked again: worst first");

    await page.selectOption("select[name=sort]", "oldest");
    await firstRowIs(page, oldIncome);
    eq(expect, await box.isChecked(), false, "picking from the dropdown released the box");
    eq(expect, await queueIds(page), [oldIncome, midAge, newestMinor], "and the dropdown's oldest-first applies");
    await page.selectOption("select[name=sort]", "recent");
    await firstRowIs(page, newestMinor);
    eq(expect, await queueIds(page), [newestMinor, midAge, oldIncome], "newest first from the dropdown");
  }));

Deno.test("REQ-055: the list is the department's — a second manager and the VO dashboard follow it, and the VO can't change it", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `GS MB ${tag()}`;
    const otherDept = `VO MB ${tag()}`;
    const ageFail = await failedAudit(dept, "Dana Lee", ["Age"], 2);
    const incomeFail = await failedAudit(dept, "Sam Ortiz", ["Income"], 1);
    const first = await login("manager", [dept, otherDept]);
    const second = await login("manager", [dept]);
    const vo = await login("vo", [dept]);

    // The first manager covers two departments, so the tab asks which one.
    await page.setViewportSize({ width: 1400, height: 1700 });
    await signIn(page, first, "/manager");
    await page.goto("/manager/configure");
    eq(expect, await page.locator(".qo-depts a").allInnerTexts(), [dept, otherDept].sort(), "a picker of the manager's departments");
    await page.click(`.qo-depts a:text-is("${dept}")`);
    await page.waitForURL(`**dept=${encodeURIComponent(dept).replace(/%20/g, "+")}*`);
    await page.dragAndDrop(".qo-item[data-question='Age']", ".qo-item[data-question='Income']");
    await page.locator(".qo-status[data-state='saved']").waitFor();
    eq(expect, (await names(page))[0], "Age", `${dept} now ranks Age worst`);
    await page.click(`.qo-depts a:text-is("${otherDept}")`);
    await boxes(page).first().waitFor();
    eq(expect, (await names(page))[0], "Income", "the other department keeps its own list");

    // A second manager in the same department sees the same list, and who set it.
    await page.goto("/api/logout");
    await signIn(page, second, "/manager");
    eq(expect, (await queueIds(page)).slice(0, 2), [ageFail, incomeFail], "their queue follows the department's list");
    await page.goto("/manager/configure");
    await boxes(page).first().waitFor();
    eq(expect, (await names(page))[0], "Age", "the shared list");
    expect((await page.locator(".qo-changed").innerText()).includes(first), "it says the first manager changed it");

    // The VO dashboard follows the list and can't change it.
    await page.goto("/api/logout");
    await signIn(page, vo, "/vo");
    expect(await page.locator("#vo-byq").isChecked(), "the VO's box is checked by default too");
    const voIds = await page.locator("#vo-queue-table tr[data-finding-id]").evaluateAll(
      // deno-lint-ignore no-explicit-any
    (rows: any[]) => rows.map((r) => r.getAttribute("data-finding-id") ?? ""),
    );
    eq(expect, voIds.slice(0, 2), [ageFail, incomeFail], "the VO's To Review follows the department's list");
    await page.goto("/manager/configure");
    await page.waitForURL("**/vo");
    expect(page.url().endsWith("/vo"), "a VO can't open Configure");
    const res = await page.request.post(new URL("/manager/api/question-order", page.url()).href, {
      data: { dept, order: ["Guest Name"] }, headers: { accept: "application/json" },
    });
    eq(expect, res.status(), 403, "a VO can't save a list");
  }));

Deno.test("REQ-056: a queue row's failed questions show worst-first in their severity colors", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA AM ${tag()}`;
    const id = await failedAudit(dept, "Dana Lee", ["Guest Name", "No Pets", "Income"], 1);
    const mgr = await login("manager", [dept]);
    await signIn(page, mgr, "/manager");

    const fails = page.locator(`#manager-queue-table tr[data-finding-id="${id}"] .sev-fail`);
    // The row shows two; "No Pets" is stored on the row as its label "Pet Policy".
    eq(expect, await fails.allInnerTexts(), ["Income", "Pet Policy"], "worst first, labels matched to their questions");
    eq(expect, await fails.first().getAttribute("data-sev-color"), severityColor(0, N), "Income in dark red");
    eq(expect, await fails.last().getAttribute("data-sev-color"), severityColor(DEFAULT_QUESTION_ORDER.indexOf("No Pets"), N), "Pet Policy in No Pets' color");
  }));
