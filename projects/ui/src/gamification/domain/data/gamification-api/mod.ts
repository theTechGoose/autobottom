import { Service } from "@sprig/kit";

export interface GamificationSettingsData {
  role: string;
  orgId?: string;
  settings: {
    threshold?: number;
    comboTimeoutMs?: number;
    enabled?: boolean;
    sounds?: Record<string, string>;
  };
}

export interface SoundPack {
  id: string;
  name: string;
  slots?: Record<string, string>;
}

export interface StoreItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  description?: string;
  price: number;
  rarity?: string;
  preview?: string;
  _source?: "builtin" | "custom";
}

export interface StoreData {
  items: StoreItem[];
  balance: number;
  purchased: string[];
  level?: number;
  totalXp?: number;
}

export interface BadgeItemsData {
  builtIn: StoreItem[];
  custom: StoreItem[];
}

@Service({ scope: "singleton" })
export class GamificationApi {
  async getSettings(): Promise<GamificationSettingsData | null> {
    const res = await fetch("/api/gamification/settings");
    if (!res.ok) return null;
    return await res.json();
  }

  async saveSettings(data: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/gamification/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.ok;
  }

  async getPacks(): Promise<SoundPack[]> {
    const res = await fetch("/api/gamification/packs");
    if (!res.ok) return [];
    return (await res.json()) || [];
  }

  async createPack(name: string): Promise<SoundPack | null> {
    const res = await fetch("/api/gamification/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    return await res.json();
  }

  async updatePack(id: string, name: string): Promise<boolean> {
    const res = await fetch(`/api/gamification/packs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  }

  async deletePack(id: string): Promise<boolean> {
    const res = await fetch(`/api/gamification/packs/${id}`, {
      method: "DELETE",
    });
    return res.ok;
  }

  async uploadSlot(
    packId: string,
    slot: string,
    file: File,
  ): Promise<{ url: string } | null> {
    const form = new FormData();
    form.append("file", file);
    form.append("packId", packId);
    form.append("slot", slot);
    const res = await fetch("/api/gamification/packs/upload", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return null;
    return await res.json();
  }

  async seedPacks(): Promise<boolean> {
    const res = await fetch("/api/gamification/packs/seed", {
      method: "POST",
    });
    return res.ok;
  }

  async getStore(): Promise<StoreData | null> {
    const res = await fetch("/api/store");
    if (!res.ok) return null;
    return await res.json();
  }

  async buyItem(itemId: string): Promise<{ newBalance: number } | null> {
    const res = await fetch("/api/store/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (!res.ok) return null;
    return await res.json();
  }

  async getBadgeItems(): Promise<BadgeItemsData | null> {
    const res = await fetch("/admin/badge-editor/items");
    if (!res.ok) return null;
    return await res.json();
  }

  async saveBadgeItem(item: StoreItem): Promise<boolean> {
    const isEdit = !!item._source;
    const url = isEdit
      ? `/admin/badge-editor/items/${item.id}`
      : "/admin/badge-editor/items";
    const res = await fetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    return res.ok;
  }

  async deleteBadgeItem(id: string): Promise<boolean> {
    const res = await fetch(`/admin/badge-editor/items/${id}`, {
      method: "DELETE",
    });
    return res.ok;
  }
}
