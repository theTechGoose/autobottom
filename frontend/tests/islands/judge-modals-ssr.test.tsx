/** Regression guard for JudgeModals.tsx server-side rendering.
 *
 *  JudgeModals is a Preact island, so Fresh server-renders it as part of the
 *  /judge page before hydration. It reads the hidden `hx-email` field and the
 *  uphold button's data — but ALL of that must happen inside click handlers /
 *  useEffect, which only run in the browser. A `document.getElementById(...)`
 *  evaluated during render throws on the server (`document is not defined`) and
 *  500s the entire /judge page.
 *
 *  Shipped exactly that bug once: the uphold-reason rewrite computed
 *  `const judgeEmail = document.getElementById("hx-email")...` at render time.
 *  Every judge got a 500. This test renders the island with no DOM present —
 *  if anything touches `document` during render, renderToString throws and this
 *  fails. With both modals closed (initial state) it renders to (near-)nothing.
 */
import { renderHTML } from "../helpers/render.ts";
import { assert } from "@std/assert";
import JudgeModals from "../../islands/JudgeModals.tsx";

Deno.test("JudgeModals — server-renders without a DOM (no render-time document access)", () => {
  // The assertion is simply that this does not throw. `document` is undefined in
  // the test runtime, mirroring the server. A render-time DOM read would crash.
  const html = renderHTML(<JudgeModals />);
  assert(typeof html === "string", "JudgeModals must server-render to a string");
});
