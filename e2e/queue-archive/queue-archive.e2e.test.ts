/** Queue archive (REQ-057): open items that landed before the org's archive
 *  cutoff are off the manager queue and the VO dashboard; newer ones stay;
 *  nothing is deleted; clearing the archive brings them back.
 *
 *  The archive is org-wide and the emulator org is shared, so the cutoff here
 *  sits 30 days back — every other story's audits are minutes or hours old. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import {
  clearQueueArchive, populateManagerQueue, setQueueArchive,
} from "@manager/domain/data/manager-repository/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];
const PASS = "e2e-pass-123";
const DAY = 86_400_000;
const tag = () => crypto.randomUUID().slice(0, 6);

async function failedAudit(dept: string, name: string, landedAt: number): Promise<string> {
  const id = `e2e-qa-${tag()}`;
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    answeredQuestions: [{ header: "Income", populated: "Income?", thinking: "Missed", defense: "", answer: "No" }],
    completedAt: landedAt,
    record: { RecordId: "900400", VoName: `${dept} - ${name}`, ActivatingOffice: dept, Shift: "PM" },
    recordingId: "27694351", genieIds: ["27694351"], recordingIdField: "VoGenie", owner: "api",
  });
  await populateManagerQueue(ORG, id);
  const row = await getStored<Record<string, unknown>>("manager-queue", ORG, id);
  await setStored("manager-queue", ORG, [id], { ...row, completedAt: landedAt, addedAt: landedAt });
  return id;
}

async function login(role: "vo" | "manager", dept: string): Promise<string> {
  const email = `e2e-qa-${role}-${tag()}@monsterrg.com`;
  await createUser(ORG, email, PASS, role);
  await saveManagerScope(ORG, email, { departments: [dept], shifts: [] });
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
const rowCount = async (page: any, table: string, id: string) => await page.locator(`${table} tr[data-finding-id="${id}"]`).count();

Deno.test("REQ-057: open items that landed before the cutoff are off the manager queue and the VO dashboard; newer ones stay; nothing is deleted", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const cutoff = Date.now() - 30 * DAY;
    const old = await failedAudit(dept, "Dana Lee", cutoff - 10 * DAY);
    const recent = await failedAudit(dept, "Sam Ortiz", Date.now() - 3_600_000);
    const mgr = await login("manager", dept);
    const vo = await login("vo", dept);

    await setQueueArchive(ORG, cutoff, "e2e-admin@monsterrg.com");
    try {
      // "All time" window, so only the archive can take the old one off.
      await signIn(page, mgr, "/manager");
      await page.goto("/manager?since=0");
      expect.eq(await rowCount(page, "#manager-queue-table", recent), 1, "the recent audit is on the manager queue");
      expect.eq(await rowCount(page, "#manager-queue-table", old), 0, "the old one is off it");
      expect.eq(await rowCount(page, "#manager-completed-table", old), 0, "and not on the Completed side either");

      await page.goto("/api/logout");
      await signIn(page, vo, "/vo");
      await page.goto("/vo?since=0");
      expect.eq(await rowCount(page, "#vo-queue-table", recent), 1, "the recent audit is on the VO dashboard");
      expect.eq(await rowCount(page, "#vo-queue-table", old), 0, "the old one is off it");
      expect(!!(await getStored("manager-queue", ORG, old)), "the old audit's queue row is not deleted");

      // Clearing the archive brings it back.
      await clearQueueArchive(ORG);
      await page.goto("/vo?since=0");
      expect.eq(await rowCount(page, "#vo-queue-table", old), 1, "cleared: the old audit is back");
    } finally {
      await clearQueueArchive(ORG);
    }
  }));
