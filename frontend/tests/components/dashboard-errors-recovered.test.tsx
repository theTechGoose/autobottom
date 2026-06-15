/** Recovered-error labelling on the admin dashboard.
 *
 *  A caught-and-continue error whose audit still finished (e.g. an
 *  ask-all:pinecone embed timeout) is tagged `recovered` by the backend. The
 *  dashboard must show it as recovered (visible but dimmed/badged) and exclude
 *  it from the red "Errors (24h)" fault count — so a finished audit no longer
 *  reads as a failure. */
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { assert, assertEquals } from "@std/assert";
import { DashboardTables, errorRowKey, type ErrorItem } from "../../components/DashboardTables.tsx";
import { StatGrid } from "../../components/StatGrid.tsx";

const mixed: ErrorItem[] = [
  { findingId: "fGenuine1", step: "init", error: "The signal has been aborted", ts: 1_000 },
  { findingId: "fRecovered1", step: "ask-all:pinecone", error: "OpenAI embed timed out after 30s", ts: 2_000, recovered: true },
];

Deno.test("DashboardTables — recovered rows are excluded from the table", () => {
  // The table shows only errors that actually broke a run. A recovered row
  // (audit still finished) must not render at all — no row, no badge.
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={mixed} />);
  // Genuine fault renders.
  assertContains(html, "The signal has been aborted");
  assertContains(html, "init");
  // Recovered row is gone — its error text, its step, and the badge are absent.
  assertNotContains(html, "OpenAI embed timed out after 30s");
  assertNotContains(html, "ask-all:pinecone");
  assertNotContains(html, "recovered");
});

Deno.test("DashboardTables — genuine faults sort newest-first", () => {
  const faults: ErrorItem[] = [
    { findingId: "fOld", step: "init", error: "older fault", ts: 1_000 },
    { findingId: "fNew", step: "prepare", error: "newer fault", ts: 3_000 },
  ];
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={faults} />);
  assert(
    html.indexOf("newer fault") < html.indexOf("older fault"),
    "newer genuine fault must render before the older one",
  );
});

Deno.test("DashboardTables — header counts genuine faults only", () => {
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={mixed} />);
  // mixed has 1 genuine + 1 recovered → header shows "1 fault", no recovered split.
  assertContains(html, "1 fault");
  assertNotContains(html, "recovered");
});

Deno.test("DashboardTables — an all-recovered feed renders an empty table", () => {
  const allRecovered: ErrorItem[] = [
    { findingId: "r1", step: "ask-all:pinecone", error: "embed timeout", ts: 1, recovered: true },
  ];
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={allRecovered} />);
  assertContains(html, "No errors");
  assertNotContains(html, "embed timeout");
});

// Preact keys aren't emitted into SSR HTML, so the collision fix can't be seen
// in a render test — assert the key helper directly. One finding logging two
// steps must yield distinct keys.
Deno.test("errorRowKey — distinct for same finding across steps / timestamps", () => {
  const base = { findingId: "f1", error: "boom", ts: 5 } as const;
  assert(errorRowKey({ ...base, step: "init" }) !== errorRowKey({ ...base, step: "ask-all" }), "different step → different key");
  assert(errorRowKey({ ...base, step: "init" }) !== errorRowKey({ ...base, step: "init", ts: 6 }), "different ts → different key");
  assertEquals(errorRowKey({ ...base, step: "init" }), "f1:5:init");
});

/** Slice the html to the Errors (24h) StatCard so value assertions don't match
 *  a zero from a sibling card. */
function errorsCard(html: string): string {
  const i = html.indexOf("Errors (24h)");
  return i >= 0 ? html.slice(i, i + 200) : "";
}

Deno.test("StatGrid — Errors card counts genuine faults only, notes recovered", () => {
  const html = renderHTML(<StatGrid p={{ errors: mixed }} />);
  assertContains(html, "Errors (24h)");
  assertContains(html, "1 recovered");
  // The red value is the genuine count (1), not the total (2).
  assertContains(errorsCard(html), ">1<");
  assertNotContains(html, "2 unique");
});

Deno.test("StatGrid — prefers the backend genuineErrors24h count over the row list", () => {
  // Row list derives to 1 genuine fault, but the authoritative 24h count is 7.
  const html = renderHTML(<StatGrid p={{ errors: mixed, genuineErrors24h: 7 }} />);
  assertContains(errorsCard(html), ">7<");
});

Deno.test("StatGrid — a legitimate backend zero is preferred, not overridden", () => {
  // mixed derives to 1 genuine fault; with the nullish chain a real 0 must win
  // (a `||` regression would wrongly fall through to the row count of 1).
  const html = renderHTML(<StatGrid p={{ errors: mixed, genuineErrors24h: 0 }} />);
  assertContains(errorsCard(html), ">0<");
});

Deno.test("StatGrid — recovered sub uses the backend 24h count when provided", () => {
  // Value + sub both come from the 24h backend numbers (not the 8-day row list).
  const html = renderHTML(<StatGrid p={{ errors: mixed, genuineErrors24h: 0, recoveredErrors24h: 4 }} />);
  assertContains(errorsCard(html), ">0<");
  assertContains(html, "4 recovered");
});

Deno.test("StatGrid — all-recovered errors read as 0 faults", () => {
  const allRecovered: ErrorItem[] = [
    { findingId: "r1", step: "ask-all:pinecone", error: "embed timeout", ts: 1, recovered: true },
  ];
  const html = renderHTML(<StatGrid p={{ errors: allRecovered }} />);
  // The genuine-fault value renders 0, with the recovered count surfaced.
  assertContains(errorsCard(html), ">0<");
  assertContains(html, "1 recovered");
});
