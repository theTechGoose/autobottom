/** Island: scrub interactions for the manager remediation detail page
 *  (/manager/remediate/[findingId]). Two behaviors, both delegated at the
 *  document level so no per-node hydration is needed:
 *
 *   1. Click a transcript line  → seek the audio to that line's timestamp.
 *   2. Click a FAILED question  → find the transcript line that best matches
 *      that question's evidence (the bot's defense/reasoning quotes), scroll it
 *      into view, highlight it, and seek the audio there.
 *
 *  Both paths dispatch `queue:jump-to-audio`, which the QueueAudioPlayer island
 *  on the same page consumes to move the playhead. The evidence-matching mirrors
 *  the reviewer/judge TranscriptInteractive heuristic, but is keyed off a
 *  clicked question's data-attributes instead of the single "current" question
 *  in the VerdictPanel DOM. Renders nothing — this is a plain full page (no HTMX
 *  swaps of the transcript), so one mount for the page lifetime is enough. */
import { useEffect } from "preact/hooks";

export default function RemediationInteractive() {
  useEffect(() => {
    // Normalize smart quotes → ASCII so quote extraction is consistent.
    function normalize(s: string): string {
      return s
        .replace(/[“”„‟]/g, '"')
        .replace(/[‘’‚‛]/g, "'");
    }
    // Pull quoted substrings (≥10 chars) the bot cited as evidence.
    function extractQuotes(sourceRaw: string): string[] {
      const source = normalize(sourceRaw);
      const out: string[] = [];
      const re = /"([^"]{10,})"|'([^']{10,})'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source))) out.push((m[1] ?? m[2] ?? "").toLowerCase());
      return out;
    }
    // Fallback: does a transcript line share ≥min meaningful words with evidence?
    function wordOverlap(line: string, words: string[], min: number): boolean {
      if (!line) return false;
      const lower = line.toLowerCase();
      let hits = 0;
      for (const w of words) {
        if (w.length < 3) continue;
        if (lower.includes(w)) { hits++; if (hits >= min) return true; }
      }
      return false;
    }

    function transcriptLines(): HTMLElement[] {
      const body = document.getElementById("transcript-body");
      if (!body) return [];
      return Array.from(body.querySelectorAll<HTMLElement>(".t-line"));
    }
    function textOf(line: HTMLElement): string {
      return line.querySelector<HTMLElement>(".t-text")?.textContent ?? "";
    }
    function seekToLine(line: HTMLElement) {
      const ms = line.dataset.tsMs ?? line.querySelector<HTMLElement>(".t-timestamp")?.dataset.seekMs;
      const n = Number(ms);
      if (ms && !isNaN(n)) {
        document.dispatchEvent(new CustomEvent("queue:jump-to-audio", { detail: { ms: n } }));
      }
    }

    function jumpToEvidence(qEl: HTMLElement) {
      const evidence = qEl.dataset.remEvidence ?? "";
      const all = transcriptLines();
      // Reset any prior highlight + active-question state.
      for (const l of all) l.classList.remove("t-evidence");
      document.querySelectorAll(".rem-q-active").forEach((n) => n.classList.remove("rem-q-active"));
      qEl.classList.add("rem-q-active");
      if (all.length === 0) return;

      const quotes = extractQuotes(evidence);
      const words = evidence.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);

      // Prefer an exact-ish quote match; fall back to word overlap.
      let match: HTMLElement | null = null;
      for (const line of all) {
        const lower = textOf(line).toLowerCase();
        if (quotes.some((q) => q && (lower.includes(q) || q.includes(lower.slice(0, 40))))) {
          match = line;
          break;
        }
      }
      if (!match) {
        for (const line of all) {
          if (wordOverlap(textOf(line), words, 3)) { match = line; break; }
        }
      }
      if (!match) return; // no locatable evidence (e.g. paraphrased/legacy) — no-op
      match.classList.add("t-evidence");
      match.scrollIntoView({ block: "center", behavior: "smooth" });
      seekToLine(match);
    }

    function onDocClick(e: Event) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Transcript line → seek. (Checked first: a click always lands here or on
      // a question row, never both.)
      const lineEl = target.closest<HTMLElement>("#transcript-body .t-line");
      if (lineEl) { seekToLine(lineEl); return; }
      // Failed question row → jump to its evidence.
      const qEl = target.closest<HTMLElement>("[data-rem-evidence]");
      if (qEl) jumpToEvidence(qEl);
    }

    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return null;
}
