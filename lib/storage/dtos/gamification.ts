/** DTOs for gamification, badges, sound packs. */

export class GamificationSettingsDto {
  threshold: number | null = null;
  comboTimeoutMs: number | null = null;
  enabled: boolean | null = null;
  sounds: Partial<Record<string, string>> | null = null;
}

export class SoundPackMeta {
  id = "";
  name = "";
  slots: Partial<Record<string, string>> = {};
  createdAt = 0;
  createdBy = "";
}

export class CustomStoreItem {
  id = "";
  name = "";
  description = "";
  price = 0;
  type = "";
  icon = "";
  rarity = "";
  preview?: string;
}

export class EarnedBadgeDto { badgeId = ""; earnedAt = 0; }
export class BadgeStatsDto { totalDecisions = 0; }
export class GameStateDto { totalXp = 0; tokenBalance = 0; level = 0; }
