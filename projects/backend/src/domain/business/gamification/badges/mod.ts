/** Badge definitions, store catalog, types, and checker for the gamification system. */

// -- Types --

export type BadgeTier = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type BadgeRole = "reviewer" | "judge" | "manager" | "agent";
export type BadgeCategory = "milestone" | "speed" | "streak" | "combo" | "level" | "quality" | "special";

export interface BadgeDef {
  id: string;
  role: BadgeRole;
  tier: BadgeTier;
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  xpReward: number;
  /** Check function receives stats and returns true if badge is earned */
  check: (stats: BadgeCheckState) => boolean;
}

export interface EarnedBadge {
  badgeId: string;
  earnedAt: number;
  earnedValue?: number;
}

export interface BadgeCheckState {
  // Shared
  totalDecisions: number;
  dayStreak: number;
  lastActiveDate: string; // ISO date YYYY-MM-DD
  bestCombo: number;
  level: number;

  // Reviewer-specific
  avgSpeedMs: number;
  decisionsForAvg: number;

  // Judge-specific
  totalOverturns: number;
  consecutiveUpholds: number;

  // Manager-specific
  totalRemediations: number;
  fastRemediations24h: number;
  fastRemediations1h: number;
  queueCleared: boolean;
  allAgentsAbove80: boolean;

  // Agent-specific
  totalAudits: number;
  perfectScoreCount: number;
  avgScore: number;
  auditsForAvg: number;
  weeklyImprovement: number;
  consecutiveWeeksAbove80: number;
}

export const DEFAULT_BADGE_STATS: BadgeCheckState = {
  totalDecisions: 0,
  dayStreak: 0,
  lastActiveDate: "",
  bestCombo: 0,
  level: 0,
  avgSpeedMs: 0,
  decisionsForAvg: 0,
  totalOverturns: 0,
  consecutiveUpholds: 0,
  totalRemediations: 0,
  fastRemediations24h: 0,
  fastRemediations1h: 0,
  queueCleared: false,
  allAgentsAbove80: false,
  totalAudits: 0,
  perfectScoreCount: 0,
  avgScore: 0,
  auditsForAvg: 0,
  weeklyImprovement: 0,
  consecutiveWeeksAbove80: 0,
};

/** Unified game state for ALL roles. totalXp always increases; tokenBalance is spendable. */
export interface GameState {
  totalXp: number;
  tokenBalance: number;
  level: number;
  dayStreak: number;
  lastActiveDate: string;
  purchases: string[];
  equippedTitle: string | null;
  equippedTheme: string | null;
  animBindings: Record<string, string>; // prefab event type -> animation ID
}

export const DEFAULT_GAME_STATE: GameState = {
  totalXp: 0,
  tokenBalance: 0,
  level: 0,
  dayStreak: 0,
  lastActiveDate: "",
  purchases: [],
  equippedTitle: null,
  equippedTheme: null,
  animBindings: {},
};

export type StoreItemType =
  | "title"
  | "avatar_frame"
  | "name_color"
  | "animation"
  | "theme"
  | "flair"
  | "font"
  | "bubble_font"
  | "bubble_color";

export type StoreRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export interface StoreItem {
  id: string;
  name: string;
  description: string;
  price: number;
  type: StoreItemType;
  icon: string;
  rarity: StoreRarity;
  preview?: string;
}

export function rarityFromPrice(price: number): StoreRarity {
  if (price >= 1000) return "legendary";
  if (price >= 700) return "epic";
  if (price >= 400) return "rare";
  if (price >= 200) return "uncommon";
  return "common";
}

// -- Level Thresholds --

export const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];
export const AGENT_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000];

export function getLevel(xp: number, thresholds: number[] = LEVEL_THRESHOLDS): number {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (xp >= thresholds[i]) return i;
  }
  return 0;
}

// -- Tier Colors --

export const TIER_COLORS: Record<BadgeTier, string> = {
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

export const TIER_GLOW: Record<BadgeTier, string> = {
  common: "rgba(107,114,128,0.2)",
  uncommon: "rgba(34,197,94,0.3)",
  rare: "rgba(59,130,246,0.35)",
  epic: "rgba(168,85,247,0.4)",
  legendary: "rgba(245,158,11,0.5)",
};

// -- Badge Catalog --

export const BADGE_CATALOG: BadgeDef[] = [
  // === REVIEWER (10) ===
  {
    id: "rev_first_blood", role: "reviewer", tier: "common", name: "First Blood",
    description: "Complete your first review", icon: "🩸",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalDecisions >= 1,
  },
  {
    id: "rev_centurion", role: "reviewer", tier: "uncommon", name: "Centurion",
    description: "Complete 100 reviews", icon: "🛡️",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalDecisions >= 100,
  },
  {
    id: "rev_grinder", role: "reviewer", tier: "rare", name: "The Grinder",
    description: "Complete 1,000 reviews", icon: "⚙️",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalDecisions >= 1000,
  },
  {
    id: "rev_speed_demon", role: "reviewer", tier: "uncommon", name: "Speed Demon",
    description: "Average under 8s per decision (50+ reviews)", icon: "⚡",
    category: "speed", xpReward: 150,
    check: (s) => s.decisionsForAvg >= 50 && s.avgSpeedMs > 0 && s.avgSpeedMs < 8000,
  },
  {
    id: "rev_streak_7", role: "reviewer", tier: "uncommon", name: "Week Warrior",
    description: "7-day decision streak", icon: "📅",
    category: "streak", xpReward: 75,
    check: (s) => s.dayStreak >= 7,
  },
  {
    id: "rev_streak_30", role: "reviewer", tier: "rare", name: "Iron Will",
    description: "30-day decision streak", icon: "🔥",
    category: "streak", xpReward: 300,
    check: (s) => s.dayStreak >= 30,
  },
  {
    id: "rev_combo_10", role: "reviewer", tier: "uncommon", name: "Combo Breaker",
    description: "Reach a 10x combo", icon: "💥",
    category: "combo", xpReward: 50,
    check: (s) => s.bestCombo >= 10,
  },
  {
    id: "rev_combo_20", role: "reviewer", tier: "rare", name: "Unstoppable",
    description: "Reach a 20x combo", icon: "🌪️",
    category: "combo", xpReward: 150,
    check: (s) => s.bestCombo >= 20,
  },
  {
    id: "rev_combo_50", role: "reviewer", tier: "epic", name: "Beyond Godlike",
    description: "Reach a 50x combo", icon: "👑",
    category: "combo", xpReward: 500,
    check: (s) => s.bestCombo >= 50,
  },
  {
    id: "rev_level_10", role: "reviewer", tier: "legendary", name: "Max Level",
    description: "Reach level 10", icon: "💎",
    category: "level", xpReward: 1000,
    check: (s) => s.level >= 10,
  },

  // === JUDGE (9) ===
  {
    id: "jdg_first_verdict", role: "judge", tier: "common", name: "First Verdict",
    description: "Judge your first question", icon: "⚖️",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalDecisions >= 1,
  },
  {
    id: "jdg_arbiter", role: "judge", tier: "uncommon", name: "The Arbiter",
    description: "Judge 100 questions", icon: "🏛️",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalDecisions >= 100,
  },
  {
    id: "jdg_supreme", role: "judge", tier: "rare", name: "Supreme Court",
    description: "Judge 1,000 questions", icon: "🏛️",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalDecisions >= 1000,
  },
  {
    id: "jdg_overturn_10", role: "judge", tier: "uncommon", name: "Objection!",
    description: "Overturn 10 decisions", icon: "🔄",
    category: "quality", xpReward: 75,
    check: (s) => s.totalOverturns >= 10,
  },
  {
    id: "jdg_overturn_50", role: "judge", tier: "rare", name: "Court of Appeals",
    description: "Overturn 50 decisions", icon: "🔄",
    category: "quality", xpReward: 250,
    check: (s) => s.totalOverturns >= 50,
  },
  {
    id: "jdg_uphold_20", role: "judge", tier: "uncommon", name: "Stamp of Approval",
    description: "Uphold 20 in a row", icon: "✅",
    category: "quality", xpReward: 100,
    check: (s) => s.consecutiveUpholds >= 20,
  },
  {
    id: "jdg_combo_10", role: "judge", tier: "uncommon", name: "Swift Justice",
    description: "Reach a 10x combo", icon: "⚡",
    category: "combo", xpReward: 50,
    check: (s) => s.bestCombo >= 10,
  },
  {
    id: "jdg_streak_14", role: "judge", tier: "rare", name: "Fortnight Judge",
    description: "14-day judging streak", icon: "🔥",
    category: "streak", xpReward: 200,
    check: (s) => s.dayStreak >= 14,
  },
  {
    id: "jdg_level_10", role: "judge", tier: "legendary", name: "Grand Magistrate",
    description: "Reach level 10", icon: "💎",
    category: "level", xpReward: 1000,
    check: (s) => s.level >= 10,
  },

  // === MANAGER (9) ===
  {
    id: "mgr_first_fix", role: "manager", tier: "common", name: "First Response",
    description: "Submit your first remediation", icon: "🔧",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalRemediations >= 1,
  },
  {
    id: "mgr_fifty", role: "manager", tier: "uncommon", name: "Firefighter",
    description: "Remediate 50 items", icon: "🚒",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalRemediations >= 50,
  },
  {
    id: "mgr_two_hundred", role: "manager", tier: "rare", name: "Zero Tolerance",
    description: "Remediate 200 items", icon: "🎯",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalRemediations >= 200,
  },
  {
    id: "mgr_fast_24h", role: "manager", tier: "uncommon", name: "Rapid Response",
    description: "Remediate 10 items within 24h of arrival", icon: "⏱️",
    category: "speed", xpReward: 150,
    check: (s) => s.fastRemediations24h >= 10,
  },
  {
    id: "mgr_fast_1h", role: "manager", tier: "rare", name: "Lightning Manager",
    description: "Remediate 5 items within 1 hour", icon: "⚡",
    category: "speed", xpReward: 300,
    check: (s) => s.fastRemediations1h >= 5,
  },
  {
    id: "mgr_clear_queue", role: "manager", tier: "rare", name: "Queue Slayer",
    description: "Clear entire queue to zero", icon: "🗡️",
    category: "special", xpReward: 250,
    check: (s) => s.queueCleared,
  },
  {
    id: "mgr_streak_5", role: "manager", tier: "uncommon", name: "Consistent Manager",
    description: "5 consecutive days with remediations", icon: "📅",
    category: "streak", xpReward: 75,
    check: (s) => s.dayStreak >= 5,
  },
  {
    id: "mgr_streak_20", role: "manager", tier: "rare", name: "Relentless",
    description: "20 consecutive days with remediations", icon: "🔥",
    category: "streak", xpReward: 300,
    check: (s) => s.dayStreak >= 20,
  },
  {
    id: "mgr_mentor", role: "manager", tier: "epic", name: "Team Builder",
    description: "All supervised agents above 80% pass rate", icon: "🌟",
    category: "special", xpReward: 500,
    check: (s) => s.allAgentsAbove80,
  },

  // === AGENT (7) ===
  {
    id: "agt_first_audit", role: "agent", tier: "common", name: "Rookie",
    description: "Complete your first audit", icon: "🎓",
    category: "milestone", xpReward: 25,
    check: (s) => s.totalAudits >= 1,
  },
  {
    id: "agt_fifty", role: "agent", tier: "uncommon", name: "Seasoned Agent",
    description: "Complete 50 audits", icon: "🏅",
    category: "milestone", xpReward: 100,
    check: (s) => s.totalAudits >= 50,
  },
  {
    id: "agt_hundred", role: "agent", tier: "rare", name: "Road Warrior",
    description: "Complete 100 audits", icon: "🛡️",
    category: "milestone", xpReward: 500,
    check: (s) => s.totalAudits >= 100,
  },
  {
    id: "agt_perfect_10", role: "agent", tier: "rare", name: "Perfect Ten",
    description: "Score 100% on 10 audits", icon: "💯",
    category: "quality", xpReward: 300,
    check: (s) => s.perfectScoreCount >= 10,
  },
  {
    id: "agt_honor_roll", role: "agent", tier: "uncommon", name: "Honor Roll",
    description: "90%+ avg score across 20+ audits", icon: "📜",
    category: "quality", xpReward: 200,
    check: (s) => s.auditsForAvg >= 20 && s.avgScore >= 90,
  },
  {
    id: "agt_comeback", role: "agent", tier: "uncommon", name: "Comeback Kid",
    description: "Weekly avg improves by 15+ points", icon: "📈",
    category: "special", xpReward: 150,
    check: (s) => s.weeklyImprovement >= 15,
  },
  {
    id: "agt_consistent", role: "agent", tier: "rare", name: "Consistent Performer",
    description: "5 consecutive weeks above 80%", icon: "📊",
    category: "quality", xpReward: 300,
    check: (s) => s.consecutiveWeeksAbove80 >= 5,
  },
];

// -- Store Catalog --

export const STORE_CATALOG: StoreItem[] = [
  // ── Titles ──────────────────────────────────────────
  { id: "title_rookie", name: "Rookie", price: 75, type: "title", icon: "\u{1F530}", rarity: "common",
    description: "Everyone starts somewhere. Wear it with pride -- this is day one of your story." },
  { id: "title_ace", name: "Ace Agent", price: 200, type: "title", icon: "\u{1F0CF}", rarity: "uncommon",
    description: "Marks you as a sharp operator. Displayed beside your name on leaderboards and dashboards." },
  { id: "title_shadow", name: "Shadow Ops", price: 350, type: "title", icon: "\u{1F575}", rarity: "uncommon",
    description: "Work in the shadows. A title for the quiet professionals who let results speak." },
  { id: "title_warden", name: "Warden", price: 350, type: "title", icon: "\u{1F6E1}", rarity: "uncommon",
    description: "The gatekeeper. You hold the line and keep standards high." },
  { id: "title_elite", name: "Elite Performer", price: 500, type: "title", icon: "\u{1F3C6}", rarity: "rare",
    description: "The gold standard. Shows everyone you put in the work to earn something special." },
  { id: "title_oracle", name: "Oracle", price: 600, type: "title", icon: "\u{1F52E}", rarity: "rare",
    description: "You see what others miss. A title for those with vision beyond the obvious." },
  { id: "title_phantom", name: "Phantom", price: 750, type: "title", icon: "\u{1F47B}", rarity: "epic",
    description: "Here one moment, gone the next -- but your impact lingers. Mysterious and elite." },
  { id: "title_apex", name: "Apex Predator", price: 900, type: "title", icon: "\u{1F985}", rarity: "epic",
    description: "Top of the food chain. No one above you, no one even close." },
  { id: "title_legend", name: "Legend", price: 1200, type: "title", icon: "\u{1F451}", rarity: "legendary",
    description: "Reserved for those who go above and beyond. The most prestigious title in the store." },
  { id: "title_immortal", name: "Immortal", price: 2000, type: "title", icon: "\u{1F31F}", rarity: "legendary",
    description: "Your name will be remembered. The rarest title available -- proof of absolute mastery." },

  // ── Avatar Frames ───────────────────────────────────
  { id: "frame_bronze", name: "Bronze Ring", price: 100, type: "avatar_frame", icon: "\u{1F7E4}", rarity: "common",
    description: "A clean bronze border around your avatar. Simple, understated, earned.", preview: "#cd7f32" },
  { id: "frame_silver", name: "Silver Circuit", price: 200, type: "avatar_frame", icon: "\u{26AA}", rarity: "uncommon",
    description: "Thin silver circuit lines trace your avatar edge. Tech-forward and precise.", preview: "#c0c0c0" },
  { id: "frame_emerald", name: "Emerald Edge", price: 300, type: "avatar_frame", icon: "\u{1F7E9}", rarity: "uncommon",
    description: "A rich emerald border that glows faintly green. Nature's power, contained.", preview: "#3fb950" },
  { id: "frame_neon", name: "Neon Pulse", price: 450, type: "avatar_frame", icon: "\u{1F4A0}", rarity: "rare",
    description: "An electric cyan glow that pulses around your avatar. Impossible to miss in any room.", preview: "#22d3ee" },
  { id: "frame_fire", name: "Inferno Frame", price: 600, type: "avatar_frame", icon: "\u{1F525}", rarity: "rare",
    description: "Living flames lick the edges of your avatar. For those who bring the heat.", preview: "#f97316" },
  { id: "frame_frost", name: "Frost Ring", price: 600, type: "avatar_frame", icon: "\u{2744}", rarity: "rare",
    description: "Ice crystals form and reform around your avatar in a perpetual freeze. Cool under pressure.", preview: "#7dd3fc" },
  { id: "frame_toxic", name: "Toxic Glow", price: 700, type: "avatar_frame", icon: "\u{2622}", rarity: "epic",
    description: "A radioactive green aura that warns everyone: handle with care. Dangerously good.", preview: "#84cc16" },
  { id: "frame_diamond", name: "Diamond Halo", price: 900, type: "avatar_frame", icon: "\u{1F48E}", rarity: "epic",
    description: "A crystalline frame that catches light from every angle. Pure class, pure commitment.", preview: "#c4b5fd" },
  { id: "frame_galaxy", name: "Galaxy Frame", price: 1200, type: "avatar_frame", icon: "\u{1F30C}", rarity: "legendary",
    description: "Stars and nebulae swirl around your avatar. The entire cosmos, framing you.", preview: "#818cf8" },
  { id: "frame_legendary", name: "Legendary Aura", price: 2000, type: "avatar_frame", icon: "\u{2728}", rarity: "legendary",
    description: "A radiant golden halo with particle effects. The ultimate expression of dedication. People will notice.", preview: "#fbbf24" },

  // ── Name Colors ─────────────────────────────────────
  { id: "color_emerald", name: "Emerald", price: 100, type: "name_color", icon: "\u{1F7E2}", rarity: "common",
    description: "Your name in deep emerald green across leaderboards and chat. Clean and distinctive.",
    preview: "#3fb950" },
  { id: "color_ruby", name: "Ruby", price: 100, type: "name_color", icon: "\u{1F534}", rarity: "common",
    description: "Bold crimson red that commands attention the moment it hits the screen.",
    preview: "#f85149" },
  { id: "color_sapphire", name: "Sapphire", price: 100, type: "name_color", icon: "\u{1F535}", rarity: "common",
    description: "Cool sapphire blue. Calm, collected, and unmistakable in every list.",
    preview: "#58a6ff" },
  { id: "color_gold", name: "Gold", price: 200, type: "name_color", icon: "\u{1F7E1}", rarity: "uncommon",
    description: "Rich, warm gold. Your name looks like it was minted. Wealth of experience on display.",
    preview: "#f59e0b" },
  { id: "color_violet", name: "Violet", price: 200, type: "name_color", icon: "\u{1F7E3}", rarity: "uncommon",
    description: "Deep, regal violet. Historically the color of royalty -- now the color of your name.",
    preview: "#a855f7" },
  { id: "color_toxic", name: "Toxic Green", price: 300, type: "name_color", icon: "\u{1F49A}", rarity: "uncommon",
    description: "Neon green that practically glows off the screen. Radioactive energy in text form.",
    preview: "#84cc16" },
  { id: "color_frost", name: "Frost Blue", price: 300, type: "name_color", icon: "\u{1F9CA}", rarity: "uncommon",
    description: "Icy light blue with a frozen edge. Your name runs cold and calculated.",
    preview: "#7dd3fc" },
  { id: "color_sunset", name: "Sunset Gradient", price: 450, type: "name_color", icon: "\u{1F305}", rarity: "rare",
    description: "Your name shifts from warm orange to deep pink. A gradient that turns heads in every leaderboard.",
    preview: "linear-gradient(90deg,#f97316,#ec4899)" },
  { id: "color_ocean", name: "Ocean Depths", price: 450, type: "name_color", icon: "\u{1F30A}", rarity: "rare",
    description: "Deep teal fading into midnight blue. Your name pulls people in like the tide.",
    preview: "linear-gradient(90deg,#14b8a6,#3b82f6)" },
  { id: "color_inferno", name: "Inferno", price: 550, type: "name_color", icon: "\u{1F525}", rarity: "rare",
    description: "Red to orange to yellow -- your name looks like it's literally on fire.",
    preview: "linear-gradient(90deg,#dc2626,#f97316,#eab308)" },
  { id: "color_aurora", name: "Aurora", price: 750, type: "name_color", icon: "\u{1F30C}", rarity: "epic",
    description: "Shimmering northern lights effect. Your name drifts through ethereal greens, blues, and purples.",
    preview: "linear-gradient(90deg,#3fb950,#58a6ff,#a855f7)" },
  { id: "color_vaporwave", name: "Vaporwave", price: 800, type: "name_color", icon: "\u{1F4FC}", rarity: "epic",
    description: "Hot pink to cyan -- pure retro-futurism. Your name is an aesthetic movement.",
    preview: "linear-gradient(90deg,#ec4899,#8b5cf6,#06b6d4)" },
  { id: "color_rainbow", name: "Rainbow", price: 1200, type: "name_color", icon: "\u{1F308}", rarity: "legendary",
    description: "The full spectrum, animated. Your name becomes a living rainbow that never stops moving.",
    preview: "linear-gradient(90deg,#f85149,#f97316,#eab308,#3fb950,#58a6ff,#a855f7)" },
  { id: "color_prismatic", name: "Prismatic", price: 1800, type: "name_color", icon: "\u{1FA9E}", rarity: "legendary",
    description: "Light refracts through your name like a prism. Shifting, shimmering, transcendent. The ultimate flex.",
    preview: "linear-gradient(90deg,#fff,#f0abfc,#c4b5fd,#93c5fd,#6ee7b7,#fde68a,#fca5a5)" },

  // ── Animations ──────────────────────────────────────
  { id: "anim_sparkle", name: "Sparkle Trail", price: 150, type: "animation", icon: "\u{2728}", rarity: "common",
    description: "Tiny sparkles float upward when you complete an action. Subtle magic for every win." },
  { id: "anim_confetti", name: "Confetti Burst", price: 250, type: "animation", icon: "\u{1F389}", rarity: "uncommon",
    description: "Colorful confetti explodes across the screen when you complete an action. Celebrate every single win." },
  { id: "anim_petals", name: "Cherry Blossom", price: 350, type: "animation", icon: "\u{1F338}", rarity: "uncommon",
    description: "Soft pink petals drift down across the screen. Beautiful, calming, and undeniably stylish." },
  { id: "anim_fireworks", name: "Fireworks Show", price: 500, type: "animation", icon: "\u{1F386}", rarity: "rare",
    description: "Rockets and sparklers light up when you hit combos. The bigger the combo, the bigger the show." },
  { id: "anim_matrix", name: "Matrix Rain", price: 500, type: "animation", icon: "\u{1F4DF}", rarity: "rare",
    description: "Green characters rain down the screen. You see the code now. There is no spoon." },
  { id: "anim_lightning", name: "Lightning Strike", price: 700, type: "animation", icon: "\u{26A1}", rarity: "epic",
    description: "A bolt of lightning cracks across the screen on streak milestones. Electrifying and unforgettable." },
  { id: "anim_snowfall", name: "Snowfall", price: 400, type: "animation", icon: "\u{2744}", rarity: "rare",
    description: "Gentle snowflakes drift across your screen. Peaceful, focused, and unmistakably cool." },
  { id: "anim_shockwave", name: "Shockwave", price: 1000, type: "animation", icon: "\u{1F4A5}", rarity: "legendary",
    description: "An expanding energy ring ripples outward from center screen. The signature move of top performers." },
  { id: "anim_nova", name: "Nova Explosion", price: 1500, type: "animation", icon: "\u{1F4AB}", rarity: "legendary",
    description: "A star goes supernova on your screen. Blinding light, expanding shockwave, cosmic debris. Absolutely unreal." },

  // ── Themes ──────────────────────────────────────────
  { id: "theme_slate", name: "Slate", price: 150, type: "theme", icon: "\u{1FAA8}", rarity: "common",
    description: "Clean gray tones with sharp contrast. Professional, neutral, and easy to read for hours." },
  { id: "theme_midnight", name: "Midnight", price: 300, type: "theme", icon: "\u{1F319}", rarity: "uncommon",
    description: "Deep navy backgrounds with silver accents. A sleek, professional look built for night owls." },
  { id: "theme_fire", name: "Forge", price: 300, type: "theme", icon: "\u{1F525}", rarity: "uncommon",
    description: "Warm reds and molten oranges. Turns your dashboard into something out of a blacksmith's workshop." },
  { id: "theme_forest", name: "Forest", price: 300, type: "theme", icon: "\u{1F332}", rarity: "uncommon",
    description: "Earthy greens and natural browns. Calm, focused, and easy on the eyes during long sessions." },
  { id: "theme_ocean", name: "Ocean Deep", price: 400, type: "theme", icon: "\u{1F30A}", rarity: "rare",
    description: "Deep blues and aqua accents. Like working from the bottom of the sea -- calm pressure, total focus." },
  { id: "theme_sakura", name: "Sakura", price: 450, type: "theme", icon: "\u{1F338}", rarity: "rare",
    description: "Soft pinks and warm whites. Japanese cherry blossom inspired. Elegant, peaceful, refined." },
  { id: "theme_cyberpunk", name: "Cyberpunk", price: 600, type: "theme", icon: "\u{1F916}", rarity: "rare",
    description: "Neon pink meets electric blue. Your dashboard, straight out of a sci-fi future. Loud and proud." },
  { id: "theme_arctic", name: "Arctic", price: 600, type: "theme", icon: "\u{1F9CA}", rarity: "rare",
    description: "Icy whites and pale blues on a near-black base. Freezing cold, razor sharp, crystal clear." },
  { id: "theme_void", name: "Void", price: 900, type: "theme", icon: "\u{1F573}", rarity: "epic",
    description: "Pure black with subtle purple accents. Minimalist. Menacing. The absence of everything except focus." },
  { id: "theme_neon_nights", name: "Neon Nights", price: 1000, type: "theme", icon: "\u{1F3D9}", rarity: "legendary",
    description: "Hot pinks, electric blues, and neon greens on a dark canvas. Your dashboard becomes downtown Tokyo at 2am." },

  // ── Flair ───────────────────────────────────────────
  { id: "flair_star", name: "Star", price: 100, type: "flair", icon: "\u{2B50}", rarity: "common",
    description: "A golden star next to your name. The classic that never goes out of style." },
  { id: "flair_check", name: "Verified", price: 150, type: "flair", icon: "\u{2705}", rarity: "common",
    description: "A green checkmark beside your name. Verified performer. Trusted contributor." },
  { id: "flair_bolt", name: "Lightning Bolt", price: 250, type: "flair", icon: "\u{26A1}", rarity: "uncommon",
    description: "A crackling bolt of electricity beside your name. Speed and power, embodied." },
  { id: "flair_flame", name: "Flame", price: 300, type: "flair", icon: "\u{1F525}", rarity: "uncommon",
    description: "A flickering fire icon. You're on a hot streak and everyone can see it." },
  { id: "flair_rocket", name: "Rocket", price: 350, type: "flair", icon: "\u{1F680}", rarity: "uncommon",
    description: "A rocket ship blasting off. You're going places and nothing is slowing you down." },
  { id: "flair_shield", name: "Shield", price: 400, type: "flair", icon: "\u{1F6E1}", rarity: "rare",
    description: "A defensive shield. You protect quality. You hold the line. You don't let bad work through." },
  { id: "flair_rose", name: "Rose", price: 400, type: "flair", icon: "\u{1F339}", rarity: "rare",
    description: "A red rose. Beautiful but thorny. Elegant with an edge." },
  { id: "flair_diamond", name: "Diamond", price: 600, type: "flair", icon: "\u{1F48E}", rarity: "rare",
    description: "A sparkling diamond icon that says one thing: you invest in yourself." },
  { id: "flair_skull", name: "Skull", price: 700, type: "flair", icon: "\u{1F480}", rarity: "epic",
    description: "A skull. You've been through hell and came back stronger. Danger and experience in one icon." },
  { id: "flair_crown", name: "Crown", price: 900, type: "flair", icon: "\u{1F451}", rarity: "epic",
    description: "The crown. Sit at the top of the leaderboard. Let everyone know who runs the show." },
  { id: "flair_trident", name: "Trident", price: 1200, type: "flair", icon: "\u{1F531}", rarity: "legendary",
    description: "The trident of Poseidon. Command the seas, command the leaderboard. Supreme authority." },

  // ── Fonts ───────────────────────────────────────────
  { id: "font_mono", name: "Monospace", price: 100, type: "font", icon: "\u{1F4BB}", rarity: "common",
    description: "Clean monospace type for your display name. For engineers who want their name to look like code.",
    preview: "'Courier New', monospace" },
  { id: "font_serif", name: "Elegant Serif", price: 200, type: "font", icon: "\u{1F4DC}", rarity: "uncommon",
    description: "Classic serif typeface. Timeless, refined, authoritative. Your name reads like a published headline.",
    preview: "Georgia, 'Times New Roman', serif" },
  { id: "font_handwritten", name: "Handwritten", price: 300, type: "font", icon: "\u{270D}", rarity: "uncommon",
    description: "Relaxed handwritten style. Personal, approachable, and uniquely yours in every list.",
    preview: "'Comic Sans MS', cursive" },
  { id: "font_bold", name: "Bold Impact", price: 350, type: "font", icon: "\u{1F4AA}", rarity: "uncommon",
    description: "Heavy, impactful type that demands attention. Your name hits like a headline.",
    preview: "Impact, 'Arial Black', sans-serif" },
  { id: "font_pixel", name: "Pixel", price: 400, type: "font", icon: "\u{1F47E}", rarity: "rare",
    description: "Retro pixel art font. 8-bit nostalgia for your display name. Old school cool.",
    preview: "'Courier New', monospace" },
  { id: "font_gothic", name: "Gothic", price: 500, type: "font", icon: "\u{1F3F0}", rarity: "rare",
    description: "Bold blackletter type. Medieval weight meets modern grit. Your name carries serious gravity.",
    preview: "'Old English Text MT', serif" },
  { id: "font_neon_script", name: "Neon Script", price: 800, type: "font", icon: "\u{1F4A1}", rarity: "epic",
    description: "Glowing cursive that looks like a neon sign. Your name, up in lights, impossible to scroll past.",
    preview: "'Brush Script MT', cursive" },
  { id: "font_chrome", name: "Chrome", price: 1500, type: "font", icon: "\u{1FA9E}", rarity: "legendary",
    description: "Reflective metallic typeface that catches every pixel of light. Your name looks forged from liquid metal.",
    preview: "'Trebuchet MS', sans-serif" },

  // ── Bubble Fonts (avatar letter typeface) ─────────
  { id: "bfont_mono", name: "Mono", price: 100, type: "bubble_font", icon: "\u{1F4BB}", rarity: "common",
    description: "Clean monospace letter in your avatar bubble. Technical and precise.",
    preview: "'Courier New', monospace" },
  { id: "bfont_serif", name: "Serif", price: 200, type: "bubble_font", icon: "\u{1F4DC}", rarity: "uncommon",
    description: "Classic serif letter in your avatar. Timeless and elegant.",
    preview: "Georgia, 'Times New Roman', serif" },
  { id: "bfont_script", name: "Script", price: 300, type: "bubble_font", icon: "\u{270D}", rarity: "uncommon",
    description: "Flowing cursive letter in your bubble. Personal and stylish.",
    preview: "'Brush Script MT', cursive" },
  { id: "bfont_impact", name: "Impact", price: 400, type: "bubble_font", icon: "\u{1F4AA}", rarity: "rare",
    description: "Bold, heavy letter that fills your avatar bubble with authority.",
    preview: "Impact, 'Arial Black', sans-serif" },
  { id: "bfont_gothic", name: "Gothic", price: 600, type: "bubble_font", icon: "\u{1F3F0}", rarity: "rare",
    description: "Medieval blackletter in your avatar. Imposing and dramatic.",
    preview: "'Old English Text MT', serif" },
  { id: "bfont_neon", name: "Neon", price: 900, type: "bubble_font", icon: "\u{1F4A1}", rarity: "epic",
    description: "Glowing neon-style letter in your bubble. Lights up every conversation.",
    preview: "'Trebuchet MS', sans-serif" },

  // ── Bubble Colors (avatar letter color) ───────────
  { id: "bcolor_emerald", name: "Emerald", price: 100, type: "bubble_color", icon: "\u{1F7E2}", rarity: "common",
    description: "Deep emerald green letter in your avatar bubble.", preview: "#3fb950" },
  { id: "bcolor_ruby", name: "Ruby", price: 100, type: "bubble_color", icon: "\u{1F534}", rarity: "common",
    description: "Bold crimson letter in your avatar bubble.", preview: "#f85149" },
  { id: "bcolor_gold", name: "Gold", price: 250, type: "bubble_color", icon: "\u{1F7E1}", rarity: "uncommon",
    description: "Rich gold letter that makes your avatar shine.", preview: "#f59e0b" },
  { id: "bcolor_cyan", name: "Cyan", price: 250, type: "bubble_color", icon: "\u{1F535}", rarity: "uncommon",
    description: "Electric cyan letter in your bubble. Bright and modern.", preview: "#22d3ee" },
  { id: "bcolor_violet", name: "Violet", price: 350, type: "bubble_color", icon: "\u{1F7E3}", rarity: "uncommon",
    description: "Regal violet letter in your avatar. Royal presence.", preview: "#a855f7" },
  { id: "bcolor_sunset", name: "Sunset Gradient", price: 500, type: "bubble_color", icon: "\u{1F305}", rarity: "rare",
    description: "Your avatar letter shifts from warm orange to pink.",
    preview: "linear-gradient(135deg,#f97316,#ec4899)" },
  { id: "bcolor_rainbow", name: "Rainbow", price: 800, type: "bubble_color", icon: "\u{1F308}", rarity: "epic",
    description: "Full spectrum animated letter in your avatar bubble.",
    preview: "linear-gradient(90deg,#f85149,#f97316,#eab308,#3fb950,#58a6ff,#a855f7)" },
  { id: "bcolor_prismatic", name: "Prismatic", price: 1500, type: "bubble_color", icon: "\u{1FA9E}", rarity: "legendary",
    description: "Light refracts through your avatar letter like a prism. The ultimate bubble flex.",
    preview: "linear-gradient(90deg,#fff,#f0abfc,#c4b5fd,#93c5fd,#6ee7b7,#fde68a,#fca5a5)" },

  // ── Additional Avatar Frames ──────────────────────
  { id: "frame_plasma", name: "Plasma Ring", price: 500, type: "avatar_frame", icon: "\u{1F7E3}", rarity: "rare",
    description: "Swirling plasma energy orbits your avatar. Unstable, powerful, mesmerizing.", preview: "#a855f7" },
  { id: "frame_aurora", name: "Aurora Frame", price: 550, type: "avatar_frame", icon: "\u{1F30C}", rarity: "rare",
    description: "Northern lights shimmer around your avatar in ethereal greens and blues.", preview: "#3fb950" },
  { id: "frame_obsidian", name: "Obsidian Edge", price: 650, type: "avatar_frame", icon: "\u{1F311}", rarity: "rare",
    description: "Dark volcanic glass border with sharp, angular highlights.", preview: "#1e1e2e" },
  { id: "frame_crimson", name: "Crimson Blaze", price: 700, type: "avatar_frame", icon: "\u{1F534}", rarity: "epic",
    description: "Deep red flames lick the edges of your avatar. Intense and commanding.", preview: "#dc2626" },
  { id: "frame_hologram", name: "Hologram", price: 800, type: "avatar_frame", icon: "\u{1F4A0}", rarity: "epic",
    description: "Translucent holographic ring shifts colors as it spins. Futuristic perfection.", preview: "#06b6d4" },
  { id: "frame_sakura", name: "Sakura Ring", price: 850, type: "avatar_frame", icon: "\u{1F338}", rarity: "epic",
    description: "Soft pink cherry blossom petals orbit your avatar. Beautiful and serene.", preview: "#f9a8d4" },
  { id: "frame_storm", name: "Storm Vortex", price: 1000, type: "avatar_frame", icon: "\u{26A1}", rarity: "legendary",
    description: "Lightning crackles around a swirling storm vortex frame. Raw power unleashed.", preview: "#3b82f6" },
  { id: "frame_void", name: "Void Portal", price: 1500, type: "avatar_frame", icon: "\u{1F573}", rarity: "legendary",
    description: "A dark matter rift surrounds your avatar. The abyss gazes back at everyone else.", preview: "#6d28d9" },
];

// -- Prefab Event Definitions --

export interface PrefabEventDef {
  type: string;
  label: string;
  description: string;
  icon: string;
  defaultMessage: (name: string) => string;
}

export const PREFAB_EVENTS: PrefabEventDef[] = [
  { type: "sale_completed", label: "Sale Completed", icon: "\u{1F4B0}",
    description: "Fires when an agent completes an audit",
    defaultMessage: (n) => `${n} completed a sale!` },
  { type: "perfect_score", label: "Perfect Score", icon: "\u{1F4AF}",
    description: "Fires when an agent scores 100% on an audit",
    defaultMessage: (n) => `${n} got a perfect score!` },
  { type: "ten_audits_day", label: "10 Audits in a Day", icon: "\u{1F525}",
    description: "Fires when an agent completes 10 audits in a single day",
    defaultMessage: (n) => `${n} hit 10 audits today!` },
  { type: "level_up", label: "Level Up", icon: "\u{2B06}",
    description: "Fires when any user levels up",
    defaultMessage: (n) => `${n} leveled up!` },
  { type: "badge_earned", label: "Badge Earned", icon: "\u{1F3C5}",
    description: "Fires when any user earns a new badge",
    defaultMessage: (n) => `${n} earned a new badge!` },
  { type: "streak_milestone", label: "Streak Milestone", icon: "\u{1F525}",
    description: "Fires when a user hits a 7, 14, or 30 day streak",
    defaultMessage: (n) => `${n} hit a streak milestone!` },
  { type: "queue_cleared", label: "Queue Cleared", icon: "\u{1F5E1}",
    description: "Fires when the manager queue reaches zero",
    defaultMessage: (n) => `${n} cleared the queue!` },
  { type: "weekly_accuracy_100", label: "Weekly 100% Accuracy", icon: "\u{1F3AF}",
    description: "Fires when an agent has 100% accuracy for the week",
    defaultMessage: (n) => `${n} achieved 100% weekly accuracy!` },
];

/** Serialized prefab events for embedding in client pages. */
export function getPrefabEventsJson(): string {
  return JSON.stringify(
    PREFAB_EVENTS.map(({ defaultMessage: _, ...rest }) => rest),
  );
}

// -- Badge Checker --

/** Pure function: returns badges newly earned by role + stats, excluding already-earned. */
export function checkBadges(
  role: BadgeRole,
  stats: BadgeCheckState,
  alreadyEarned: Set<string>,
): BadgeDef[] {
  return BADGE_CATALOG
    .filter((b) => b.role === role)
    .filter((b) => !alreadyEarned.has(b.id))
    .filter((b) => b.check(stats));
}

/** Service class wrapping badge logic. */
export class BadgeService {
  checkBadges(
    role: BadgeRole,
    stats: BadgeCheckState,
    alreadyEarned: Set<string>,
  ): BadgeDef[] {
    return checkBadges(role, stats, alreadyEarned);
  }

  static rarityFromPrice(price: number): StoreRarity {
    return rarityFromPrice(price);
  }
}

/** Serialized catalog for embedding in client pages. */
export function getBadgeCatalogJson(): string {
  return JSON.stringify(
    BADGE_CATALOG.map(({ check: _, ...rest }) => rest),
  );
}

/** Serialized store catalog for embedding in client pages. */
export function getStoreCatalogJson(): string {
  return JSON.stringify(STORE_CATALOG);
}
