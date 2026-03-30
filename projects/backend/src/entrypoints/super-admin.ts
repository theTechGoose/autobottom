/** HTTP handlers for super-admin API routes. */

import { json } from "./helpers.ts";
import { seedOrgData } from "./admin.ts";
import { BUILTIN_PACKS, BUILTIN_PACK_NAMES } from "./gamification.ts";
import { createOrg, createUser, deleteOrg, listOrgs, createSession, sessionCookie } from "../domain/coordinators/auth/mod.ts";
import { kvFactory } from "../domain/data/kv/factory.ts";
import { saveSoundPack } from "../domain/data/kv/mod.ts";
import type { SoundPackMeta, SoundSlot } from "../domain/data/kv/mod.ts";
import { S3Ref } from "../domain/data/s3/mod.ts";
import { env } from "../domain/data/env/mod.ts";

export async function routeSuperAdmin(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/super-admin/api/orgs") {
    return handleSuperAdminListOrgs();
  }
  if (req.method === "POST" && path === "/super-admin/api/org") {
    return handleSuperAdminCreateOrg(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/delete") {
    return handleSuperAdminDeleteOrg(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/seed") {
    return handleSuperAdminSeed(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/seed-sounds") {
    return handleSuperAdminSeedSounds(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/wipe") {
    return handleSuperAdminWipe(req);
  }
  if (req.method === "POST" && path === "/super-admin/api/org/impersonate") {
    return handleSuperAdminImpersonate(req);
  }
  return json({ error: "not found" }, 404);
}

async function handleSuperAdminListOrgs(): Promise<Response> {
  const db = await kvFactory();
  const orgs = await listOrgs();

  const result = [];
  for (const org of orgs) {
    let userCount = 0;
    for await (const _ of db.list({ prefix: [org.id, "user"] })) {
      userCount++;
    }
    // Count findings: ChunkedKv stores _n meta-key per finding
    let findingCount = 0;
    for await (const entry of db.list({ prefix: [org.id, "audit-finding"] })) {
      const lastKey = entry.key[entry.key.length - 1];
      if (lastKey === "_n") findingCount++;
    }
    result.push({ ...org, userCount, findingCount });
  }
  return json(result);
}

async function handleSuperAdminCreateOrg(req: Request): Promise<Response> {
  const body = await req.json();
  const { name } = body;
  if (!name) return json({ error: "name required" }, 400);

  const orgId = await createOrg(name, "super-admin@local");
  await createUser(orgId, "admin@autobot.dev", "admin", "admin");
  return json({ ok: true, orgId });
}

async function handleSuperAdminDeleteOrg(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  // Wipe all org-scoped KV entries
  const db = await kvFactory();
  let deleted = 0;
  for await (const entry of db.list({ prefix: [orgId] })) {
    await db.delete(entry.key);
    deleted++;
  }

  // Clean up email-index entries pointing to this org
  for await (const entry of db.list<{ orgId: string }>({ prefix: ["email-index"] })) {
    if (entry.value && entry.value.orgId === orgId) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  // Clear default-org pointer if it points to this org
  const defaultOrg = await db.get<string>(["default-org"]);
  if (defaultOrg.value === orgId) {
    await db.delete(["default-org"]);
  }

  // Delete the org record itself
  await deleteOrg(orgId);

  console.log(`[SUPER-ADMIN] Deleted org ${orgId}: ${deleted} KV entries removed`);
  return json({ ok: true, deleted });
}

async function handleSuperAdminSeed(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  const result = await seedOrgData(orgId);
  return json({ ok: true, ...result });
}

async function handleSuperAdminSeedSounds(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId, packIds } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);
  if (!packIds?.length) return json({ error: "packIds required" }, 400);

  let uploaded = 0;
  const errors: string[] = [];

  for (const packId of packIds) {
    const slots = BUILTIN_PACKS[packId];
    if (!slots) { errors.push(`Unknown pack: ${packId}`); continue; }

    const pack: SoundPackMeta = {
      id: packId,
      name: BUILTIN_PACK_NAMES[packId] || packId,
      slots: {},
      createdAt: Date.now(),
      createdBy: "super-admin@local",
    };

    for (const [slot, filename] of Object.entries(slots)) {
      try {
        const filePath = new URL("../../assets/sounds/" + filename, import.meta.url);
        const bytes = await Deno.readFile(filePath);
        const s3Key = `sounds/${orgId}/${packId}/${slot}.mp3`;
        const ref = new S3Ref(env.s3Bucket, s3Key);
        await ref.save(bytes);
        pack.slots[slot as SoundSlot] = filename;
        uploaded++;
      } catch (e) {
        errors.push(`${packId}/${slot}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await saveSoundPack(orgId, pack);
  }

  return json({ ok: true, uploaded, errors: errors.length > 0 ? errors : undefined });
}

async function handleSuperAdminWipe(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  const db = await kvFactory();
  let deleted = 0;
  for await (const entry of db.list({ prefix: [orgId] })) {
    await db.delete(entry.key);
    deleted++;
  }

  // Clean up email-index entries pointing to this org
  for await (const entry of db.list<{ orgId: string }>({ prefix: ["email-index"] })) {
    if (entry.value && entry.value.orgId === orgId) {
      await db.delete(entry.key);
      deleted++;
    }
  }

  console.log(`[SUPER-ADMIN] Wiped org ${orgId}: ${deleted} KV entries`);
  return json({ ok: true, deleted });
}

async function handleSuperAdminImpersonate(req: Request): Promise<Response> {
  const body = await req.json();
  const { orgId } = body;
  if (!orgId) return json({ error: "orgId required" }, 400);

  const token = await createSession({ email: "super-admin@local", orgId, role: "admin" });
  return new Response(JSON.stringify({ ok: true, redirect: "/admin/dashboard" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookie(token),
    },
  });
}
