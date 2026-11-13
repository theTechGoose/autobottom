/** The Configure page's header block (REQ-055 AMENDMENT): a manager's list
 *  applies to all their departments; an admin edits one department. */
import { assert } from "@std/assert";
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { renderEditingScope } from "../../routes/manager/configure.tsx";

Deno.test("REQ-055 AMENDMENT: a manager with two departments is told the list applies to both", () => {
  const html = renderHTML(renderEditingScope({ scope: "manager", departments: ["VBA AM", "VBA PM"], department: "", order: [] }));
  assertContains(html, "Applies to all your departments");
  assertContains(html, "<strong>VBA AM</strong>");
  assertContains(html, "<strong>VBA PM</strong>");
  assertContains(html, "share its order");
  assertNotContains(html, "qo-mixed");
});

Deno.test("REQ-055 AMENDMENT: when the manager's departments differ, the page warns that Save lines them up", () => {
  const html = renderHTML(renderEditingScope({ scope: "manager", mixed: true, departments: ["VBA AM", "VBA PM"], department: "", order: [] }));
  assertContains(html, "qo-mixed");
  assertContains(html, "Save sets them all to it");
});

Deno.test("REQ-055 AMENDMENT: a one-department manager reads 'Applies to', an admin reads 'Editing the order for'", () => {
  const one = renderHTML(renderEditingScope({ scope: "manager", departments: ["VBA PM"], department: "", order: [] }));
  assert(one.includes("Applies to <strong>VBA PM</strong>") || /Applies to\s*(<!-- -->)?<strong>VBA PM<\/strong>/.test(one), one);
  assertNotContains(one, "all your departments");
  const admin = renderHTML(renderEditingScope({ scope: "department", departments: ["A", "B"], department: "B", order: [] }));
  assertContains(admin, "Editing the order for");
  assertContains(admin, "<strong>B</strong>");
});
