/** VO dashboard backend, against the Firestore emulator: a VO login sees only
 *  its department's failed audits, a review is written once for everyone, and
 *  the manager's queue carries the review. */
import { assert, assertEquals } from "#assert";
import { setStored } from "@core/data/firestore/mod.ts";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { attachReviewsForManager, loadVoView, submitTmReview } from "./mod.ts";

function uniqueOrg(tag: string): OrgId {
  return (`test-vo-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

const VO = "vbapmvo@monsterrg.com";

async function seed(orgId: OrgId) {
  const now = Date.now();
  const row = (findingId: string, department: string, over: Record<string, unknown> = {}) =>
    setStored("manager-queue", orgId, [findingId], {
      findingId, addedAt: now, completedAt: now, status: "pending", voName: "Dana Lee",
      failedQuestions: ["Correct Dates"], wgs: false, department, shift: "PM", isPackage: false, ...over,
    });
  await row("vba-1", "VBA PM");
  await row("vba-2", "VBA PM");
  await row("ods-1", "ODS");
  await saveManagerScope(orgId, VO, { departments: ["VBA PM"], shifts: [] });
}

Deno.test("REQ-034: a VO login sees exactly its department's failed audits", async () => {
  const org = uniqueOrg("scope");
  await seed(org);
  const items = await loadVoView(org, VO);
  assertEquals(items.map((i) => i.findingId).sort(), ["vba-1", "vba-2"]);
});

Deno.test("REQ-034: a VO login with no department assigned sees nothing", async () => {
  const org = uniqueOrg("noscope");
  await seed(org);
  assertEquals((await loadVoView(org, "nobody@monsterrg.com")).length, 0);
});

Deno.test("REQ-035: a review is saved with its write-up and shows on the next load", async () => {
  const org = uniqueOrg("review");
  await seed(org);
  const res = await submitTmReview(org, { voEmail: VO, reviewedBy: VO, findingId: "vba-1", note: "Went over the dates" });
  assertEquals(res, { ok: true });
  const hit = (await loadVoView(org, VO)).find((i) => i.findingId === "vba-1");
  assertEquals(hit?.tmReview?.note, "Went over the dates");
  assertEquals(hit?.tmReview?.reviewedBy, VO);
});

Deno.test("REQ-035: once reviewed, always reviewed — a second review is refused and the first stands", async () => {
  const org = uniqueOrg("once");
  await seed(org);
  await submitTmReview(org, { voEmail: VO, reviewedBy: VO, findingId: "vba-1", note: "First" });
  const again = await submitTmReview(org, { voEmail: VO, reviewedBy: "admin@monsterrg.com", findingId: "vba-1", note: "Second" });
  assertEquals(again, { ok: false, error: "already-reviewed" });
  const hit = (await loadVoView(org, VO)).find((i) => i.findingId === "vba-1");
  assertEquals(hit?.tmReview?.note, "First");
});

Deno.test("REQ-035: a review needs a write-up", async () => {
  const org = uniqueOrg("blank");
  await seed(org);
  assertEquals(
    await submitTmReview(org, { voEmail: VO, reviewedBy: VO, findingId: "vba-1", note: "   " }),
    { ok: false, error: "note-required" },
  );
});

Deno.test("REQ-034: a VO cannot review an audit outside its department", async () => {
  const org = uniqueOrg("outside");
  await seed(org);
  assertEquals(
    await submitTmReview(org, { voEmail: VO, reviewedBy: VO, findingId: "ods-1", note: "Not mine" }),
    { ok: false, error: "not-in-scope" },
  );
});

Deno.test("REQ-038: the manager's queue items carry the TM review", async () => {
  const org = uniqueOrg("mgr");
  await seed(org);
  await submitTmReview(org, { voEmail: VO, reviewedBy: VO, findingId: "vba-2", note: "Coached on greeting" });
  const items = [
    { findingId: "vba-1", department: "VBA PM", status: "pending" },
    { findingId: "vba-2", department: "VBA PM", status: "pending" },
    { findingId: "ods-1", department: "ODS", status: "pending" },
  ];
  const out = await attachReviewsForManager(org, items);
  assertEquals(out.find((i) => i.findingId === "vba-2")?.tmReview?.note, "Coached on greeting");
  assert(!out.find((i) => i.findingId === "vba-1")?.tmReview);
  // Status untouched — the review is information, not a state change.
  assertEquals(out.find((i) => i.findingId === "vba-2")?.status, "pending");
});
