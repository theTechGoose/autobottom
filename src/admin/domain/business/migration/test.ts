/** Unit tests for migration key decoder + helper logic. Pure — no KV/Firestore. */
import { assertEquals, assert } from "#assert";
import { decodeKey, GLOBAL_TYPES, SKIP_TYPES } from "@admin/domain/business/migration/mod.ts";

Deno.test("decodeKey — TypedStore shape with PascalCase type", () => {
  const r = decodeKey(["__AuditFinding__", "org-1", "fid-123"]);
  assert(r);
  assertEquals(r.type, "audit-finding");
  assertEquals(r.org, "org-1");
  assertEquals(r.keyParts, ["fid-123"]);
  assertEquals(r.isChunkPart, false);
  assertEquals(r.isChunkMeta, false);
});

Deno.test("decodeKey — global type prod shape: org / org-by-slug / email-index", () => {
  const a = decodeKey(["org", "org-uuid"]);
  assertEquals(a?.type, "org");
  assertEquals(a?.org, "");
  assertEquals(a?.keyParts, ["org-uuid"]);

  const b = decodeKey(["email-index", "user@x.com"]);
  assertEquals(b?.type, "email-index");
  assertEquals(b?.org, "");
  assertEquals(b?.keyParts, ["user@x.com"]);

  const c = decodeKey(["org-by-slug", "monster"]);
  assertEquals(c?.type, "org-by-slug");
  assertEquals(c?.org, "");
});

Deno.test("decodeKey — orgKey shape [orgId, kebab-name, ...rest]", () => {
  const r = decodeKey(["org-1", "appeal", "fid-99"]);
  assertEquals(r?.type, "appeal");
  assertEquals(r?.org, "org-1");
  assertEquals(r?.keyParts, ["fid-99"]);
});

Deno.test("decodeKey — chunked meta marker (_n)", () => {
  const r = decodeKey(["__AuditTranscript__", "org-1", "fid", "_n"]);
  assertEquals(r?.type, "audit-transcript");
  assertEquals(r?.isChunkMeta, true);
  assertEquals(r?.isChunkPart, false);
  assertEquals(r?.keyParts, ["fid"]);
});

Deno.test("decodeKey — chunked slice (numeric tail)", () => {
  const r = decodeKey(["__AuditTranscript__", "org-1", "fid", 0]);
  assertEquals(r?.type, "audit-transcript");
  assertEquals(r?.isChunkPart, true);
  assertEquals(r?.isChunkMeta, false);
  assertEquals(r?.keyParts, ["fid"]);
});

Deno.test("decodeKey — orgKey chunked: [orgId, audit-answers, fid, qIdx, _n]", () => {
  const meta = decodeKey(["org-1", "audit-answers", "fid-99", 3, "_n"]);
  assertEquals(meta?.type, "audit-answers");
  assertEquals(meta?.org, "org-1");
  assertEquals(meta?.isChunkMeta, true);
  assertEquals(meta?.keyParts, ["fid-99", 3]);

  const slice = decodeKey(["org-1", "audit-answers", "fid-99", 3, 0]);
  assertEquals(slice?.type, "audit-answers");
  assertEquals(slice?.isChunkPart, true);
  assertEquals(slice?.keyParts, ["fid-99", 3]);
});

Deno.test("decodeKey — globals appear in GLOBAL_TYPES set", () => {
  for (const t of ["org", "org-by-slug", "email-index", "audit-finding", "audit-transcript"]) {
    assert(GLOBAL_TYPES.has(t), `${t} should be a global`);
  }
});

Deno.test("SKIP_TYPES — covers transient/in-flight types", () => {
  assert(SKIP_TYPES.has("session"));
  assert(SKIP_TYPES.has("review-pending"));
  assert(SKIP_TYPES.has("review-decided"));
  assert(SKIP_TYPES.has("review-audit-pending"));
});

Deno.test("decodeKey — empty/malformed keys return null", () => {
  assertEquals(decodeKey([]), null);
  // Unknown first part with single element — not a global, not a typed-store
  assertEquals(decodeKey(["random"]), null);
});

Deno.test("decodeKey — numeric tail does NOT mark scalar single-part as chunk", () => {
  // [orgId, "user", "user@x.com"] — keyParts = ["user@x.com"], length 1, not chunk
  const r = decodeKey(["org-1", "user", "user@x.com"]);
  assertEquals(r?.type, "user");
  assertEquals(r?.isChunkPart, false);
  assertEquals(r?.keyParts, ["user@x.com"]);
});
