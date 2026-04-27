import { assert, assertEquals } from "#assert";
import {
  encodeDocId, toFsValue, fromFsValue,
  getDoc, setDoc, deleteDoc, setDocIfAbsent,
  getStored, setStored, setStoredIfAbsent, deleteStored,
  listStored, listStoredWithKeys, listStoredByIdPrefix,
  getStoredChunked, setStoredChunked, deleteStoredChunked,
  resetFirestoreCredentials,
} from "./mod.ts";

Deno.test("firestore — public API exports", async () => {
  const mod = await import("./mod.ts");
  for (const name of [
    "loadFirestoreCredentials", "encodeDocId", "toFsValue", "fromFsValue",
    "getDoc", "setDoc", "deleteDoc", "setDocIfAbsent",
    "getStored", "setStored", "setStoredIfAbsent", "deleteStored",
    "listStored", "listStoredWithKeys", "listStoredByIdPrefix",
    "getStoredChunked", "setStoredChunked", "deleteStoredChunked",
  ]) {
    assert(typeof (mod as Record<string, unknown>)[name] === "function", `missing export: ${name}`);
  }
});

Deno.test("firestore — encodeDocId joins parts with __ separator", () => {
  assertEquals(encodeDocId("audit-finding", "monsterrg", "abc123"), "audit-finding__monsterrg__abc123");
  assertEquals(encodeDocId("gamification-settings", "monsterrg"), "gamification-settings__monsterrg");
});

Deno.test("firestore — encodeDocId sanitizes forbidden chars", () => {
  assertEquals(encodeDocId("audit-finding", "org/with/slash", "id.with.dots"), "audit-finding__org_with_slash__id_with_dots");
  assertEquals(encodeDocId("type__with__seps", "org", "id"), "type_with_seps__org__id");
  assertEquals(encodeDocId("earned-badge", "monsterrg", "user@x.com", "bdg-1"), "earned-badge__monsterrg__user@x_com__bdg-1");
});

Deno.test("firestore — field codec round-trip", () => {
  const cases: unknown[] = [null, true, false, 42, 3.14, "hello", "", [1, 2, 3], { a: 1, b: [2, 3], c: { d: "e" } }];
  for (const v of cases) assertEquals(fromFsValue(toFsValue(v)), v);
});

Deno.test("firestore — integers vs doubles encoded correctly", () => {
  const intEncoded = toFsValue(42);
  assert("integerValue" in intEncoded);
  const dblEncoded = toFsValue(3.14);
  assert("doubleValue" in dblEncoded);
});

// ── In-memory backend smoke (used when no creds set) ──────────────────────

Deno.test("firestore in-mem — getStored / setStored round-trip object", async () => {
  resetFirestoreCredentials();
  await setStored("test-type", "org-a", ["k1"], { foo: "bar", n: 7 });
  const got = await getStored<{ foo: string; n: number }>("test-type", "org-a", "k1");
  assertEquals(got, { foo: "bar", n: 7 });
});

Deno.test("firestore in-mem — getStored / setStored round-trip primitive (boolean)", async () => {
  resetFirestoreCredentials();
  await setStored("pipeline-paused", "org-a", [], true);
  assertEquals(await getStored<boolean>("pipeline-paused", "org-a"), true);
  await setStored("pipeline-paused", "org-a", [], false);
  assertEquals(await getStored<boolean>("pipeline-paused", "org-a"), false);
});

Deno.test("firestore in-mem — getStored returns null for missing doc", async () => {
  resetFirestoreCredentials();
  assertEquals(await getStored("nope", "org-a", "missing"), null);
});

Deno.test("firestore in-mem — deleteStored is idempotent", async () => {
  resetFirestoreCredentials();
  await setStored("t", "org-a", ["k"], { v: 1 });
  await deleteStored("t", "org-a", "k");
  assertEquals(await getStored("t", "org-a", "k"), null);
  await deleteStored("t", "org-a", "k"); // no throw
});

Deno.test("firestore in-mem — setStoredIfAbsent claims first writer", async () => {
  resetFirestoreCredentials();
  assertEquals(await setStoredIfAbsent("dedup", "org-a", ["x"], { ts: 1 }), true);
  assertEquals(await setStoredIfAbsent("dedup", "org-a", ["x"], { ts: 2 }), false);
  const v = await getStored<{ ts: number }>("dedup", "org-a", "x");
  assertEquals(v?.ts, 1);
});

Deno.test("firestore in-mem — listStored filters by type+org", async () => {
  resetFirestoreCredentials();
  await setStored("badge", "org-a", ["b1"], { name: "Foo" });
  await setStored("badge", "org-a", ["b2"], { name: "Bar" });
  await setStored("badge", "org-b", ["b3"], { name: "Baz" });
  await setStored("not-a-badge", "org-a", ["x"], { name: "Skip" });
  const list = await listStored<{ name: string }>("badge", "org-a");
  assertEquals(list.length, 2);
  const names = new Set(list.map((b) => b.name));
  assert(names.has("Foo") && names.has("Bar"));
});

Deno.test("firestore in-mem — listStoredWithKeys returns key parts", async () => {
  resetFirestoreCredentials();
  await setStored("manager-scope", "org-a", ["alice@x.com"], { departments: ["d"], shifts: [] });
  await setStored("manager-scope", "org-a", ["bob@x.com"], { departments: [], shifts: ["s"] });
  const list = await listStoredWithKeys<{ departments: string[]; shifts: string[] }>("manager-scope", "org-a");
  assertEquals(list.length, 2);
  // Note: key parts go through safePart (dots → _)
  const keys = new Set(list.map((r) => r.key.join(",")));
  assert(keys.has("alice@x_com") || keys.has("alice@x.com")); // sanitized form
});

Deno.test("firestore in-mem — TTL expiry hides expired docs", async () => {
  resetFirestoreCredentials();
  await setStored("ephemeral", "org-a", ["x"], { v: 1 }, { expireInMs: -1 }); // already expired
  assertEquals(await getStored("ephemeral", "org-a", "x"), null);
});

Deno.test("firestore in-mem — listStoredByIdPrefix walks ordered keys", async () => {
  resetFirestoreCredentials();
  await setStored("audit-done-idx", "org-a", ["00001-aaa"], { ts: 1 });
  await setStored("audit-done-idx", "org-a", ["00002-bbb"], { ts: 2 });
  await setStored("audit-done-idx", "org-a", ["00003-ccc"], { ts: 3 });
  await setStored("audit-done-idx", "org-b", ["99999-zzz"], { ts: 99 });
  const rows = await listStoredByIdPrefix<{ ts: number }>("audit-done-idx__org-a__");
  assertEquals(rows.length, 3);
  for (const r of rows) assert(r.id.startsWith("audit-done-idx__org-a__"));
});

Deno.test("firestore in-mem — chunked round-trip (small value)", async () => {
  resetFirestoreCredentials();
  const value = { name: "test", chars: "small" };
  await setStoredChunked("audit-finding", "org-a", ["fid-1"], value);
  assertEquals(await getStoredChunked("audit-finding", "org-a", "fid-1"), value);
});

Deno.test("firestore in-mem — chunked round-trip (large value triggers chunking)", async () => {
  resetFirestoreCredentials();
  const big = "x".repeat(1_500_000); // 1.5MB → 3 chunks at 700K each
  const value = { name: "transcript", body: big };
  await setStoredChunked("audit-transcript", "org-a", ["fid-1"], value);
  const got = await getStoredChunked<{ name: string; body: string }>("audit-transcript", "org-a", "fid-1");
  assertEquals(got?.name, "transcript");
  assertEquals(got?.body.length, 1_500_000);
});

Deno.test("firestore in-mem — deleteStoredChunked removes header + all chunks", async () => {
  resetFirestoreCredentials();
  const big = "y".repeat(1_500_000);
  await setStoredChunked("audit-transcript", "org-a", ["fid-2"], { body: big });
  await deleteStoredChunked("audit-transcript", "org-a", "fid-2");
  assertEquals(await getStoredChunked("audit-transcript", "org-a", "fid-2"), null);
});

Deno.test("firestore in-mem — low-level getDoc/setDoc/setDocIfAbsent/deleteDoc work", async () => {
  resetFirestoreCredentials();
  const id = encodeDocId("manual", "org-a", "k1");
  await setDoc(id, { type: "manual", org: "org-a", key: ["k1"] }, { v: 1 });
  const body = await getDoc(id);
  assert(body !== null);
  assertEquals(body!._type, "manual");
  assertEquals(body!._org, "org-a");
  assertEquals(body!.v, 1);

  const id2 = encodeDocId("manual", "org-a", "k2");
  assertEquals(await setDocIfAbsent(id2, { type: "manual", org: "org-a", key: ["k2"] }, { v: 2 }), true);
  assertEquals(await setDocIfAbsent(id2, { type: "manual", org: "org-a", key: ["k2"] }, { v: 99 }), false);

  await deleteDoc(id);
  assertEquals(await getDoc(id), null);
});
