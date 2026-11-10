/** REQ-045: an audit taken out of the department numbers (the hidden set) is
 *  off the manager's queue page and out of its stat counts. Each story invents
 *  its own department so it never sees another story's rows. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import { populateManagerQueue } from "@manager/domain/data/manager-repository/mod.ts";
import { markFindingHidden } from "@audit/domain/data/stats-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];
const PASS = "e2e-pass-123";
const tag = () => crypto.randomUUID().slice(0, 6);

async function failedAudit(dept: string, name: string): Promise<string> {
  const id = `e2e-mqh-${tag()}`;
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
    ],
    completedAt: Date.now(),
    record: { RecordId: "900200", VoName: `${dept} - ${name}`, ActivatingOffice: dept, Shift: "AM" },
    recordingId: "27728138",
    genieIds: ["27728138"],
    recordingIdField: "VoGenie",
    owner: "api",
  });
  await populateManagerQueue(ORG, id);
  return id;
}

/** The server caches the hidden set for 30s per isolate (getHiddenFindingIds),
 *  so a hide made after a page has been read shows up within that window. */
const HIDDEN_CACHE_MS = 31_000;

Deno.test("REQ-045: a hidden audit is off the manager's queue page and out of its counts", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `ODR ${tag()}`;
    const kept = await failedAudit(dept, "Real Person");
    const hidden = await failedAudit(dept, "Test other");

    const email = `e2e-manager-${tag()}@monsterrg.com`;
    await createUser(ORG, email, PASS, "manager");
    await saveManagerScope(ORG, email, { departments: [dept], shifts: [] });

    await page.goto("/login");
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", PASS);
    await page.click("button[type=submit]");
    await page.waitForURL("**/manager");

    // Before: both audits are on the queue, and the Total card counts both.
    await page.goto("/manager?since=0");
    expect.eq(await page.locator(`#manager-queue-table tr[data-finding-id="${kept}"]`).count(), 1, "before: Real Person is on the queue");
    expect.eq(await page.locator(`#manager-queue-table tr[data-finding-id="${hidden}"]`).count(), 1, "before: Test other is on the queue");
    await page.goto("/api/manager/stats");
    expect.eq(await page.locator(".stat-card", { hasText: "Total" }).locator(".stat-value").innerText(), "2", "before: Total counts both");

    // Take Test other out of the department numbers.
    await markFindingHidden(ORG, hidden, "e2e");
    await page.waitForTimeout(HIDDEN_CACHE_MS);

    // After: Test other is gone from the queue and the counts; Real Person stays.
    await page.goto("/manager?since=0");
    expect.eq(await page.locator(`#manager-queue-table tr[data-finding-id="${kept}"]`).count(), 1, "after: Real Person is still on the queue");
    expect.eq(await page.locator(`tr[data-finding-id="${hidden}"]`).count(), 0, "after: Test other is off the queue");
    await page.goto("/api/manager/stats");
    expect.eq(await page.locator(".stat-card", { hasText: "Total" }).locator(".stat-value").innerText(), "1", "after: Total leaves Test other out");
  }));
