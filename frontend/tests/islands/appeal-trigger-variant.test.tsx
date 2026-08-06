/** AppealModal's trigger has two placements and only the trigger differs — the
 *  overlays are identical in both.
 *
 *  "block" is the audit report's centred button, whose spacing was an inline
 *  style on the wrapper. The manager remediation topbar needs the same control
 *  in a toolbar row, where that spacing pushed it out of line and the 9px/28px
 *  padding made it tower over the btn-sm buttons beside it. These pin that
 *  "inline" opts out and that the report's default is untouched. */
import { renderHTML } from "../helpers/render.ts";
import { assert } from "@std/assert";
import AppealModal from "../../islands/AppealModal.tsx";

const ARGS = {
  findingId: "fid-1",
  auditorEmail: "manager@monsterrg.com",
  failedQuestions: [{ index: 1, header: "Conf Email", answer: "No" }],
};

Deno.test("AppealModal — default trigger keeps the report's block placement", () => {
  const html = renderHTML(<AppealModal {...ARGS} />);
  assert(html.includes("appeal-trigger"), "trigger wrapper must carry the class");
  assert(!html.includes("appeal-trigger--inline"), "default must NOT be the inline variant");
  assert(html.includes("File Appeal"), "an un-appealed finding gets the live button");
});

Deno.test("AppealModal — inline variant opts into the toolbar placement", () => {
  const html = renderHTML(<AppealModal {...ARGS} variant="inline" />);
  assert(html.includes("appeal-trigger--inline"), "inline variant must carry its modifier class");
  // The spacing that broke the toolbar row was a hardcoded inline style; it must
  // live in CSS now or the modifier has nothing to override.
  assert(!html.includes("margin:14px"), "wrapper spacing must not be an inline style");
});

Deno.test("AppealModal — an already-filed appeal locks the button in either variant", () => {
  for (const variant of ["block", "inline"] as const) {
    const html = renderHTML(<AppealModal {...ARGS} variant={variant} appealedAt={1} />);
    assert(html.includes("Appeal Filed"), `${variant}: filed appeal must show the locked label`);
    assert(html.includes("disabled"), `${variant}: filed appeal must not be re-fileable`);
  }
});
