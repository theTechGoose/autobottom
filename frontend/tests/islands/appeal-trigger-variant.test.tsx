/** AppealModal's triggers have two placements and only the triggers differ — the
 *  overlays are identical in both.
 *
 *  "block" is the audit report's centred button row, whose spacing was an inline
 *  style on the wrapper. The manager remediation topbar needs the same controls
 *  in a toolbar row, where that spacing pushed them out of line and the 9px/28px
 *  padding made them tower over the btn-sm buttons beside them. These pin that
 *  "inline" opts out and that the report's default is untouched. */
import { renderHTML } from "../helpers/render.ts";
import { assert, assertEquals } from "@std/assert";
import AppealModal from "../../islands/AppealModal.tsx";

const ARGS = {
  findingId: "fid-1",
  auditorEmail: "manager@monsterrg.com",
  failedQuestions: [{ index: 1, header: "Conf Email", answer: "No" }],
};

const LABELS = [">Add Genie<", ">Direct Upload<", ">Appeal Decision<"];

Deno.test("AppealModal — default trigger keeps the report's block placement", () => {
  const html = renderHTML(<AppealModal {...ARGS} />);
  assert(html.includes("appeal-trigger"), "trigger wrapper must carry the class");
  assert(!html.includes("appeal-trigger--inline"), "default must NOT be the inline variant");
});

Deno.test("AppealModal — inline variant opts into the toolbar placement", () => {
  const html = renderHTML(<AppealModal {...ARGS} variant="inline" />);
  assert(html.includes("appeal-trigger--inline"), "inline variant must carry its modifier class");
  // The spacing that broke the toolbar row was a hardcoded inline style; it must
  // live in CSS now or the modifier has nothing to override.
  assert(!html.includes("margin:14px"), "wrapper spacing must not be an inline style");
});

Deno.test("REQ-017: an appealable audit shows Add Genie, Direct Upload, Appeal Decision — in that order, in either variant", () => {
  for (const variant of ["block", "inline"] as const) {
    const html = renderHTML(<AppealModal {...ARGS} variant={variant} />);
    const at = LABELS.map((l) => html.indexOf(l));
    assert(at.every((i) => i >= 0), `${variant}: all three buttons render (${at})`);
    assertEquals([...at].sort((a, b) => a - b), at, `${variant}: Add Genie, then Direct Upload, then Appeal Decision`);
    assert(!html.includes("File Appeal"), `${variant}: the old single File Appeal button is gone`);
  }
});

Deno.test("REQ-020: a filed appeal replaces all three with Appeal Filed, in either variant", () => {
  for (const variant of ["block", "inline"] as const) {
    const html = renderHTML(<AppealModal {...ARGS} variant={variant} appealedAt={1} />);
    assert(html.includes("Appeal Filed"), `${variant}: filed appeal must show the locked label`);
    assert(html.includes("disabled"), `${variant}: filed appeal must not be re-fileable`);
    for (const l of LABELS) assert(!html.includes(l), `${variant}: ${l} must not render once filed`);
  }
});

Deno.test("REQ-020: a re-audited finding replaces all three with View New Report linking the new audit", () => {
  for (const variant of ["block", "inline"] as const) {
    const html = renderHTML(<AppealModal {...ARGS} variant={variant} reAuditedAt={1} reAuditedTo="fid-new" />);
    assert(html.includes(">View New Report<"), `${variant}: the one remaining control is View New Report`);
    assert(html.includes(`href="/audit/report?id=fid-new"`), `${variant}: it links the new audit`);
    for (const l of LABELS) assert(!html.includes(l), `${variant}: ${l} must not render once re-audited`);
  }
});

Deno.test("REQ-020: a re-audit with no new id on record stays a locked Re-Audited pill", () => {
  const html = renderHTML(<AppealModal {...ARGS} reAuditedAt={1} />);
  assert(html.includes(">Re-Audited<"), "nothing to link, so it says what happened");
  assert(html.includes("disabled"), "and can't be clicked");
  for (const l of LABELS) assert(!html.includes(l), `${l} must not render once re-audited`);
});

Deno.test("REQ-003: an audit awaiting review shows a locked button, not the appeal buttons", () => {
  for (const variant of ["block", "inline"] as const) {
    const html = renderHTML(<AppealModal {...ARGS} variant={variant} awaitingReview />);
    assert(html.includes("Awaiting Review"), `${variant}: must say why it is locked`);
    assert(html.includes("disabled"), `${variant}: must not be clickable`);
    for (const l of LABELS) assert(!html.includes(l), `${variant}: ${l} must not render`);
  }
});

Deno.test("REQ-021: each appeal button carries its own colour class", () => {
  const html = renderHTML(<AppealModal {...ARGS} />);
  for (const cls of ["appeal-btn--genie", "appeal-btn--upload", "appeal-btn--decision"]) {
    assert(html.includes(cls), `${cls} must be on its button`);
  }
});
