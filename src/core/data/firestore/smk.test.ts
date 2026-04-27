import { assert, assertEquals } from "#assert";
import { encodeDocId, toFsValue, fromFsValue, resetFirestoreCredentials } from "./mod.ts";

Deno.test("firestore — public API exports", async () => {
  const mod = await import("./mod.ts");
  assert(typeof mod.loadFirestoreCredentials === "function");
  assert(typeof mod.getDoc === "function");
  assert(typeof mod.setDoc === "function");
  assert(typeof mod.deleteDoc === "function");
  assert(typeof mod.setDocIfAbsent === "function");
  assert(typeof mod.listDocsByType === "function");
  assert(typeof mod.listDocsByIdPrefix === "function");
  assert(typeof mod.getChunked === "function");
  assert(typeof mod.setChunked === "function");
  assert(typeof mod.deleteChunked === "function");
  assert(typeof mod.encodeDocId === "function");
  resetFirestoreCredentials();
});

Deno.test("firestore — encodeDocId joins parts with __ separator", () => {
  assertEquals(encodeDocId("audit-finding", "monsterrg", "abc123"), "audit-finding__monsterrg__abc123");
  assertEquals(encodeDocId("gamification-settings", "monsterrg"), "gamification-settings__monsterrg");
  // Email dots get replaced with underscores (dots are reserved in Firestore field paths).
  assertEquals(encodeDocId("earned-badge", "monsterrg", "user@x.com", "bdg-1"), "earned-badge__monsterrg__user@x_com__bdg-1");
});

Deno.test("firestore — encodeDocId sanitizes forbidden chars", () => {
  // dots, slashes, and __ collisions get collapsed to _
  assertEquals(encodeDocId("audit-finding", "org/with/slash", "id.with.dots"), "audit-finding__org_with_slash__id_with_dots");
  assertEquals(encodeDocId("type__with__seps", "org", "id"), "type_with_seps__org__id");
});

Deno.test("firestore — toFsValue/fromFsValue round-trip primitives", () => {
  for (const v of [null, true, false, 42, 3.14, "hello", ""]) {
    assertEquals(fromFsValue(toFsValue(v)), v);
  }
});

Deno.test("firestore — toFsValue/fromFsValue round-trip arrays", () => {
  const arr = [1, "two", true, null, [3, 4], { nested: "yes" }];
  assertEquals(fromFsValue(toFsValue(arr)), arr);
});

Deno.test("firestore — toFsValue/fromFsValue round-trip objects", () => {
  const obj = { a: 1, b: "two", c: [1, 2, 3], d: { nested: { deep: "value" } }, e: null };
  assertEquals(fromFsValue(toFsValue(obj)), obj);
});

Deno.test("firestore — integers vs doubles encoded correctly", () => {
  // Safe integers → integerValue
  const intEncoded = toFsValue(42);
  assert("integerValue" in intEncoded);
  // Non-integer → doubleValue
  const dblEncoded = toFsValue(3.14);
  assert("doubleValue" in dblEncoded);
});

Deno.test("firestore — loadFirestoreCredentials returns null when env unset", async () => {
  resetFirestoreCredentials();
  const orig = {
    bucket: Deno.env.get("S3_BUCKET"),
    saKey: Deno.env.get("FIREBASE_SA_S3_KEY"),
    projectId: Deno.env.get("FIREBASE_PROJECT_ID"),
  };
  Deno.env.delete("S3_BUCKET");
  Deno.env.delete("AWS_S3_BUCKET");
  Deno.env.delete("FIREBASE_SA_S3_KEY");
  Deno.env.delete("FIREBASE_PROJECT_ID");
  try {
    const { loadFirestoreCredentials } = await import("./mod.ts");
    assertEquals(await loadFirestoreCredentials(), null);
  } finally {
    if (orig.bucket) Deno.env.set("S3_BUCKET", orig.bucket);
    if (orig.saKey) Deno.env.set("FIREBASE_SA_S3_KEY", orig.saKey);
    if (orig.projectId) Deno.env.set("FIREBASE_PROJECT_ID", orig.projectId);
    resetFirestoreCredentials();
  }
});
