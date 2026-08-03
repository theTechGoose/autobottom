/** Tests for manager routing — which report an unclaimed office code lands in. */
import { assert, assertEquals } from "#assert";
import {
  absorbedEntries,
  claimedDepartments,
  normalizeDept,
  parseManagers,
  sectionForAbsorbed,
} from "./mod.ts";
import type { EmailReportConfig, AuditDoneIndexEntry } from "@core/dto/types.ts";

function report(name: string, depts: string[], extra: Partial<EmailReportConfig> = {}): EmailReportConfig {
  return {
    id: name, name, recipients: [], weeklyType: "internal",
    reportSections: depts.map((d) => ({
      header: d, columns: ["voName"],
      criteria: [{ field: "department", operator: "equals", value: d }],
    })),
    ...extra,
  } as EmailReportConfig;
}

function entry(findingId: string, department: string): AuditDoneIndexEntry {
  return { findingId, department, completedAt: 1, score: 100, completed: true } as AuditDoneIndexEntry;
}

Deno.test("claimedDepartments — collects every office code any live weekly report names", () => {
  const claimed = claimedDepartments([
    report("VO Team / IDS", ["GS MB", "VO MB"]),
    report("WST Outbound", ["WST DS", "WST ACT"]),
  ]);
  assertEquals([...claimed].sort(), ["gs mb", "vo mb", "wst act", "wst ds"]);
});

Deno.test("claimedDepartments — ignores disabled and non-weekly reports", () => {
  const claimed = claimedDepartments([
    report("live", ["GS MB"]),
    report("off", ["ODS"], { enabled: false }),
    report("daily", ["ODR"], { weeklyType: undefined }),
  ]);
  assertEquals([...claimed], ["gs mb"]);
});

Deno.test("parseManagers — splits the comma-joined supervisor field, lowercased and de-duped", () => {
  assertEquals(parseManagers("A@x.com, b@x.com"), ["a@x.com", "b@x.com"]);
  assertEquals(parseManagers("a@x.com,a@x.com"), ["a@x.com"]);
  assertEquals(parseManagers(""), []);
  assertEquals(parseManagers("not an email"), []);
  assertEquals(parseManagers(undefined), []);
});

Deno.test("normalizeDept — case and padding never split one office code in two", () => {
  assertEquals(normalizeDept("ACT MB"), normalizeDept(" Act MB "));
});

Deno.test("absorbedEntries — takes unclaimed office codes whose manager is on this report", () => {
  const claimed = new Set(["gs mb", "ods"]);
  const entries = [
    entry("f1", "GS WFH"),  // unclaimed, our manager  → absorbed
    entry("f2", "GS MB"),   // claimed                 → left to the department rule
    entry("f3", "GS NST"),  // unclaimed, someone else → not ours
  ];
  const managers = new Map([["f1", ["haleys@x.com"]], ["f2", ["haleys@x.com"]], ["f3", ["jenniferb@x.com"]]]);

  const got = absorbedEntries(entries, managers, ["haleys@x.com"], claimed);
  assertEquals(got.map((e) => e.findingId), ["f1"]);
});

Deno.test("absorbedEntries — a claimed office code is NEVER re-routed, even for our own manager", () => {
  // This is what keeps garrettc split across GS WST / WST Outbound / IDS A3N
  // instead of collapsing them into one report.
  const claimed = new Set(["gs wst", "wst act", "ids a3n"]);
  const entries = [entry("f1", "GS WST"), entry("f2", "WST ACT"), entry("f3", "IDS A3N")];
  const managers = new Map(entries.map((e) => [e.findingId, ["garrettc@x.com"]]));
  assertEquals(absorbedEntries(entries, managers, ["garrettc@x.com"], claimed), []);
});

Deno.test("absorbedEntries — any manager on a multi-manager audit is enough to claim it", () => {
  const entries = [entry("f1", "GS WFH")];
  const managers = new Map([["f1", ["craigp@x.com", "haleys@x.com", "candiceg@x.com"]]]);
  assertEquals(absorbedEntries(entries, managers, ["haleys@x.com"], new Set()).length, 1);
});

Deno.test("absorbedEntries — a report with no manager list absorbs nothing", () => {
  const entries = [entry("f1", "GS WFH")];
  const managers = new Map([["f1", ["haleys@x.com"]]]);
  assertEquals(absorbedEntries(entries, managers, [], new Set()), []);
});

Deno.test("sectionForAbsorbed — joins the section already holding that manager's work", () => {
  // haleys' claimed audits sit in section 0; her GS WFH audits must land there
  // too, so her people get ONE card with their true total.
  const counts = new Map([["haleys@x.com", new Map([[0, 40], [1, 2]])]]);
  assertEquals(sectionForAbsorbed(["haleys@x.com"], counts, [42, 2]), 0);
});

Deno.test("sectionForAbsorbed — with no history for that manager, falls in with the busiest section", () => {
  assertEquals(sectionForAbsorbed(["nobody@x.com"], new Map(), [3, 17, 9]), 1);
});

Deno.test("sectionForAbsorbed — a sectionless report places nothing", () => {
  assertEquals(sectionForAbsorbed(["a@x.com"], new Map(), []), -1);
});

Deno.test("sectionForAbsorbed — a co-listed pair pools its sections before choosing", () => {
  const counts = new Map([
    ["a@x.com", new Map([[0, 5]])],
    ["b@x.com", new Map([[1, 3], [0, 4]])],
  ]);
  // section 0 total = 9, section 1 total = 3
  assertEquals(sectionForAbsorbed(["a@x.com", "b@x.com"], counts, [9, 3]), 0);
});

Deno.test("the GS WFH case end to end — JoAnna's off-code work joins her existing card", () => {
  const claimed = claimedDepartments([
    report("VO Team / IDS", ["GS MB", "VO MB"]),
    report("ODS", ["ODS"]),
  ]);
  assert(!claimed.has("gs wfh"), "GS WFH is claimed by no report");

  const entries = [entry("f1", "GS MB"), entry("f2", "GS WFH"), entry("f3", "GS WFH")];
  const managers = new Map(entries.map((e) => [e.findingId, ["haleys@x.com", "craigp@x.com"]]));

  const absorbed = absorbedEntries(entries, managers, ["haleys@x.com"], claimed);
  assertEquals(absorbed.map((e) => e.findingId), ["f2", "f3"]);

  // f1 routed to section 0 (GS MB) by department; the absorbed pair follows.
  const counts = new Map([["haleys@x.com", new Map([[0, 1]])]]);
  for (const a of absorbed) {
    assertEquals(sectionForAbsorbed(managers.get(a.findingId)!, counts, [1, 0]), 0);
  }
});
