import { Component } from "@sprig/kit";

export interface StoreItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  description?: string;
  price: number;
  rarity?: string;
  preview?: string;
}

export interface ToastMessage {
  msg: string;
  type: string;
}

@Component({ template: "./mod.html", island: true })
export class StoreCoordinator {
  loading = true;
  items: StoreItem[] = [];
  balance = 0;
  purchased: string[] = [];
  level = 1;
  totalXp = 0;
  activeCategory = "";
  toasts: ToastMessage[] = [];

  loadStore() {
    // Coordinator fetches store data from GamificationApi
  }

  buyItem(_itemId: string) {
    // Coordinator purchases item via GamificationApi
  }
}
