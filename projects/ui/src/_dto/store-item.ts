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

export const RARITY_LABELS: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const TIER_COLORS: Record<string, string> = {
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

export const CATEGORY_META: Record<string, { label: string; description: string }> = {
  badge: { label: "Badges", description: "Collectible achievement badges" },
  title: { label: "Titles", description: "Display titles for your profile" },
  avatar_frame: { label: "Frames", description: "Avatar border frames" },
  effect: { label: "Effects", description: "Visual effects and animations" },
  sound: { label: "Sounds", description: "Custom sound effects" },
};
