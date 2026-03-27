import { Component, Input } from "@sprig/kit";

@Component({ template: "./mod.html", island: true })
export class SoundPackSelector {
  @Input() packs: string[] = ["default", "retro", "arcade"];

  selectedPacks: string[] = [];

  togglePack(name: string) {
    const idx = this.selectedPacks.indexOf(name);
    if (idx >= 0) {
      this.selectedPacks = this.selectedPacks.filter((p) => p !== name);
    } else {
      this.selectedPacks = [...this.selectedPacks, name];
    }
  }

  isSelected(name: string): boolean {
    return this.selectedPacks.includes(name);
  }
}
