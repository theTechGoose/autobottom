/** E2E placeholder for migration controller — requires PROD_KV_URL to actually
 *  hit prod KV, so we keep this minimal and assert the controller can be
 *  imported + that config-check returns sensibly when env is missing. */
import { assert, assertEquals } from "#assert";
import { ensureProdKvConfigured } from "@admin/domain/business/migration/mod.ts";

Deno.test("migration config-check — returns error when PROD_KV_URL missing", () => {
  // Save then strip env
  const orig = Deno.env.get("PROD_KV_URL");
  Deno.env.delete("PROD_KV_URL");
  try {
    const r = ensureProdKvConfigured();
    assertEquals(r.ok, false);
    if (!r.ok) assert(r.error.includes("PROD_KV_URL"));
  } finally {
    if (orig) Deno.env.set("PROD_KV_URL", orig);
  }
});

Deno.test("migration config-check — rejects malformed PROD_KV_URL", () => {
  const origUrl = Deno.env.get("PROD_KV_URL");
  const origTok = Deno.env.get("KV_ACCESS_TOKEN");
  Deno.env.set("PROD_KV_URL", "https://example.com/notvalid");
  Deno.env.set("KV_ACCESS_TOKEN", "fake");
  try {
    const r = ensureProdKvConfigured();
    assertEquals(r.ok, false);
  } finally {
    if (origUrl) Deno.env.set("PROD_KV_URL", origUrl); else Deno.env.delete("PROD_KV_URL");
    if (origTok) Deno.env.set("KV_ACCESS_TOKEN", origTok); else Deno.env.delete("KV_ACCESS_TOKEN");
  }
});

Deno.test("migration controller imports cleanly", async () => {
  const mod = await import("@admin/entrypoints/migration/mod.ts");
  assert(typeof mod.MigrationController === "function");
});
