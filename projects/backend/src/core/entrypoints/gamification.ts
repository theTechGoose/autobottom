/** HTTP handlers for gamification routes (badges, sound packs, gamification settings). */

import { requireAuth, json } from "./helpers.ts";
import { getUser } from "../domain/coordinators/auth/mod.ts";
import { Kv } from "../domain/data/kv/mod.ts";
import type { GamificationSettings, SoundPackMeta, SoundSlot } from "../domain/data/kv/mod.ts";
import { S3Ref } from "../domain/data/s3/mod.ts";

// -- Judge Gamification --

export async function handleJudgeGetGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const override = await (await Kv.getInstance()).getJudgeGamificationOverride(auth.orgId, auth.email);
  const resolved = await (await Kv.getInstance()).resolveGamificationSettings(auth.orgId, auth.email, auth.role);
  const orgSettings = await (await Kv.getInstance()).getGamificationSettings(auth.orgId);
  return json({ override: override ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null }, resolved, orgDefaults: orgSettings });
}

export async function handleJudgeSaveGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "judge" && auth.role !== "admin") return json({ error: "forbidden" }, 403);
  const body = await req.json() as GamificationSettings;
  await (await Kv.getInstance()).saveJudgeGamificationOverride(auth.orgId, auth.email, body);
  return json({ ok: true });
}

// -- Reviewer Gamification --

export async function handleReviewerGetGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const user = await getUser(auth.orgId, auth.email);
  const resolved = await (await Kv.getInstance()).resolveGamificationSettings(auth.orgId, auth.email, auth.role, user?.supervisor);
  const personal = await (await Kv.getInstance()).getReviewerGamificationOverride(auth.orgId, auth.email);
  return json({ resolved, personal: personal ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null } });
}

export async function handleReviewerSaveGamification(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const body = await req.json() as GamificationSettings;
  await (await Kv.getInstance()).saveReviewerGamificationOverride(auth.orgId, auth.email, body);
  return json({ ok: true });
}

// -- Badges API --

export async function handleBadgesApi(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const badges = await getEarnedBadges(auth.orgId, auth.email);
  return json({ earned: badges.map((b) => b.badgeId) });
}

// -- Sound Pack Handlers --

export async function handleListPacks(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const packs = await (await Kv.getInstance()).listSoundPacks(auth.orgId);
  return json(packs);
}

export async function handleSavePack(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const body = await req.json();
  const { id, name } = body;
  if (!name) return json({ error: "name required" }, 400);
  const packId = id || crypto.randomUUID().slice(0, 8);
  const existing = await (await Kv.getInstance()).getSoundPack(auth.orgId, packId);
  const pack: SoundPackMeta = {
    id: packId,
    name,
    slots: existing?.slots ?? {},
    createdAt: existing?.createdAt ?? Date.now(),
    createdBy: existing?.createdBy ?? auth.email,
  };
  await (await Kv.getInstance()).saveSoundPack(auth.orgId, pack);
  return json(pack);
}

export async function handleDeletePack(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const body = await req.json();
  const { id } = body;
  if (!id) return json({ error: "id required" }, 400);
  // Delete S3 files for all slots
  const pack = await (await Kv.getInstance()).getSoundPack(auth.orgId, id);
  if (pack) {
    const SLOTS: SoundSlot[] = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];
    for (const slot of SLOTS) {
      if (pack.slots[slot]) {
        try {
          const ref = new S3Ref(Deno.env.get("S3_BUCKET")!, `sounds/${auth.orgId}/${id}/${slot}.mp3`);
          await ref.save(new Uint8Array(0)); // S3 doesn't have delete in our client, overwrite with empty
        } catch { /* best effort */ }
      }
    }
  }
  await (await Kv.getInstance()).deleteSoundPack(auth.orgId, id);
  return json({ ok: true });
}

export async function handleUploadSound(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);

  const formData = await req.formData();
  const packId = formData.get("packId") as string;
  const slot = formData.get("slot") as string;
  const file = formData.get("file") as File;

  if (!packId || !slot || !file) return json({ error: "packId, slot, and file required" }, 400);
  const validSlots: SoundSlot[] = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];
  if (!validSlots.includes(slot as SoundSlot)) return json({ error: "invalid slot" }, 400);
  if (file.size > 2 * 1024 * 1024) return json({ error: "file too large (max 2MB)" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const s3Key = `sounds/${auth.orgId}/${packId}/${slot}.mp3`;
  const ref = new S3Ref(Deno.env.get("S3_BUCKET")!, s3Key);
  await ref.save(bytes);

  // Update pack metadata
  const pack = await (await Kv.getInstance()).getSoundPack(auth.orgId, packId);
  if (pack) {
    pack.slots[slot as SoundSlot] = file.name;
    await (await Kv.getInstance()).saveSoundPack(auth.orgId, pack);
  }

  return json({ ok: true, slot, filename: file.name });
}

export const BUILTIN_PACKS: Record<string, Record<SoundSlot, string>> = {
  smite: { ping: "smite-mario-coin.mp3", double: "smite-double-kill.mp3", triple: "smite-triple-kill.mp3", mega: "smite-quadra-kill.mp3", ultra: "smite-penta-kill.mp3", rampage: "smite-rampage.mp3", godlike: "smite-godlike.mp3", levelup: "smite-unstoppable.mp3" },
  opengameart: { ping: "oga-Coin01.mp3", double: "oga-Rise01.mp3", triple: "oga-Rise02.mp3", mega: "oga-Rise03.mp3", ultra: "oga-Rise04.mp3", rampage: "oga-Rise05.mp3", godlike: "oga-Rise07.mp3", levelup: "oga-Upper01.mp3" },
  "mixkit-punchy": { ping: "mixkit-winning-coin.mp3", double: "mixkit-alert-ding.mp3", triple: "mixkit-achievement-bell.mp3", mega: "mixkit-bonus-reached.mp3", ultra: "mixkit-game-bonus.mp3", rampage: "mixkit-success-alert.mp3", godlike: "mixkit-arcade-retro.mp3", levelup: "mixkit-fairy-sparkle.mp3" },
  "mixkit-epic": { ping: "mixkit-notification.mp3", double: "mixkit-game-notification.mp3", triple: "mixkit-magic-notify.mp3", mega: "mixkit-achievement-bell.mp3", ultra: "mixkit-bonus-reached.mp3", rampage: "mixkit-arcade-retro.mp3", godlike: "mixkit-success-alert.mp3", levelup: "mixkit-fairy-sparkle.mp3" },
};

export const BUILTIN_PACK_NAMES: Record<string, string> = {
  smite: "SMITE Announcer",
  opengameart: "OpenGameArt CC0",
  "mixkit-punchy": "Mixkit Punchy",
  "mixkit-epic": "Mixkit Epic",
};

export async function handleSeedSoundPacks(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin") return json({ error: "admin only" }, 403);

  let uploaded = 0;
  const errors: string[] = [];

  for (const [packId, slots] of Object.entries(BUILTIN_PACKS)) {
    // Create pack metadata
    const pack: SoundPackMeta = {
      id: packId,
      name: BUILTIN_PACK_NAMES[packId] || packId,
      slots: {},
      createdAt: Date.now(),
      createdBy: auth.email,
    };

    for (const [slot, filename] of Object.entries(slots)) {
      try {
        const filePath = new URL("../../assets/sounds/" + filename, import.meta.url);
        const bytes = await Deno.readFile(filePath);
        const s3Key = `sounds/${auth.orgId}/${packId}/${slot}.mp3`;
        const ref = new S3Ref(Deno.env.get("S3_BUCKET")!, s3Key);
        await ref.save(bytes);
        pack.slots[slot as SoundSlot] = filename;
        uploaded++;
      } catch (e) {
        errors.push(`${packId}/${slot}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await (await Kv.getInstance()).saveSoundPack(auth.orgId, pack);
  }

  return json({ ok: true, uploaded, packs: Object.keys(BUILTIN_PACKS).length, errors: errors.length > 0 ? errors : undefined });
}

// -- Gamification Page Settings --

export async function handleGamificationPageGetSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);

  if (auth.role === "admin") {
    const settings = await (await Kv.getInstance()).getGamificationSettings(auth.orgId);
    return json({ settings: settings ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null }, role: "admin", orgId: auth.orgId });
  }
  // Judge
  const override = await (await Kv.getInstance()).getJudgeGamificationOverride(auth.orgId, auth.email);
  const orgSettings = await (await Kv.getInstance()).getGamificationSettings(auth.orgId);
  return json({ settings: override ?? { threshold: null, comboTimeoutMs: null, enabled: null, sounds: null }, orgDefaults: orgSettings, role: "judge", orgId: auth.orgId });
}

export async function handleGamificationPageSaveSettings(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" && auth.role !== "judge") return json({ error: "forbidden" }, 403);
  const body = await req.json() as GamificationSettings;

  if (auth.role === "admin") {
    await (await Kv.getInstance()).saveGamificationSettings(auth.orgId, body);
  } else {
    await (await Kv.getInstance()).saveJudgeGamificationOverride(auth.orgId, auth.email, body);
  }
  return json({ ok: true });
}
