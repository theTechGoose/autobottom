import { Component } from "@sprig/kit";

export interface SoundPack {
  id: string;
  name: string;
  slots?: Record<string, string>;
}

export interface ToastMessage {
  msg: string;
  type: string;
}

@Component({ template: "./mod.html", island: true })
export class GamificationSettingsCoordinator {
  tab: "settings" | "packs" = "settings";
  threshold = 0;
  comboTimeoutMs = 10000;
  gsEnabled = true;
  activePack = "synth";
  role = "";
  packs: SoundPack[] = [];
  selectedPackId = "";
  toasts: ToastMessage[] = [];

  loadSettings() {
    // Coordinator fetches from GamificationApi and populates state
  }

  loadPacks() {
    // Coordinator fetches packs from GamificationApi
  }

  saveSettings() {
    // Coordinator saves via GamificationApi
  }

  selectPack(packId: string) {
    this.selectedPackId = packId;
  }

  createPack() {
    // Coordinator creates pack via GamificationApi
  }

  deletePack() {
    // Coordinator deletes pack via GamificationApi
  }
}
