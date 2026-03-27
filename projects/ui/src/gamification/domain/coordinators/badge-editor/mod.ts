import { Component } from "@sprig/kit";

export interface BadgeItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  price: number;
  rarity?: string;
  description?: string;
  preview?: string;
  _source?: "builtin" | "custom";
}

export interface ToastMessage {
  msg: string;
  type: string;
}

@Component({ template: "./mod.html", island: true })
export class BadgeEditorCoordinator {
  allItems: BadgeItem[] = [];
  activeFilter = "all";
  modalOpen = false;
  modalMode: "create" | "edit" = "create";
  toasts: ToastMessage[] = [];

  loadItems() {
    // Coordinator fetches items from GamificationApi
  }

  saveItem() {
    // Coordinator saves item via GamificationApi
  }

  deleteItem(_id: string) {
    // Coordinator deletes item via GamificationApi
  }

  openModal() {
    this.modalOpen = true;
  }

  closeModal() {
    this.modalOpen = false;
  }
}
