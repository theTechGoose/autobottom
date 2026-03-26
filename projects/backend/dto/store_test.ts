import { assertEquals } from "@std/assert";
import { StoreItemSchema, StoreItemTypeSchema, StoreRaritySchema } from "./store.ts";

Deno.test("StoreItemType schema snapshot — all values", () => {
  for (const type of [
    "title", "avatar_frame", "name_color", "animation",
    "theme", "flair", "font", "bubble_font", "bubble_color",
  ] as const) {
    assertEquals(StoreItemTypeSchema.parse(type), type);
  }
});

Deno.test("StoreRarity schema snapshot — all values", () => {
  for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
    assertEquals(StoreRaritySchema.parse(rarity), rarity);
  }
});

Deno.test("StoreItem schema snapshot — required fields only", () => {
  const fixture = {
    id: "title-veteran",
    name: "Veteran",
    description: "Awarded for 1000 decisions.",
    price: 500,
    type: "title" as const,
    icon: "shield",
    rarity: "rare" as const,
  };
  const parsed = StoreItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});

Deno.test("StoreItem schema snapshot — with preview", () => {
  const fixture = {
    id: "theme-midnight",
    name: "Midnight Theme",
    description: "A dark theme with blue accents.",
    price: 750,
    type: "theme" as const,
    icon: "moon",
    rarity: "epic" as const,
    preview: "https://assets.example.com/themes/midnight-preview.png",
  };
  const parsed = StoreItemSchema.parse(fixture);
  assertEquals(parsed, fixture);
});
