/** Seed helper for Dev Tools / Super Admin — creates a baseline set of test
 *  users in the given org so every role is represented. Idempotent: users
 *  that already exist are skipped, not errored. No fake findings generated
 *  yet — run a real test audit via Bulk Audit to populate the pipeline.
 *
 *  All seeded users have password "0000" — NEVER enable this in prod. */

import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { createUser } from "@core/business/auth/mod.ts";
import type { Role } from "@core/business/auth/mod.ts";

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
