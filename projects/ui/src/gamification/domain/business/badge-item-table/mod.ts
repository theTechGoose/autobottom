import { Component, Input } from "@sprig/kit";

export interface BadgeTableItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  price: number;
  rarity?: string;
  _source?: "builtin" | "custom";
}

@Component({ template: "./mod.html" })
export class BadgeItemTable {
  @Input() items: BadgeTableItem[] = [];
}
