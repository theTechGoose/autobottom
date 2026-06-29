/** Unit tests for the "Stage All" decision logic: which departments / offices
 *  get staged, their manager-scoped recipients, exclusions, multi-shift
 *  expansion, shift coverage, and skip-already-staged/published. (Global
 *  "always include" emails are layered on later via dedupeEmails, tested here.) */
import { assertEquals } from "@std/assert";
import { planStageAll, dedupeEmails } from "../../islands/WeeklyBuilderEditor.tsx";

const NONE = () => false;

Deno.test("dedupeEmails — case-insensitive, trims, drops empties, keeps first (this is how globals merge in)", () => {
  assertEquals(dedupeEmails([" A@x.com ", "a@X.com", "b@x.com", "", "   "]), ["A@x.com", "b@x.com"]);
});

Deno.test("planStageAll internal/All — stages every dept except excluded; recipients = its managers", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["A", "B", "ODS WFH"], offices: [],
    deptEmails: { A: ["a@m.com"], B: ["b@m.com", "shared@m.com"] }, officeEmails: {},
    excludeDepts: ["ODS WFH"], excludeOffices: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.length, 2);
  assertEquals(plan[0], { type: "internal", department: "A", shift: null, recipients: ["a@m.com"] });
  assertEquals(plan[1], { type: "internal", department: "B", shift: null, recipients: ["b@m.com", "shared@m.com"] });
});

Deno.test("planStageAll — multiple shifts make a separate report per shift, per dept", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["AM", "PM"],
    departments: ["A", "B"], offices: [],
    deptEmails: { A: ["a@m.com"], B: ["b@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => [p.department, p.shift]), [["A", "AM"], ["A", "PM"], ["B", "AM"], ["B", "PM"]]);
});

Deno.test("planStageAll — empty shift list behaves like 'All' (one combined report)", () => {
  const plan = planStageAll({
    type: "internal", shifts: [],
    departments: ["A"], offices: [],
    deptEmails: { A: ["a@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.length, 1);
  assertEquals(plan[0].shift, null);
});

Deno.test("planStageAll — a dept with no managers comes out with no recipients (NO EMAILS until globals)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["LONELY"], offices: [],
    deptEmails: {}, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan[0].recipients, []);
});

Deno.test("planStageAll — skips anything already staged or published (per dept+shift)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["A", "B", "C"], offices: [],
    deptEmails: { A: ["a@m.com"], B: ["b@m.com"], C: ["c@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    alreadyStaged: (s) => s.department === "A",
    alreadyPublished: (s) => s.department === "B",
  });
  assertEquals(plan.map((p) => p.department), ["C"]);
});

Deno.test("planStageAll both — stages internal and partner", () => {
  const plan = planStageAll({
    type: "both", shifts: ["All"],
    departments: ["A"], offices: ["EAST"],
    deptEmails: { A: ["a@m.com"] }, officeEmails: { EAST: ["east@m.com"] },
    excludeDepts: [], excludeOffices: [],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.length, 2);
  assertEquals(plan[0], { type: "internal", department: "A", shift: null, recipients: ["a@m.com"] });
  assertEquals(plan[1], { type: "partner", office: "EAST", shift: null, recipients: ["east@m.com"] });
});

Deno.test("planStageAll partner — excluded office is skipped; shifts don't apply to offices", () => {
  const plan = planStageAll({
    type: "partner", shifts: ["AM", "PM"],
    departments: [], offices: ["EAST", "WEST"],
    deptEmails: {}, officeEmails: { EAST: ["e@m.com"], WEST: ["w@m.com"] },
    excludeDepts: [], excludeOffices: ["WEST"],
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => [p.office, p.shift]), [["EAST", null]]);
});

Deno.test("planStageAll — a specific shift only stages depts that run it (Weekend → GS MB only)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["Weekend"],
    departments: ["GS MB", "ODS", "ACT FTL"], offices: [],
    deptEmails: { "GS MB": ["g@m.com"], ODS: ["o@m.com"], "ACT FTL": ["a@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    deptShifts: { "GS MB": ["AM", "PM", "Weekend"], ODS: ["AM", "PM"], "ACT FTL": ["AM"] },
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => p.department), ["GS MB"]);
  assertEquals(plan[0].shift, "Weekend");
});

Deno.test("planStageAll — dept with unknown coverage still gets the shift (don't hide it)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["Weekend"],
    departments: ["NEWDEPT"], offices: [],
    deptEmails: { NEWDEPT: ["n@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    deptShifts: {}, // coverage unknown
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => p.department), ["NEWDEPT"]);
});

Deno.test("planStageAll — 'All' ignores shift coverage (combined report for every dept)", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["All"],
    departments: ["GS MB", "ODS"], offices: [],
    deptEmails: { "GS MB": ["g@m.com"], ODS: ["o@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    deptShifts: { "GS MB": ["Weekend"], ODS: ["AM"] },
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => [p.department, p.shift]), [["GS MB", null], ["ODS", null]]);
});

Deno.test("planStageAll — multi-shift respects coverage per dept", () => {
  const plan = planStageAll({
    type: "internal", shifts: ["AM", "Weekend"],
    departments: ["GS MB", "ODS"], offices: [],
    deptEmails: { "GS MB": ["g@m.com"], ODS: ["o@m.com"] }, officeEmails: {},
    excludeDepts: [], excludeOffices: [],
    deptShifts: { "GS MB": ["AM", "Weekend"], ODS: ["AM"] }, // ODS has no Weekend
    alreadyStaged: NONE, alreadyPublished: NONE,
  });
  assertEquals(plan.map((p) => [p.department, p.shift]), [["GS MB", "AM"], ["GS MB", "Weekend"], ["ODS", "AM"]]);
});
