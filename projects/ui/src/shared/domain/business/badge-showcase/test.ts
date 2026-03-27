import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BadgeShowcase } from "./mod.ts";

Deno.test("BadgeShowcase - default badges is empty array", () => {
  const showcase = new BadgeShowcase();
  assertEquals(showcase.badges, []);
});

Deno.test("BadgeShowcase - default earnedIds is empty array", () => {
  const showcase = new BadgeShowcase();
  assertEquals(showcase.earnedIds, []);
});

Deno.test("BadgeShowcase - default tierColors is empty object", () => {
  const showcase = new BadgeShowcase();
  assertEquals(showcase.tierColors, {});
});

Deno.test("BadgeShowcase - isEarned returns true for earned badge", () => {
  const showcase = new BadgeShowcase();
  showcase.earnedIds = ["badge-1", "badge-3"];
  assertEquals(showcase.isEarned("badge-1"), true);
  assertEquals(showcase.isEarned("badge-3"), true);
});

Deno.test("BadgeShowcase - isEarned returns false for unearned badge", () => {
  const showcase = new BadgeShowcase();
  showcase.earnedIds = ["badge-1"];
  assertEquals(showcase.isEarned("badge-2"), false);
});

Deno.test("BadgeShowcase - getTierColor returns color for known tier", () => {
  const showcase = new BadgeShowcase();
  showcase.tierColors = { gold: "#FFD700", silver: "#C0C0C0" };
  assertEquals(showcase.getTierColor("gold"), "#FFD700");
  assertEquals(showcase.getTierColor("silver"), "#C0C0C0");
});

Deno.test("BadgeShowcase - getTierColor returns empty string for unknown tier", () => {
  const showcase = new BadgeShowcase();
  showcase.tierColors = { gold: "#FFD700" };
  assertEquals(showcase.getTierColor("bronze"), "");
});

Deno.test("BadgeShowcase - badges can be set with full objects", () => {
  const showcase = new BadgeShowcase();
  const badges = [
    { id: "b1", name: "First Steps", tier: "bronze" },
    { id: "b2", name: "Expert", tier: "gold", icon: "star", description: "Reached expert level" },
  ];
  showcase.badges = badges;
  assertEquals(showcase.badges.length, 2);
  assertEquals(showcase.badges[0].name, "First Steps");
  assertEquals(showcase.badges[1].icon, "star");
});
