import { z } from "zod";

export const StoreItemTypeSchema = z.enum([
  "title", "avatar_frame", "name_color", "animation",
  "theme", "flair", "font", "bubble_font", "bubble_color",
]);

export const StoreRaritySchema = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);

export const StoreItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.number(),
  type: StoreItemTypeSchema,
  icon: z.string(),
  rarity: StoreRaritySchema,
  preview: z.string().optional(),
});

export type StoreItemType = z.infer<typeof StoreItemTypeSchema>;
export type StoreRarity = z.infer<typeof StoreRaritySchema>;
export type StoreItem = z.infer<typeof StoreItemSchema>;
