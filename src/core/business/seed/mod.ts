/** Seed helper for Dev Tools / Super Admin — creates a baseline set of test
 *  users in the given org so every role is represented. Idempotent: users
 *  that already exist are skipped, not errored. No fake findings generated
 *  yet — run a real test audit via Bulk Audit to populate the pipeline.
 *
 *  All seeded users have password "0000" — NEVER enable this in prod. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { createUser, defaultOrgId } from "@core/business/auth/mod.ts";
import type { Role } from "@core/business/auth/mod.ts";
import { setStored } from "@core/data/firestore/mod.ts";

// Org/slug indices are global, not per-tenant — same empty-string org the auth
// service writes them under.
const GLOBAL_ORG = "" as OrgId;

/** The seeded manager who owns the fixture queue's department scope. */
const MANAGER_EMAIL = "manager@test.dev";

const TEST_USERS: Array<{ email: string; role: Role }> = [
  { email: "admin@test.dev",     role: "admin" },
  { email: "judge@test.dev",     role: "judge" },
  { email: "manager@test.dev",   role: "manager" },
  { email: "reviewer1@test.dev", role: "reviewer" },
  { email: "reviewer2@test.dev", role: "reviewer" },
  { email: "agent@test.dev",     role: "user" },
];

export async function seedOrgData(orgId: OrgId): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const u of TEST_USERS) {
    try {
      await createUser(orgId, u.email, "0000", u.role);
      created.push(u.email);
    } catch (err) {
      console.log(`[SEED] skip ${u.email}: ${(err as Error).message}`);
      skipped.push(u.email);
    }
  }
  console.log(`[SEED] orgId=${orgId} created=${created.length} skipped=${skipped.length}`);
  return { created, skipped };
}

/** Boot-time local login. Only fires when no Firestore credentials are
 *  configured — that is exactly the case where every read/write falls back to
 *  the throwaway per-process in-memory store, so this can never create a user
 *  in a real datastore. The env check mirrors loadFirestoreCredentials()'s own
 *  condition without paying its S3 fetch on cold start.
 *
 *  Seeds into defaultOrgId() ("default") rather than a fresh UUID org so the
 *  endpoints that resolve the org from env (remediation submit, QStash
 *  callbacks) line up with what the session cookie carries. */
export async function seedDevLogin(): Promise<void> {
  const hasFirestore = Boolean(
    (Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET")) &&
    Deno.env.get("FIREBASE_SA_S3_KEY") &&
    Deno.env.get("FIREBASE_PROJECT_ID"),
  );
  if (hasFirestore) return;

  const email = Deno.env.get("DEV_ADMIN_EMAIL") ?? "admin@local.dev";
  const password = Deno.env.get("DEV_ADMIN_PASSWORD") ?? "0000";
  const orgId = defaultOrgId() as OrgId;

  await setStored("org", GLOBAL_ORG, [orgId], {
    name: "Local Dev", slug: "local-dev", createdAt: Date.now(), createdBy: email,
  });
  await setStored("org-by-slug", GLOBAL_ORG, ["local-dev"], { orgId });
  await createUser(orgId, email, password, "admin");
  await seedOrgData(orgId);
  await seedManagerFixtures(orgId);

  console.log(`🔑 [DEV-LOGIN] admin ${email} / ${password} — plus *@test.dev (judge, manager, reviewer1, reviewer2, agent) / 0000`);
  console.log(`🔑 [DEV-LOGIN] in-memory store, org "${orgId}" — everything resets on restart`);
}

/** Local manager-view fixtures: the real prod manager-queue rows (department
 *  VBA PM) plus the finding docs behind them, pulled 2026-08-21 and kept out of
 *  git under fixtures/json/. Absent file = skip, so a fresh clone still boots.
 *
 *  Timestamps are shifted by a whole number of WEEKS so the newest row always
 *  lands in the current week — the Today / This week / Last week presets keep
 *  showing data instead of going empty as the pull ages. Whole weeks (not days)
 *  keeps every row on its original weekday and time of day. The shift is 0 when
 *  the fixture is fresh, i.e. the rows are byte-identical to prod.
 *
 *  The queue is scoped by department, and an admin has no queue of their own
 *  (computeManagerQueueView returns an empty list for a non-impersonating
 *  admin), so the fixture's scope is attached to manager@test.dev — log in as
 *  that user, or visit /manager?as=manager@test.dev as the admin. */
export async function seedManagerFixtures(orgId: OrgId): Promise<void> {
  const path = new URL("../../../../fixtures/json/manager-view.json", import.meta.url);
  let fixture: {
    scope: { departments: string[]; shifts: string[] };
    items: Array<Record<string, unknown>>;
    findings: Record<string, Record<string, unknown>>;
  };
  try {
    fixture = JSON.parse(await Deno.readTextFile(path));
  } catch {
    console.log(`[DEV-LOGIN] no fixtures/json/manager-view.json — manager queue starts empty`);
    return;
  }

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const newest = Math.max(...fixture.items.map((i) => Number(i.completedAt ?? i.addedAt ?? 0)));
  const shift = Math.round((Date.now() - newest) / WEEK) * WEEK;
  const move = (v: unknown) => (typeof v === "number" && v > 0 ? v + shift : v);
  const moveKeys = (o: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (k in o) o[k] = move(o[k]);
    return o;
  };

  const { saveFinding } = await import("@audit/domain/data/audit-repository/mod.ts");
  const { saveManagerScope } = await import("@admin/domain/data/admin-repository/mod.ts");

  for (const finding of Object.values(fixture.findings)) {
    if (!finding) continue;
    await saveFinding(orgId, moveKeys(finding, ["completedAt", "startedAt", "reviewedAt", "assemblyAiSubmittedAt"]));
  }
  for (const item of fixture.items) {
    moveKeys(item, ["addedAt", "completedAt", "remediatedAt", "emailSentAt", "emailOpenedAt"]);
    await setStored("manager-queue", orgId, [String(item.findingId)], item);
  }
  await saveManagerScope(orgId, MANAGER_EMAIL, fixture.scope);

  const weeks = shift / WEEK;
  console.log(`🔑 [DEV-LOGIN] manager fixtures: ${fixture.items.length} queue rows + ${Object.keys(fixture.findings).length} findings, scope ${JSON.stringify(fixture.scope)}${weeks ? `, dates shifted +${weeks} week(s)` : ""}`);
  console.log(`🔑 [DEV-LOGIN] see them at /manager as ${MANAGER_EMAIL} / 0000 (or /manager?as=${MANAGER_EMAIL} as admin)`);
}
