/** Sound file serving handler — serves from S3 or local fallback. */

import { S3Ref } from "../domain/data/s3/mod.ts";
import { env } from "../env.ts";
import { json } from "./helpers.ts";

/**
 * Handle GET requests to /sounds/...
 * Returns a Response for sound paths, or null if the request doesn't match.
 *
 * Routes:
 * - /sounds/{orgId}/{packId}/{slot}.mp3 → S3
 * - /sounds/{name}.mp3 → local file fallback
 * - anything else under /sounds/ → 400
 */
export async function handleSoundFile(req: Request): Promise<Response | null> {
  const url = new URL(req.url);

  if (req.method !== "GET" || !url.pathname.startsWith("/sounds/")) {
    return null;
  }

  const parts = url.pathname.replace("/sounds/", "").split("/");

  // S3 path: /sounds/{orgId}/{packId}/{slot}.mp3
  if (parts.length === 3 && parts[2].endsWith(".mp3")) {
    const [orgId, packId, slotFile] = parts;
    const s3Key = `sounds/${orgId}/${packId}/${slotFile}`;
    try {
      const ref = new S3Ref(env.s3Bucket, s3Key);
      const bytes = await ref.get();
      if (!bytes) return json({ error: "not found" }, 404);
      return new Response(bytes, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      return json({ error: "not found" }, 404);
    }
  }

  // Legacy: serve local files by name (fallback during migration)
  const name = url.pathname.replace("/sounds/", "");
  if (/^[\w\-.]+\.mp3$/.test(name)) {
    try {
      const bytes = await Deno.readFile(
        new URL("../../sounds/" + name, import.meta.url),
      );
      return new Response(bytes, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch {
      return json({ error: "not found" }, 404);
    }
  }

  return json({ error: "bad path" }, 400);
}
