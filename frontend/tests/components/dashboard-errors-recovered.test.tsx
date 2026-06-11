/** Recovered-error labelling on the admin dashboard.
 *
 *  A caught-and-continue error whose audit still finished (e.g. an
 *  ask-all:pinecone embed timeout) is tagged `recovered` by the backend. The
 *  dashboard must show it as recovered (visible but dimmed/badged) and exclude
 *  it from the red "Errors (24h)" fault count — so a finished audit no longer
 *  reads as a failure. */
import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { DashboardTables, type ErrorItem } from "../../components/DashboardTables.tsx";
import { StatGrid } from "../../components/StatGrid.tsx";

const mixed: ErrorItem[] = [
  { findingId: "fGenuine1", step: "init", error: "The signal has been aborted", ts: 1_000 },
  { findingId: "fRecovered1", step: "ask-all:pinecone", error: "OpenAI embed timed out after 30s", ts: 2_000, recovered: true },
];

Deno.test("DashboardTables — recovered error gets a 'recovered' badge", () => {
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={mixed} />);
  assertContains(html, ">recovered<");
  // The genuine fault row carries no recovered badge text of its own.
  assertContains(html, "ask-all:pinecone");
  assertContains(html, "init");
});

Deno.test("DashboardTables — header shows the fault/recovered split", () => {
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={mixed} />);
  assertContains(html, "1 fault");
  assertContains(html, "1 recovered");
});

Deno.test("DashboardTables — recovered row is dimmed", () => {
  const html = renderHTML(<DashboardTables recent={[]} active={[]} errors={mixed} />);
  assertContains(html, "opacity:0.55");
});

Deno.test("StatGrid — Errors card counts genuine faults only, notes recovered", () => {
  const html = renderHTML(<StatGrid p={{ errors: mixed }} />);
  assertContains(html, "Errors (24h)");
  assertContains(html, "1 recovered");
  // The red value is the genuine count (1), not the total (2).
  assertNotContains(html, "2 unique");
});

Deno.test("StatGrid — all-recovered errors read as 0 faults", () => {
  const allRecovered: ErrorItem[] = [
    { findingId: "r1", step: "ask-all:pinecone", error: "embed timeout", ts: 1, recovered: true },
  ];
  const html = renderHTML(<StatGrid p={{ errors: allRecovered }} />);
  assertContains(html, "1 recovered");
});
