/** E2E placeholder for migration controller — the real path requires
 *  PROD_EXPORT_BASE_URL + KV_EXPORT_SECRET to hit the prod export endpoint,
 *  so we keep this minimal and assert config-check responds sensibly when
 *  env is missing or malformed. */
import { assert, assertEquals } from "#assert";
import { ensureProdKvConfigured } from "@admin/domain/business/migration/mod.ts";

Deno.test("migration config-check — returns error when PROD_EXPORT_BASE_URL missing", () => {
  const orig = Deno.env.get("PROD_EXPORT_BASE_URL");
  Deno.env.delete("PROD_EXPORT_BASE_URL");
  try {
    const r = ensureProdKvConfigured();
    assertEquals(r.ok, false);
    if (!r.ok) assert(r.error.includes("PROD_EXPORT_BASE_URL"));
  } finally {
    if (orig) Deno.env.set("PROD_EXPORT_BASE_URL", orig);
  }
});

Deno.test("migration config-check — rejects non-https PROD_EXPORT_BASE_URL", () => {
  const origUrl = Deno.env.get("PROD_EXPORT_BASE_URL");
  const origTok = Deno.env.get("KV_EXPORT_SECRET");
  Deno.env.set("PROD_EXPORT_BASE_URL", "http://example.com");
  Deno.env.set("KV_EXPORT_SECRET", "fake");
  try {
    const r = ensureProdKvConfigured();
    assertEquals(r.ok, false);
  } finally {
    if (origUrl) Deno.env.set("PROD_EXPORT_BASE_URL", origUrl); else Deno.env.delete("PROD_EXPORT_BASE_URL");
    if (origTok) Deno.env.set("KV_EXPORT_SECRET", origTok); else Deno.env.delete("KV_EXPORT_SECRET");
  }
});

Deno.test("migration controller imports cleanly", async () => {
  const mod = await import("@admin/entrypoints/migration/mod.ts");
  assert(typeof mod.MigrationController === "function");
});
