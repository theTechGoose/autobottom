import { Component, Input } from "@sprig/kit";

interface Badge {
  id: string;
  name: string;
  tier: string;
  icon?: string;
  description?: string;
}

@Component({ template: "./mod.html" })
export class BadgeShowcase {
  @Input() badges: Badge[] = [];
  @Input() earnedIds: string[] = [];
  @Input() tierColors: Record<string, string> = {};

  isEarned(id: string): boolean {
    return this.earnedIds.includes(id);
  }

  getTierColor(tier: string): string {
    return this.tierColors[tier] ?? "";
  }
}
