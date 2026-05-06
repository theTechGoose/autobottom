import { assertEquals } from "@std/assert";
import { parseCsv, csvToQuestions } from "../../lib/csv.ts";

Deno.test("parseCsv — header row + simple values", () => {
  const rows = parseCsv("name,text\nGreeting,Did the agent greet?\nClose,Did the agent close?");
  assertEquals(rows, [
    { name: "Greeting", text: "Did the agent greet?" },
    { name: "Close", text: "Did the agent close?" },
  ]);
});

Deno.test("parseCsv — quoted fields with embedded commas + escaped quotes", () => {
  const rows = parseCsv(`name,text\n"Greeting","Did the agent say, \"\"hello\"\"?"\n`);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].name, "Greeting");
  assertEquals(rows[0].text, `Did the agent say, "hello"?`);
});

Deno.test("parseCsv — strips BOM + skips blank lines", () => {
  const rows = parseCsv("\uFEFFname,text\nA,1\n\n\nB,2\n");
  assertEquals(rows, [{ name: "A", text: "1" }, { name: "B", text: "2" }]);
});

Deno.test("parseCsv — embedded newline inside quoted field", () => {
  const rows = parseCsv(`name,text\nA,"line1\nline2"`);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].text, "line1\nline2");
});

Deno.test("csvToQuestions — required name+text + ignores rows missing either", () => {
  const out = csvToQuestions([
    { name: "A", text: "1" },
    { name: "", text: "skip me" },
    { name: "B", text: "" },
    { name: "C", text: "2" },
  ]);
  assertEquals(out, [
    { name: "A", text: "1" },
    { name: "C", text: "2" },
  ]);
});

Deno.test("csvToQuestions — coerces optional numeric + boolean fields", () => {
  const out = csvToQuestions([
    { name: "A", text: "x", egregious: "yes", weight: "5", temperature: "0.8", autoyesexp: "+:foo" },
    { name: "B", text: "y", egregious: "no", weight: "abc" },
  ]);
  assertEquals(out, [
    { name: "A", text: "x", autoYesExp: "+:foo", egregious: true, weight: 5, temperature: 0.8 },
    { name: "B", text: "y", egregious: false },
  ]);
});

Deno.test("csvToQuestions — accepts header alias 'header'/'question' for name/text", () => {
  const out = csvToQuestions([{ header: "Greeting", question: "Did the agent greet?" }]);
  assertEquals(out, [{ name: "Greeting", text: "Did the agent greet?" }]);
});
