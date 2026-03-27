import { Component, Input } from "@sprig/kit";

interface TranscriptLine {
  speaker?: string;
  text: string;
  isCurrent: boolean;
}

@Component({ template: "./mod.html", island: true })
export class TranscriptPanel {
  @Input() diarized: string = "";
  @Input() raw: string = "";

  searchOpen = false;
  searchQuery = "";
  searchMatchCount = 0;
  searchActiveIdx = -1;
  colOffset = 0;

  openSearch() {
    this.searchOpen = true;
  }

  closeSearch() {
    this.searchOpen = false;
    this.searchQuery = "";
    this.searchMatchCount = 0;
  }

  nextMatch() {
    if (this.searchMatchCount === 0) return;
    if (this.searchActiveIdx < 0) {
      this.searchActiveIdx = 0;
    } else {
      this.searchActiveIdx = (this.searchActiveIdx + 1) % this.searchMatchCount;
    }
  }

  prevMatch() {
    if (this.searchMatchCount === 0) return;
    if (this.searchActiveIdx <= 0) {
      this.searchActiveIdx = this.searchMatchCount - 1;
    } else {
      this.searchActiveIdx = this.searchActiveIdx - 1;
    }
  }

  scrollLeft() {
    this.colOffset = Math.max(0, this.colOffset - 1);
  }

  scrollRight() {
    this.colOffset = this.colOffset + 1;
  }

  get lines(): TranscriptLine[] {
    const text = this.diarized || this.raw || "";
    if (!text) return [];

    const rawLines = text.split("\n");
    const result: TranscriptLine[] = [];

    for (const line of rawLines) {
      if (!line.trim()) continue;

      const match = line.match(
        /^\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\]?[:\s]*(.*)/i,
      );

      if (match) {
        const speaker = match[1].toUpperCase();
        const content = match[2] || "";
        result.push({ speaker, text: content, isCurrent: false });
      } else {
        result.push({ text: line, isCurrent: false });
      }
    }

    return result;
  }
}
