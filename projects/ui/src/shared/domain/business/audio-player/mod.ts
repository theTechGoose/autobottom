import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class AudioPlayer {
  @Input() src: string = "";

  playing = false;
  currentTime = "0:00";
  fillPct = 0;

  toggle() {
    this.playing = !this.playing;
  }

  onTimeUpdate(current: number, duration: number) {
    this.currentTime = `${this.formatTime(current)}/${this.formatTime(duration)}`;
    if (duration > 0) {
      this.fillPct = (current / duration) * 100;
    } else {
      this.fillPct = 0;
    }
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }
}
