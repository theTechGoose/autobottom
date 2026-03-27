import { assertEquals } from "jsr:@std/assert";
import { TestRunner } from "./mod.ts";

Deno.test("TestRunner: default questionId is empty string", () => {
  const c = new TestRunner();
  assertEquals(c.questionId, "");
});

Deno.test("TestRunner: default tests is empty array", () => {
  const c = new TestRunner();
  assertEquals(c.tests, []);
});

Deno.test("TestRunner: default showNew is false", () => {
  const c = new TestRunner();
  assertEquals(c.showNew, false);
});

Deno.test("TestRunner: default testSnippet is empty string", () => {
  const c = new TestRunner();
  assertEquals(c.testSnippet, "");
});

Deno.test("TestRunner: default testExpected is 'yes'", () => {
  const c = new TestRunner();
  assertEquals(c.testExpected, "yes");
});

Deno.test("TestRunner: default testStatuses is empty object", () => {
  const c = new TestRunner();
  assertEquals(c.testStatuses, {});
});

Deno.test("TestRunner: default expandedTests is empty array", () => {
  const c = new TestRunner();
  assertEquals(c.expandedTests, []);
});

Deno.test("TestRunner: toggleNew flips showNew", () => {
  const c = new TestRunner();
  c.toggleNew();
  assertEquals(c.showNew, true);
  c.toggleNew();
  assertEquals(c.showNew, false);
});

Deno.test("TestRunner: toggleExpanded adds id to expandedTests", () => {
  const c = new TestRunner();
  c.toggleExpanded("t1");
  assertEquals(c.expandedTests, ["t1"]);
});

Deno.test("TestRunner: toggleExpanded removes id if already expanded", () => {
  const c = new TestRunner();
  c.expandedTests = ["t1", "t2"];
  c.toggleExpanded("t1");
  assertEquals(c.expandedTests, ["t2"]);
});

Deno.test("TestRunner: isExpanded returns true for expanded id", () => {
  const c = new TestRunner();
  c.expandedTests = ["t1"];
  assertEquals(c.isExpanded("t1"), true);
});

Deno.test("TestRunner: isExpanded returns false for non-expanded id", () => {
  const c = new TestRunner();
  assertEquals(c.isExpanded("t1"), false);
});

Deno.test("TestRunner: getStatus returns status for known id", () => {
  const c = new TestRunner();
  c.testStatuses = { t1: "pass" };
  assertEquals(c.getStatus("t1"), "pass");
});

Deno.test("TestRunner: getStatus returns empty string for unknown id", () => {
  const c = new TestRunner();
  assertEquals(c.getStatus("t1"), "");
});
