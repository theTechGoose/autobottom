/** Queue archive (REQ-057): open items that landed before the org's archive
 *  cutoff are off the manager queue and the VO dashboard; newer ones stay;
 *  nothing is deleted; clearing the archive brings them back.
 *
 *  Uses the real cutoff, Monday 2026-11-09 00:00 ET. The archive is org-wide
 *  and the emulator org is shared; every other story's audits are minutes or
 *  hours old, so they all land after it. */
import { story } from "#shots";
import { createUser } from "@core/business/auth/mod.ts";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { getStored, setStored } from "@core/data/firestore/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import {
  clearQueueArchive, populateManagerQueue, setQueueArchive,
} from "@manager/domain/data/manager-repository/mod.ts";

/** Monday 2026-11-09 00:00 ET (EST, UTC-5). */
const CUTOFF = Date.parse("2026-11-09T00:00:00-05:00");

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];
const PASS = "e2e-pass-123";
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

Deno.test("REQ-057: audits that landed before Monday Nov 9 come off the manager queue and the VO dashboard; ones that landed on/after stay; nothing is deleted", (t) =>
  story(t, async ({ page, expect }) => {
    const dept = `VBA PM ${tag()}`;
    const beforeMonday = await failedAudit(dept, "Dana Lee", CUTOFF - 3_600_000); // Sun Nov 8, 11 PM ET
    const atMonday = await failedAudit(dept, "Kim Park", CUTOFF); // Mon Nov 9, 00:00 ET
    const recent = await failedAudit(dept, "Sam Ortiz", Date.now() - 3_600_000);
    const mgr = await login("manager", dept);
    const vo = await login("vo", dept);

    try {
      // Before the archive: all three are on the manager's "All time" queue.
      await signIn(page, mgr, "/manager");
      await page.goto("/manager?since=0&byq=0");
      expect.eq(await rowCount(page, "#manager-queue-table", beforeMonday), 1, "before: the Nov 8 audit is on the queue");
      expect.eq(await rowCount(page, "#manager-queue-table", atMonday), 1, "before: the Nov 9 00:00 audit is on the queue");
      expect.eq(await rowCount(page, "#manager-queue-table", recent), 1, "before: the recent audit is on the queue");

      // Archive everything that landed before Monday Nov 9 00:00 ET.
      await setQueueArchive(ORG, CUTOFF, "e2e-admin@monsterrg.com");
      await page.goto("/manager?since=0&byq=0");
      expect.eq(await rowCount(page, "#manager-queue-table", beforeMonday), 0, "after: the Nov 8 audit is off the manager queue");
      expect.eq(await rowCount(page, "#manager-completed-table", beforeMonday), 0, "and not moved to Completed");
      expect.eq(await rowCount(page, "#manager-queue-table", atMonday), 1, "after: the Nov 9 00:00 audit stays");
      expect.eq(await rowCount(page, "#manager-queue-table", recent), 1, "after: the recent audit stays");

      await page.goto("/api/logout");
      await signIn(page, vo, "/vo");
      await page.goto("/vo?since=0");
      expect.eq(await rowCount(page, "#vo-queue-table", beforeMonday), 0, "after: the Nov 8 audit is off the VO dashboard");
      expect.eq(await rowCount(page, "#vo-queue-table", atMonday), 1, "after: the Nov 9 00:00 audit stays on the VO dashboard");
      expect.eq(await rowCount(page, "#vo-queue-table", recent), 1, "after: the recent audit stays on the VO dashboard");
      expect(!!(await getStored("manager-queue", ORG, beforeMonday)), "the Nov 8 audit's queue row is not deleted");
    } finally {
      await clearQueueArchive(ORG);
    }
  }));
