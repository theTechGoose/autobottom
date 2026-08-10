/** Integration coverage for getAuditHistory's person filter — seeds real
 *  audit-done-idx rows and queries through the actual function (in-memory
 *  store, no Firestore creds needed).
 *
 *  The case that matters: prod has two different Mariah Browns, one in ODR and
 *  one in WST, and they SHARE one VO email (mariahb@monsterrg.com). Neither the
 *  name nor the email can separate them — only the QuickBase employee id can.
 *  The per-team-member report page is keyed on that id, so if this filter ever
 *  regresses, one person's report shows the other person's scores. */
import { assert, assertEquals } from "#assert";
import { getAuditHistory } from "./mod.ts";
import {
  writeAuditDoneIndex,
  _resetQueryAuditDoneIndexCacheForTests,
} from "@audit/domain/data/stats-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";

function uniqueOrg(tag: string): OrgId {
  return (`test-ah-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

const NOW = 1_700_000_000_000;
const LO = NOW - 86_400_000;
const HI = NOW + 86_400_000;

interface Row {
  id: string;
  employeeId?: string;
  score: number;
  dept: string;
  at?: number;
}

async function seed(orgId: OrgId, rows: Row[]): Promise<void> {
  for (const r of rows) {
    await writeAuditDoneIndex(orgId, {
      findingId: r.id,
      completedAt: r.at ?? NOW,
      score: r.score,
      completed: true,
      reason: "reviewed",
      voName: "Mariah Brown",           // identical on purpose — that's the trap
      employeeId: r.employeeId,
      department: r.dept,
      isPackage: false,
    }, { assumeFinished: true });
  }
  _resetQueryAuditDoneIndexCacheForTests();
}

/** Admin role so the "managers see reviewed audits only" gate and the manager
 *  dept/shift scope don't confound what we're actually measuring. */
function query(orgId: OrgId, filters: Record<string, unknown>) {
  return getAuditHistory(orgId, "admin@test.local", "admin", {
    since: LO,
    until: HI,
    ...filters,
  });
}

Deno.test({
  name: "getAuditHistory — employeeId returns ONE Mariah Brown, not both",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const orgId = uniqueOrg("two-mariahs");
    await seed(orgId, [
      { id: "odr-1", employeeId: "25335", score: 100, dept: "ODR" },
      { id: "odr-2", employeeId: "25335", score: 80, dept: "ODR", at: NOW - 1000 },
      { id: "wst-1", employeeId: "22887", score: 60, dept: "WST ACT", at: NOW - 2000 },
    ]);

    // The premise: filtering on the shared NAME pulls in both people.
    const byName = await query(orgId, { owner: "Mariah Brown" });
    assertEquals(byName.total, 3, "the name alone matches both Mariahs — that's the bug");

    const odr = await query(orgId, { employeeId: "25335" });
    assertEquals(odr.total, 2);
    assertEquals(odr.items.map((i) => i.findingId).sort(), ["odr-1", "odr-2"]);
    assertEquals(odr.avgScore, 90, "average is over THIS person's audits only");

    const wst = await query(orgId, { employeeId: "22887" });
    assertEquals(wst.total, 1);
    assertEquals(wst.avgScore, 60);
  },
});

Deno.test({
  name: "getAuditHistory — employeeId never falls back to the name",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Rows audited before the id existed carry no employeeId. Matching them by
    // name would quietly re-merge the two people on historical data, which is
    // precisely the failure this whole change removes.
    const orgId = uniqueOrg("no-fallback");
    await seed(orgId, [
      { id: "legacy-1", score: 100, dept: "ODR" },
      { id: "legacy-2", score: 50, dept: "WST ACT", at: NOW - 1000 },
      { id: "new-1", employeeId: "25335", score: 90, dept: "ODR", at: NOW - 2000 },
    ]);

    const res = await query(orgId, { employeeId: "25335" });
    assertEquals(res.total, 1, "only the row that actually carries the id");
    assertEquals(res.items[0].findingId, "new-1");
  },
});

Deno.test({
  name: "getAuditHistory — an unknown employeeId returns nothing, not everything",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // A typo'd or deleted id must produce an empty report. Falling open here
    // would show one person the whole org's audits under their name.
    const orgId = uniqueOrg("unknown");
    await seed(orgId, [{ id: "a", employeeId: "25335", score: 100, dept: "ODR" }]);
    const res = await query(orgId, { employeeId: "99999999" });
    assertEquals(res.total, 0);
    assertEquals(res.items.length, 0);
  },
});

Deno.test({
  name: "getAuditHistory — employeeId rows still carry the id back to the caller",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // The tables link the team member's name to /manager/team/<employeeId>, so
    // the id has to survive the round trip or every name renders unlinked.
    const orgId = uniqueOrg("roundtrip");
    await seed(orgId, [{ id: "r1", employeeId: "28963", score: 100, dept: "VBA PM" }]);
    const res = await query(orgId, {});
    const row = res.items.find((i) => i.findingId === "r1");
    assert(row, "seeded row must come back");
    assertEquals(row.employeeId, "28963");
  },
});
