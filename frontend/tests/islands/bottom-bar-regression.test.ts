/** Source-level regression guard for BottomBar.tsx audio behaviour.
 *
 *  Why a source-level check: BottomBar is a Preact island that owns the
 *  HTMLAudioElement, an AudioContext for waveform decoding, and a stack of
 *  document-level listeners. A real DOM/JSDOM unit test would be heavy and
 *  flaky. These tests instead read the source file and assert the structural
 *  invariants that have failed before — both bug fixes have a one-line
 *  signature that's easy to regress and easy to assert.
 *
 *  Reported regressions:
 *  - "When I try to speed up the audio/slow it down it starts the audio over
 *    from the beginning." Cause: `speed` state in the audio useEffect's deps
 *    triggered a teardown→rebuild on every bump, which reset
 *    `currentLoadFid` and re-assigned `audio.src`, resetting `currentTime`.
 *    Fix: speed lives in a ref the effect closure reads; setSpeed only
 *    drives the speed-badge render. */

const SRC = await Deno.readTextFile(
  new URL("../../islands/BottomBar.tsx", import.meta.url),
);

Deno.test("BottomBar: useEffect dep array MUST NOT contain `speed`", () => {
  // Match `}, [<deps>]);` near the end of the audio useEffect — accept
  // anything that isn't a `speed` token in there.
  const m = SRC.match(/\},\s*\[([^\]]+)\]\s*\)\s*;\s*\n\s*\/\/\s*Gamification/);
  if (!m) {
    throw new Error(
      "Could not locate the audio useEffect's dep array. The file shape changed — update this test, but first verify `speed` is still NOT a dep.",
    );
  }
  const deps = m[1];
  if (/\bspeed\b/.test(deps)) {
    throw new Error(
      `Regression: \`speed\` is back in the audio useEffect deps (\`[${deps}]\`). ` +
        `Adding speed there causes the effect to tear down + rebuild on every bumpSpeed call, ` +
        `which resets currentLoadFid and re-assigns audio.src, restarting playback at 0:00. ` +
        `Use the speedRef instead — see the speedRef declaration comment in BottomBar.tsx.`,
    );
  }
});

Deno.test("BottomBar: speedRef must exist and be read inside loadFinding", () => {
  if (!/const\s+speedRef\s*=\s*useRef\b/.test(SRC)) {
    throw new Error(
      "Regression: `speedRef` was removed. The audio useEffect closure must read speed " +
        "from a ref so changing speed doesn't require putting `speed` in the dep array.",
    );
  }
  // loadFinding sets audio.playbackRate from the ref, not the state.
  if (!/audio!\.playbackRate\s*=\s*speedRef\.current/.test(SRC)) {
    throw new Error(
      "Regression: loadFinding no longer assigns playbackRate from speedRef.current. " +
        "If you switched back to reading state, speed bumps will reset audio on the next finding load.",
    );
  }
});

Deno.test("BottomBar: bumpSpeed must update the ref BEFORE setting audio.playbackRate / state", () => {
  // We don't enforce ordering with a regex, but we do enforce that the ref
  // is updated. If someone forgets to update speedRef, the next loadFinding
  // call (e.g. on htmx swap) loads at the previous speed.
  const idx = SRC.indexOf("function bumpSpeed");
  if (idx < 0) throw new Error("bumpSpeed function not found");
  const slice = SRC.slice(idx, idx + 600);
  if (!/speedRef\.current\s*=\s*next/.test(slice)) {
    throw new Error(
      "Regression: bumpSpeed no longer writes to speedRef. Without this, the next " +
        "audio.src reassignment (htmx swap → loadFinding) resets playbackRate to the stale ref value.",
    );
  }
});
