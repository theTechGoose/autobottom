/** HTTP handlers for chat API routes. */

import { requireAuth, json } from "./helpers.ts";
import { Kv } from "../domain/data/kv/mod.ts";
import { listUsers } from "../domain/coordinators/auth/mod.ts";

import { PREFAB_EVENTS } from "../domain/business/gamification-badges/mod.ts";

export async function handleChatMe(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  return json({ username: auth.email, role: auth.role });
}

export async function handleChatCosmetics(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const FRAME_RANK: Record<string, number> = {
    frame_bronze: 1, frame_silver: 2, frame_emerald: 3, frame_neon: 4,
    frame_fire: 5, frame_frost: 6, frame_toxic: 7, frame_diamond: 8,
    frame_galaxy: 9, frame_legendary: 10,
    frame_plasma: 11, frame_aurora: 12, frame_obsidian: 13, frame_crimson: 14,
    frame_hologram: 15, frame_sakura: 16, frame_storm: 17, frame_void: 18,
  };
  const FLAIR_INFO: Record<string, { rank: number; icon: string }> = {
    flair_star: { rank: 1, icon: "\u2B50" },
    flair_check: { rank: 2, icon: "\u2705" },
    flair_bolt: { rank: 3, icon: "\u26A1" },
    flair_flame: { rank: 4, icon: "\uD83D\uDD25" },
    flair_rocket: { rank: 5, icon: "\uD83D\uDE80" },
    flair_shield: { rank: 6, icon: "\uD83D\uDEE1\uFE0F" },
    flair_rose: { rank: 7, icon: "\uD83C\uDF39" },
    flair_diamond: { rank: 8, icon: "\uD83D\uDC8E" },
    flair_skull: { rank: 9, icon: "\uD83D\uDC80" },
    flair_crown: { rank: 10, icon: "\uD83D\uDC51" },
    flair_trident: { rank: 11, icon: "\uD83D\uDD31" },
  };
  const COLOR_INFO: Record<string, { rank: number; preview: string }> = {
    color_emerald: { rank: 1, preview: "#3fb950" },
    color_ruby: { rank: 2, preview: "#f85149" },
    color_sapphire: { rank: 3, preview: "#58a6ff" },
    color_gold: { rank: 4, preview: "#f59e0b" },
    color_violet: { rank: 5, preview: "#a855f7" },
    color_toxic: { rank: 6, preview: "#84cc16" },
    color_frost: { rank: 7, preview: "#7dd3fc" },
    color_sunset: { rank: 8, preview: "linear-gradient(90deg,#f97316,#ec4899)" },
    color_ocean: { rank: 9, preview: "linear-gradient(90deg,#14b8a6,#3b82f6)" },
    color_inferno: { rank: 10, preview: "linear-gradient(90deg,#dc2626,#f97316,#eab308)" },
    color_aurora: { rank: 11, preview: "linear-gradient(90deg,#3fb950,#58a6ff,#a855f7)" },
    color_vaporwave: { rank: 12, preview: "linear-gradient(90deg,#ec4899,#8b5cf6,#06b6d4)" },
    color_rainbow: { rank: 13, preview: "linear-gradient(90deg,#f85149,#f97316,#eab308,#3fb950,#58a6ff,#a855f7)" },
    color_prismatic: { rank: 14, preview: "linear-gradient(90deg,#fff,#f0abfc,#c4b5fd,#93c5fd,#6ee7b7,#fde68a,#fca5a5)" },
  };
  const FONT_INFO: Record<string, { rank: number; css: string }> = {
    font_mono: { rank: 1, css: "'Courier New', monospace" },
    font_serif: { rank: 2, css: "Georgia, 'Times New Roman', serif" },
    font_handwritten: { rank: 3, css: "'Comic Sans MS', cursive" },
    font_bold: { rank: 4, css: "Impact, 'Arial Black', sans-serif" },
    font_pixel: { rank: 5, css: "'Courier New', monospace" },
    font_gothic: { rank: 6, css: "'Old English Text MT', serif" },
    font_neon_script: { rank: 7, css: "'Brush Script MT', cursive" },
    font_chrome: { rank: 8, css: "'Trebuchet MS', sans-serif" },
  };
  const BUBBLE_FONT_INFO: Record<string, { rank: number; css: string }> = {
    bfont_mono: { rank: 1, css: "'Courier New', monospace" },
    bfont_serif: { rank: 2, css: "Georgia, 'Times New Roman', serif" },
    bfont_script: { rank: 3, css: "'Brush Script MT', cursive" },
    bfont_impact: { rank: 4, css: "Impact, 'Arial Black', sans-serif" },
    bfont_gothic: { rank: 5, css: "'Old English Text MT', serif" },
    bfont_neon: { rank: 6, css: "'Trebuchet MS', sans-serif" },
  };
  const BUBBLE_COLOR_INFO: Record<string, { rank: number; preview: string }> = {
    bcolor_emerald: { rank: 1, preview: "#3fb950" },
    bcolor_ruby: { rank: 2, preview: "#f85149" },
    bcolor_gold: { rank: 3, preview: "#f59e0b" },
    bcolor_cyan: { rank: 4, preview: "#22d3ee" },
    bcolor_violet: { rank: 5, preview: "#a855f7" },
    bcolor_sunset: { rank: 6, preview: "linear-gradient(135deg,#f97316,#ec4899)" },
    bcolor_rainbow: { rank: 7, preview: "linear-gradient(90deg,#f85149,#f97316,#eab308,#3fb950,#58a6ff,#a855f7)" },
    bcolor_prismatic: { rank: 8, preview: "linear-gradient(90deg,#fff,#f0abfc,#c4b5fd,#93c5fd,#6ee7b7,#fde68a,#fca5a5)" },
  };
  const TITLE_RANK: Record<string, { rank: number; label: string }> = {
    title_rookie: { rank: 1, label: "Rookie" },
    title_ace: { rank: 2, label: "Ace Agent" },
    title_shadow: { rank: 3, label: "Shadow Ops" },
    title_warden: { rank: 4, label: "Warden" },
    title_elite: { rank: 5, label: "Elite Performer" },
    title_oracle: { rank: 6, label: "Oracle" },
    title_phantom: { rank: 7, label: "Phantom" },
    title_apex: { rank: 8, label: "Apex Predator" },
    title_legend: { rank: 9, label: "Legend" },
    title_immortal: { rank: 10, label: "Immortal" },
  };
  const EPIC_FLAIRS = new Set(["flair_skull", "flair_crown", "flair_trident"]);

  const users = await listUsers(auth.orgId);
  const customItems = await (await Kv.getInstance()).listCustomStoreItems(auth.orgId);
  const customItemMap = new Map(customItems.map((i) => [i.id, i]));
  const cosmetics: Record<string, {
    frame: string | null; frameColor: string | null;
    flair: string | null; flairIcon: string | null;
    nameColor: string | null; nameColorCSS: string | null;
    font: string | null; fontCSS: string | null; avatarIcon: string | null;
    bubbleFont: string | null; bubbleFontCSS: string | null;
    bubbleColor: string | null; bubbleColorCSS: string | null;
    title: string | null; titleLabel: string | null;
    theme: string | null;
  }> = {};

  await Promise.all(users.map(async (u) => {
    const gs = await (await Kv.getInstance()).getGameState(auth.orgId, u.email);
    let bestFrame: string | null = null, bestFrameRank = 0;
    let bestFlair: string | null = null, bestFlairIcon: string | null = null, bestFlairRank = 0;
    let bestColor: string | null = null, bestColorCSS: string | null = null, bestColorRank = 0;
    let bestFont: string | null = null, bestFontCSS: string | null = null, bestFontRank = 0;
    let bestBubbleFont: string | null = null, bestBubbleFontCSS: string | null = null, bestBubbleFontRank = 0;
    let bestBubbleColor: string | null = null, bestBubbleColorCSS: string | null = null, bestBubbleColorRank = 0;
    let bestTitle: string | null = null, bestTitleLabel: string | null = null, bestTitleRank = 0;

    for (const p of gs.purchases) {
      if (FRAME_RANK[p] && FRAME_RANK[p] > bestFrameRank) { bestFrame = p; bestFrameRank = FRAME_RANK[p]; }
      // Custom frames: rank by price (offset by 100 to sort after built-ins)
      if (!FRAME_RANK[p] && customItemMap.has(p) && customItemMap.get(p)!.type === "avatar_frame") {
        const cRank = 100 + customItemMap.get(p)!.price;
        if (cRank > bestFrameRank) { bestFrame = p; bestFrameRank = cRank; }
      }
      if (FLAIR_INFO[p] && FLAIR_INFO[p].rank > bestFlairRank) { bestFlair = p; bestFlairIcon = FLAIR_INFO[p].icon; bestFlairRank = FLAIR_INFO[p].rank; }
      if (COLOR_INFO[p] && COLOR_INFO[p].rank > bestColorRank) { bestColor = p; bestColorCSS = COLOR_INFO[p].preview; bestColorRank = COLOR_INFO[p].rank; }
      if (FONT_INFO[p] && FONT_INFO[p].rank > bestFontRank) { bestFont = p; bestFontCSS = FONT_INFO[p].css; bestFontRank = FONT_INFO[p].rank; }
      if (BUBBLE_FONT_INFO[p] && BUBBLE_FONT_INFO[p].rank > bestBubbleFontRank) { bestBubbleFont = p; bestBubbleFontCSS = BUBBLE_FONT_INFO[p].css; bestBubbleFontRank = BUBBLE_FONT_INFO[p].rank; }
      if (BUBBLE_COLOR_INFO[p] && BUBBLE_COLOR_INFO[p].rank > bestBubbleColorRank) { bestBubbleColor = p; bestBubbleColorCSS = BUBBLE_COLOR_INFO[p].preview; bestBubbleColorRank = BUBBLE_COLOR_INFO[p].rank; }
      if (TITLE_RANK[p] && TITLE_RANK[p].rank > bestTitleRank) { bestTitle = p; bestTitleLabel = TITLE_RANK[p].label; bestTitleRank = TITLE_RANK[p].rank; }
    }

    // Equipped title overrides highest-rank purchased title
    if (gs.equippedTitle && TITLE_RANK[gs.equippedTitle] && gs.purchases.includes(gs.equippedTitle)) {
      bestTitle = gs.equippedTitle;
      bestTitleLabel = TITLE_RANK[gs.equippedTitle].label;
    }

    const avatarIcon = (bestFlair && EPIC_FLAIRS.has(bestFlair)) ? bestFlairIcon : null;
    const theme = (gs.equippedTheme && gs.purchases.includes(gs.equippedTheme)) ? gs.equippedTheme : null;

    // Custom frame: if best frame isn't in hardcoded FRAME_RANK, return its preview as frameColor
    let frameColor: string | null = null;
    if (bestFrame && !FRAME_RANK[bestFrame]) {
      const customFrame = customItemMap.get(bestFrame);
      if (customFrame?.preview) frameColor = customFrame.preview;
    }

    cosmetics[u.email] = {
      frame: bestFrame, frameColor,
      flair: bestFlair, flairIcon: bestFlairIcon,
      nameColor: bestColor, nameColorCSS: bestColorCSS,
      font: bestFont, fontCSS: bestFontCSS, avatarIcon,
      bubbleFont: bestBubbleFont, bubbleFontCSS: bestBubbleFontCSS,
      bubbleColor: bestBubbleColor, bubbleColorCSS: bestBubbleColorCSS,
      title: bestTitle, titleLabel: bestTitleLabel,
      theme,
    };
  }));

  return json(cosmetics);
}

// -- Equip API --

export async function handleEquip(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { category, itemId, eventType, animationId } = body;
  const gs = await (await Kv.getInstance()).getGameState(auth.orgId, auth.email);

  if (category === "title") {
    if (!itemId) return json({ error: "itemId required" }, 400);
    if (itemId !== "none" && !gs.purchases.includes(itemId)) return json({ error: "not owned" }, 403);
    gs.equippedTitle = itemId === "none" ? null : itemId;
  } else if (category === "theme") {
    if (!itemId) return json({ error: "itemId required" }, 400);
    if (itemId !== "none" && !gs.purchases.includes(itemId)) return json({ error: "not owned" }, 403);
    gs.equippedTheme = itemId === "none" ? null : itemId;
  } else if (category === "animation") {
    if (!eventType) return json({ error: "eventType required" }, 400);
    if (!PREFAB_EVENTS.some((e) => e.type === eventType)) return json({ error: "invalid event type" }, 400);
    if (animationId && animationId !== "none" && !gs.purchases.includes(animationId)) return json({ error: "not owned" }, 403);
    if (!gs.animBindings) gs.animBindings = {};
    if (!animationId || animationId === "none") {
      delete gs.animBindings[eventType];
    } else {
      gs.animBindings[eventType] = animationId;
    }
  } else {
    return json({ error: "invalid category" }, 400);
  }

  await (await Kv.getInstance()).saveGameState(auth.orgId, auth.email, gs);
  return json({ ok: true });
}

