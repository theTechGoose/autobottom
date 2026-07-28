/** Island: scrub interactions for the manager remediation detail page
 *  (/manager/remediate/[findingId]). Two behaviors, both delegated at the
 *  document level so no per-node hydration is needed:
 *
 *   1. Click a transcript line  → seek the audio to that line's timestamp.
 *   2. Click a FAILED question  → scroll to the transcript line the page
 *      resolved as that failure's evidence, highlight it, and seek there.
 *
 *  Both paths dispatch `queue:jump-to-audio`, which the QueueAudioPlayer island
 *  on the same page consumes to move the playhead.
 *
 *  WHY THERE'S NO MATCHING LOGIC HERE ANYMORE: this island used to locate the
 *  evidence itself at click time, scanning the whole transcript for a line that
 *  shared a few substrings with the bot's reasoning prose. On a failure whose
 *  reasoning describes what was NEVER said there is nothing real to match, and
 *  the bar was low enough that an unrelated line always cleared it — clicking a
 *  failure jumped somewhere with no bearing on it. The page now resolves the
 *  line on the server (findEvidenceLine, against the snippet the model actually
 *  graded) and emits `data-rem-line-idx`; a row with no attribute is not
 *  clickable and says so. This island just follows the pointer.
 *
 *  Renders nothing — this is a plain full page (no HTMX swaps of the
 *  transcript), so one mount for the page lifetime is enough. */
import { useEffect } from "preact/hooks";

export default function RemediationInteractive() {
  useEffect(() => {
    function seekToLine(line: HTMLElement) {
      const ms = line.dataset.tsMs ?? line.querySelector<HTMLElement>(".t-timestamp")?.dataset.seekMs;
      const n = Number(ms);
      if (ms && !isNaN(n)) {
        document.dispatchEvent(new CustomEvent("queue:jump-to-audio", { detail: { ms: n } }));
      }
    }

    function jumpToLine(qEl: HTMLElement) {
      const idx = qEl.dataset.remLineIdx;
      if (idx == null) return;
      const body = document.getElementById("transcript-body");
      const target = body?.querySelector<HTMLElement>(`.t-line[data-line-idx="${CSS.escape(idx)}"]`);
      if (!target) return;
      // Reset any prior highlight + active-question state.
      body?.querySelectorAll(".t-evidence").forEach((n) => n.classList.remove("t-evidence"));
      document.querySelectorAll(".rem-q-active").forEach((n) => n.classList.remove("rem-q-active"));
      qEl.classList.add("rem-q-active");
      target.classList.add("t-evidence");
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      seekToLine(target);
    }

    function onDocClick(e: Event) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Transcript line → seek. (Checked first: a click always lands here or on
      // a question row, never both.)
      const lineEl = target.closest<HTMLElement>("#transcript-body .t-line");
      if (lineEl) { seekToLine(lineEl); return; }
      // Failed question row with resolved evidence → jump to that line.
      const qEl = target.closest<HTMLElement>("[data-rem-line-idx]");
      if (qEl) jumpToLine(qEl);
    }

    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return null;
}
