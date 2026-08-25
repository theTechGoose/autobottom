import { assert, assertEquals } from "#assert";
import {
  encodeDocId, toFsValue, fromFsValue,
  getDoc, setDoc, deleteDoc, setDocIfAbsent,
  getStored, setStored, setStoredIfAbsent, deleteStored,
  listStored, listStoredWithKeys, listStoredByIdPrefix,
  getStoredChunked, setStoredChunked, deleteStoredChunked,
  resetFirestoreCredentials,
} from "./mod.ts";

// Storage is a real database now, shared across runs — so each run gets its
// own org rather than reusing "org-a" and inheriting yesterday's documents.
const RUN = crypto.randomUUID().slice(0, 8);
const ORG_A = `org-a-${RUN}`;
const ORG_B = `org-b-${RUN}`;

Deno.test("firestore — public API exports", async () => {
  const mod = await import("./mod.ts");
  for (const name of [
    "loadFirestoreCredentials", "encodeDocId", "toFsValue", "fromFsValue",
    "getDoc", "setDoc", "deleteDoc", "setDocIfAbsent",
    "getStored", "setStored", "setStoredIfAbsent", "deleteStored",
    "listStored", "listStoredWithKeys", "listStoredByIdPrefix",
    "getStoredChunked", "setStoredChunked", "deleteStoredChunked",
    // withTiming now lives in datadog-otel; firestore re-exports it so the
    // many `import { withTiming } from "@core/data/firestore"` sites still work.
    "withTiming",
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

Deno.test("firestore — getStored / setStored round-trip object", async () => {
  resetFirestoreCredentials();
  await setStored("test-type", ORG_A, ["k1"], { foo: "bar", n: 7 });
  const got = await getStored<{ foo: string; n: number }>("test-type", ORG_A, "k1");
  assertEquals(got, { foo: "bar", n: 7 });
});

Deno.test("firestore — getStored / setStored round-trip primitive (boolean)", async () => {
  resetFirestoreCredentials();
  await setStored("pipeline-paused", ORG_A, [], true);
  assertEquals(await getStored<boolean>("pipeline-paused", ORG_A), true);
  await setStored("pipeline-paused", ORG_A, [], false);
  assertEquals(await getStored<boolean>("pipeline-paused", ORG_A), false);
});

Deno.test("firestore — getStored returns null for missing doc", async () => {
  resetFirestoreCredentials();
  assertEquals(await getStored("nope", ORG_A, "missing"), null);
});

Deno.test("firestore — deleteStored is idempotent", async () => {
  resetFirestoreCredentials();
  await setStored("t", ORG_A, ["k"], { v: 1 });
  await deleteStored("t", ORG_A, "k");
  assertEquals(await getStored("t", ORG_A, "k"), null);
  await deleteStored("t", ORG_A, "k"); // no throw
});

Deno.test("firestore — setStoredIfAbsent claims first writer", async () => {
  resetFirestoreCredentials();
  assertEquals(await setStoredIfAbsent("dedup", ORG_A, ["x"], { ts: 1 }), true);
  assertEquals(await setStoredIfAbsent("dedup", ORG_A, ["x"], { ts: 2 }), false);
  const v = await getStored<{ ts: number }>("dedup", ORG_A, "x");
  assertEquals(v?.ts, 1);
});

Deno.test("firestore — listStored filters by type+org", async () => {
  resetFirestoreCredentials();
  await setStored("badge", ORG_A, ["b1"], { name: "Foo" });
  await setStored("badge", ORG_A, ["b2"], { name: "Bar" });
  await setStored("badge", ORG_B, ["b3"], { name: "Baz" });
  await setStored("not-a-badge", ORG_A, ["x"], { name: "Skip" });
  const list = await listStored<{ name: string }>("badge", ORG_A);
  assertEquals(list.length, 2);
  const names = new Set(list.map((b) => b.name));
  assert(names.has("Foo") && names.has("Bar"));
});

Deno.test("firestore — listStoredWithKeys returns key parts", async () => {
  resetFirestoreCredentials();
  await setStored("manager-scope", ORG_A, ["alice@x.com"], { departments: ["d"], shifts: [] });
  await setStored("manager-scope", ORG_A, ["bob@x.com"], { departments: [], shifts: ["s"] });
  const list = await listStoredWithKeys<{ departments: string[]; shifts: string[] }>("manager-scope", ORG_A);
  assertEquals(list.length, 2);
  // Note: key parts go through safePart (dots → _)
  const keys = new Set(list.map((r) => r.key.join(",")));
  assert(keys.has("alice@x_com") || keys.has("alice@x.com")); // sanitized form
});

Deno.test("firestore — TTL expiry hides expired docs", async () => {
  resetFirestoreCredentials();
  await setStored("ephemeral", ORG_A, ["x"], { v: 1 }, { expireInMs: -1 }); // already expired
  assertEquals(await getStored("ephemeral", ORG_A, "x"), null);
});

Deno.test("firestore — listStoredByIdPrefix walks ordered keys", async () => {
  resetFirestoreCredentials();
  await setStored("audit-done-idx", ORG_A, ["00001-aaa"], { ts: 1 });
  await setStored("audit-done-idx", ORG_A, ["00002-bbb"], { ts: 2 });
  await setStored("audit-done-idx", ORG_A, ["00003-ccc"], { ts: 3 });
  await setStored("audit-done-idx", ORG_B, ["99999-zzz"], { ts: 99 });
  // Prefix has to be built from the org, not spelled out: the org is unique per
  // run now (shared database), so a hardcoded "…__org-a__" matches nothing.
  const prefix = `audit-done-idx__${ORG_A}__`;
  const rows = await listStoredByIdPrefix<{ ts: number }>(prefix);
  assertEquals(rows.length, 3);
  for (const r of rows) assert(r.id.startsWith(prefix));
});

Deno.test("firestore — chunked round-trip (small value)", async () => {
  resetFirestoreCredentials();
  const value = { name: "test", chars: "small" };
  await setStoredChunked("audit-finding", ORG_A, ["fid-1"], value);
  assertEquals(await getStoredChunked("audit-finding", ORG_A, "fid-1"), value);
});

Deno.test("firestore — chunked round-trip (large value triggers chunking)", async () => {
  resetFirestoreCredentials();
  const big = "x".repeat(1_500_000); // 1.5MB → 3 chunks at 700K each
  const value = { name: "transcript", body: big };
  await setStoredChunked("audit-transcript", ORG_A, ["fid-1"], value);
  const got = await getStoredChunked<{ name: string; body: string }>("audit-transcript", ORG_A, "fid-1");
  assertEquals(got?.name, "transcript");
  assertEquals(got?.body.length, 1_500_000);
});

Deno.test("firestore — deleteStoredChunked removes header + all chunks", async () => {
  resetFirestoreCredentials();
  const big = "y".repeat(1_500_000);
  await setStoredChunked("audit-transcript", ORG_A, ["fid-2"], { body: big });
  await deleteStoredChunked("audit-transcript", ORG_A, "fid-2");
  assertEquals(await getStoredChunked("audit-transcript", ORG_A, "fid-2"), null);
});

Deno.test("firestore — low-level getDoc/setDoc/setDocIfAbsent/deleteDoc work", async () => {
  resetFirestoreCredentials();
  const id = encodeDocId("manual", ORG_A, "k1");
  await setDoc(id, { type: "manual", org: ORG_A, key: ["k1"] }, { v: 1 });
  const body = await getDoc(id);
  assert(body !== null);
  assertEquals(body!._type, "manual");
  assertEquals(body!._org, ORG_A);
  assertEquals(body!.v, 1);

  const id2 = encodeDocId("manual", ORG_A, "k2");
  assertEquals(await setDocIfAbsent(id2, { type: "manual", org: ORG_A, key: ["k2"] }, { v: 2 }), true);
  assertEquals(await setDocIfAbsent(id2, { type: "manual", org: ORG_A, key: ["k2"] }, { v: 99 }), false);

  await deleteDoc(id);
  assertEquals(await getDoc(id), null);
});
