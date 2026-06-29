/** Unit tests for the "Stage All" decision logic: which departments / offices
 *  get staged, their recipient lists (manager scope + global emails, deduped),
 *  exclusions, multi-shift expansion, and skip-already-staged/published. */
import { assertEquals } from "@std/assert";
import { planStageAll, dedupeEmails } from "../../islands/WeeklyBuilderEditor.tsx";

const NONE = () => false;

Deno.test("dedupeEmails — case-insensitive, trims, drops empties, keeps first occurrence", () => {
  assertEquals(dedupeEmails([" A@x.com ", "a@X.com", "b@x.com", "", "   "]), ["A@x.com", "b@x.com"]);
});

Deno.test("planStageAll internal/All — stages every dept except excluded; recipients = managers + globals deduped", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["A", "B", "ODS WFH"], offices: [],
    deptEmails: { A: ["a@m.com"], B: ["b@m.com", "shared@m.com"] }, officeEmails: {},
    excludeDepts: ["ODS WFH"], excludeOffices: [],
    globalEmails: ["shared@m.com", "ceo@m.com"],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.length, 2);
  assertEquals(plan[0], { type: "internal", department: "A", shift: null, recipients: ["a@m.com", "shared@m.com", "ceo@m.com"] });
  // B already has shared@m.com → the global copy is not doubled
  assertEquals(plan[1], { type: "internal", department: "B", shift: null, recipients: ["b@m.com", "shared@m.com", "ceo@m.com"] });
});

Deno.test("planStageAll — multiple shifts make a separate report per shift, per dept", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["AM", "PM"],
    departments: ["A", "B"], offices: [],
    deptEmails: { A: ["a@m.com"], B: ["b@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [], globalEmails: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => [p.department, p.shift]), [["A", "AM"], ["A", "PM"], ["B", "AM"], ["B", "PM"]]);
});

Deno.test("planStageAll — empty shift list behaves like 'All' (one combined report)", () => {
  const plan = planStageAll({
    type: "internal", shifts: [],
    departments: ["A"], offices: [],
    deptEmails: { A: ["a@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [], globalEmails: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.length, 1);
  assertEquals(plan[0].shift, null);
});

Deno.test("planStageAll — no-manager dept with no globals → empty recipients (NO EMAILS)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["LONELY"], offices: [],
    deptEmails: {}, officeEmails: {},
    excludeDepts: [], excludeOffices: [], globalEmails: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan[0].recipients, []);
});

Deno.test("planStageAll — no-manager dept but globals set → gets the globals", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["LONELY"], offices: [],
    deptEmails: {}, officeEmails: {},
    excludeDepts: [], excludeOffices: [], globalEmails: ["support@m.com"],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan[0].recipients, ["support@m.com"]);
});

Deno.test("planStageAll — skips anything already staged or published (per dept+shift)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["A", "B", "C"], offices: [],
    deptEmails: { A: ["a@m.com"], B: ["b@m.com"], C: ["c@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [], globalEmails: [],
    alreadyStaged: (s) => s.department === "A",
    alreadyPublished: (s) => s.department === "B",
  });
  assertEquals(plan.map((p) => p.department), ["C"]);
});

Deno.test("planStageAll both — stages internal and partner, globals on each", () => {
  const plan = planStageAll({
    type: "both", shifts: ["All"],
    departments: ["A"], offices: ["EAST"],
    deptEmails: { A: ["a@m.com"] }, officeEmails: { EAST: ["east@m.com"] },
    excludeDepts: [], excludeOffices: [], globalEmails: ["ceo@m.com"],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.length, 2);
  assertEquals(plan[0], { type: "internal", department: "A", shift: null, recipients: ["a@m.com", "ceo@m.com"] });
  assertEquals(plan[1], { type: "partner", office: "EAST", shift: null, recipients: ["east@m.com", "ceo@m.com"] });
});

Deno.test("planStageAll partner — excluded office is skipped; shifts don't apply to offices", () => {
  const plan = planStageAll({
    type: "partner", shifts: ["AM", "PM"],
    departments: [], offices: ["EAST", "WEST"],
    deptEmails: {}, officeEmails: { EAST: ["e@m.com"], WEST: ["w@m.com"] },
    excludeDepts: [], excludeOffices: ["WEST"], globalEmails: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => [p.office, p.shift]), [["EAST", null]]);
});
