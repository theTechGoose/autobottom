/** Regression guard for the QueueAudioPlayer transport controls.
 *
 *  Managers reported the remediation scrub view had "only play/pause" — no way
 *  to skip or change speed. Two causes, one of them here: speed was reachable
 *  ONLY through the ↑/↓ keys, and the readout was `visibility:hidden` at 1×, so
 *  on a page without the hotkey island there was no speed control at all and
 *  nothing on screen hinting one existed.
 *
 *  These assert the full control set is in the SERVER-rendered markup, which is
 *  what a manager sees before (and regardless of) hydration. */
import { renderHTML } from "../helpers/render.ts";
import { assert } from "@std/assert";
import QueueAudioPlayer from "../../islands/QueueAudioPlayer.tsx";

Deno.test("QueueAudioPlayer — renders skip, play and speed controls", () => {
  const html = renderHTML(<QueueAudioPlayer initialFindingId="fid-1" />);
  for (const cls of ["qap-back", "qap-play", "qap-fwd", "qap-speed-btn", "qap-speed"]) {
    assert(html.includes(cls), `audio bar must render .${cls}`);
  }
  // Two speed buttons — slower AND faster.
  assert(html.includes('aria-label="Slower"'), "speed group needs a slower button");
  assert(html.includes('aria-label="Faster"'), "speed group needs a faster button");
});

Deno.test("QueueAudioPlayer — speed readout is visible at 1x", () => {
  const html = renderHTML(<QueueAudioPlayer initialFindingId="fid-1" />);
  const at = html.indexOf("qap-speed\"");
  assert(at > -1, "speed readout must be present");
  // It used to ship as `style="visibility:hidden"`; a hidden readout leaves the
  // −/+ buttons unlabeled and the current rate unknowable.
  assert(!html.slice(at, at + 120).includes("visibility:hidden"), "speed readout must not be hidden");
});
