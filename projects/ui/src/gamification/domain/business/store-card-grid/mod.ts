import { Component, Input } from "@sprig/kit";

export interface StoreCardItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  description?: string;
  price: number;
  rarity?: string;
  preview?: string;
}

@Component({ template: "./mod.html", island: true })
export class StoreCardGrid {
  @Input() items: StoreCardItem[] = [];
  @Input() purchased: string[] = [];

  buying = "";

  buy(itemId: string) {
    this.buying = itemId;
  }
}
