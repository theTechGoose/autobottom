/** Department question order, against the Firestore emulator (REQ-053/055):
 *  one list per department, the default until someone saves, last save wins
 *  with who/when recorded, and only managers in scope (or admins) may edit. */
import { assert, assertEquals } from "#assert";
import { saveManagerScope } from "@admin/domain/data/admin-repository/mod.ts";
import type { OrgId } from "@core/data/deno-kv/mod.ts";
import { DEFAULT_QUESTION_ORDER } from "@core/business/question-order/mod.ts";
import {
  editableDepartments, getDepartmentQuestionOrder, getManagerQuestionOrder, loadQuestionOrders,
  saveDepartmentQuestionOrder, saveQuestionOrderForDepartments,
} from "./mod.ts";

function uniqueOrg(tag: string): OrgId {
  return (`test-qorder-${tag}-${crypto.randomUUID().slice(0, 8)}`) as unknown as OrgId;
}

Deno.test("REQ-053: a department nobody has configured gets the default order", async () => {
  const org = uniqueOrg("default");
  const got = await getDepartmentQuestionOrder(org, "VBA PM");
  assertEquals(got.order, [...DEFAULT_QUESTION_ORDER]);
  assertEquals(got.isDefault, true);
  assertEquals(got.updatedBy, undefined);
});

Deno.test("REQ-053: a saved order is read back in that order, with who saved it and when", async () => {
  const org = uniqueOrg("save");
  const order = ["Taxes", ...DEFAULT_QUESTION_ORDER.filter((q) => q !== "Taxes")];
  const before = Date.now();
  const res = await saveDepartmentQuestionOrder(org, "VBA PM", order, "annab@monsterrg.com");
  assert(res.ok);
  const got = await getDepartmentQuestionOrder(org, "VBA PM");
  assertEquals(got.order, order);
  assertEquals(got.isDefault, false);
  assertEquals(got.updatedBy, "annab@monsterrg.com");
  assert((got.updatedAt ?? 0) >= before);
});

Deno.test("REQ-055: the order lives on the department — another department keeps its own", async () => {
  const org = uniqueOrg("perdept");
  const flipped = [...DEFAULT_QUESTION_ORDER].reverse();
  await saveDepartmentQuestionOrder(org, "GS MB", flipped, "kaylier@monsterrg.com");
  const lists = await loadQuestionOrders(org, ["GS MB", "VO MB"]);
  assertEquals(lists["GS MB"], flipped);
  assertEquals(lists["VO MB"], [...DEFAULT_QUESTION_ORDER]);
});

Deno.test("REQ-055: managers sharing a department share one list — the last save wins", async () => {
  const org = uniqueOrg("shared");
  await saveDepartmentQuestionOrder(org, "GS MB", ["Age"], "kaylier@monsterrg.com");
  await saveDepartmentQuestionOrder(org, "GS MB", ["Taxes"], "brantleyd@monsterrg.com");
  const got = await getDepartmentQuestionOrder(org, "GS MB");
  assertEquals(got.order[0], "Taxes");
  assertEquals(got.updatedBy, "brantleyd@monsterrg.com");
});

Deno.test("REQ-055: a save with no department or no questions is refused", async () => {
  const org = uniqueOrg("bad");
  assertEquals(await saveDepartmentQuestionOrder(org, "  ", ["Age"], "x@monsterrg.com"), { ok: false, error: "department-required" });
  assertEquals(await saveDepartmentQuestionOrder(org, "VBA PM", [], "x@monsterrg.com"), { ok: false, error: "order-required" });
});

Deno.test("REQ-055: a manager edits the departments in their scope; a VO login edits none; an admin edits every scoped department", async () => {
  const org = uniqueOrg("rights");
  await saveManagerScope(org, "garrettc@monsterrg.com", { departments: ["WST DS", "GS WST"], shifts: [] });
  await saveManagerScope(org, "annab@monsterrg.com", { departments: ["VBA PM"], shifts: [] });
  await saveManagerScope(org, "vbapmvo@monsterrg.com", { departments: ["VBA PM"], shifts: [] });
  assertEquals(await editableDepartments(org, { role: "manager", email: "garrettc@monsterrg.com" }), ["GS WST", "WST DS"]);
  assertEquals(await editableDepartments(org, { role: "vo", email: "vbapmvo@monsterrg.com" }), []);
  assertEquals(await editableDepartments(org, { role: "admin", email: "admin@monsterrg.com" }), ["GS WST", "VBA PM", "WST DS"]);
});

Deno.test("REQ-055 AMENDMENT: one save writes the order to every department given", async () => {
  const org = uniqueOrg("multi");
  const order = ["MCC Recurring Charges Disclosed?", ...DEFAULT_QUESTION_ORDER.filter((q) => q !== "MCC Recurring Charges Disclosed?")];
  const res = await saveQuestionOrderForDepartments(org, ["VBA AM", "VBA PM"], order, "demo@monsterrg.com");
  assert(res.ok);
  const lists = await loadQuestionOrders(org, ["VBA AM", "VBA PM"]);
  assertEquals(lists["VBA AM"], order);
  assertEquals(lists["VBA PM"], order);
  // …and saving again replaces it in both, at once.
  await saveQuestionOrderForDepartments(org, ["VBA AM", "VBA PM"], [...DEFAULT_QUESTION_ORDER], "demo@monsterrg.com");
  const again = await loadQuestionOrders(org, ["VBA AM", "VBA PM"]);
  assertEquals(again["VBA AM"][0], "Income");
  assertEquals(again["VBA PM"][0], "Income");
});

Deno.test("REQ-055 AMENDMENT: a manager's list is the most recently saved one among their departments, flagged when they differ", async () => {
  const org = uniqueOrg("newest");
  const none = await getManagerQuestionOrder(org, ["VBA AM", "VBA PM"]);
  assertEquals(none.order, [...DEFAULT_QUESTION_ORDER]);
  assertEquals(none.isDefault, true);
  assertEquals(none.mixed, false);

  await saveDepartmentQuestionOrder(org, "VBA AM", ["Age"], "a@monsterrg.com");
  await new Promise((r) => setTimeout(r, 5));
  await saveDepartmentQuestionOrder(org, "VBA PM", ["Taxes"], "b@monsterrg.com");
  const got = await getManagerQuestionOrder(org, ["VBA AM", "VBA PM"]);
  assertEquals(got.order[0], "Taxes");
  assertEquals(got.updatedBy, "b@monsterrg.com");
  assertEquals(got.mixed, true);
});

Deno.test("REQ-055 AMENDMENT: a save for no departments is refused", async () => {
  const org = uniqueOrg("nodepts");
  assertEquals(await saveQuestionOrderForDepartments(org, [], ["Age"], "x@monsterrg.com"), { ok: false, error: "department-required" });
});
