import { renderHTML, assertContains } from "../helpers/render.ts";
import { DataTable } from "../../components/DataTable.tsx";

const COLS = [
  { key: "name", label: "Name" },
  { key: "score", label: "Score", mono: true },
];

const ROWS = [
  { name: "Alice", score: 95 },
  { name: "Bob", score: 80 },
];

Deno.test("DataTable — renders column headers", () => {
  const html = renderHTML(<DataTable columns={COLS} rows={ROWS} />);
  assertContains(html, "<th");
  assertContains(html, "Name");
  assertContains(html, "Score");
});

Deno.test("DataTable — renders row data", () => {
  const html = renderHTML(<DataTable columns={COLS} rows={ROWS} />);
  assertContains(html, "Alice");
  assertContains(html, "95");
  assertContains(html, "Bob");
});

Deno.test("DataTable — renders empty message when no rows", () => {
  const html = renderHTML(<DataTable columns={COLS} rows={[]} emptyMessage="Nothing here" />);
  assertContains(html, "Nothing here");
});

Deno.test("DataTable — default empty message is No data", () => {
  const html = renderHTML(<DataTable columns={COLS} rows={[]} />);
  assertContains(html, "No data");
});

Deno.test("DataTable — mono class applied to column", () => {
  const html = renderHTML(<DataTable columns={COLS} rows={ROWS} />);
  assertContains(html, "mono");
});
