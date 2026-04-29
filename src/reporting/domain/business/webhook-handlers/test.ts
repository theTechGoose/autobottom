/** Unit tests for webhook-handlers — pure parseVoName + renderTemplate paths.
 *  The end-to-end fireWebhook → email send path is covered by the e2e suite
 *  (tests/e2e/dashboard.test.ts) so we don't need Postmark in unit tests. */

import { assertEquals } from "#assert";
import { parseVoName, renderTemplate, buildGreeting } from "./mod.ts";

Deno.test("parseVoName — strips 'VO XX - ' prefix", () => {
  assertEquals(parseVoName("VO MB - Harmony Eason", "h@x.com"), { full: "Harmony Eason", first: "Harmony" });
});

Deno.test("parseVoName — falls back to email local-part when name empty", () => {
  assertEquals(parseVoName("", "homer.simpson@x.com"), { full: "Homer Simpson", first: "Homer" });
});

Deno.test("parseVoName — uses raw name when no ' - ' separator present", () => {
  assertEquals(parseVoName("Marge Simpson", "x@y.com"), { full: "Marge Simpson", first: "Marge" });
});

Deno.test("parseVoName — bare token fallback (no @) returns empty (regression: 'Hi Api' bug)", () => {
  // finding.owner defaults to "api" for unauthenticated audits. Without this
  // guard, parseVoName would title-case "api" → "Api" and emails would say
  // "Hi Api". Now: empty fall-through, caller's "Hi there" greeting kicks in.
  assertEquals(parseVoName("", "api"), { full: "", first: "" });
  assertEquals(parseVoName("", "test"), { full: "", first: "" });
  assertEquals(parseVoName("", ""), { full: "", first: "" });
});

Deno.test("parseVoName — VoName always wins over fallback", () => {
  assertEquals(parseVoName("Real Name", "api"), { full: "Real Name", first: "Real" });
  assertEquals(parseVoName("VO MB - Real Name", "api"), { full: "Real Name", first: "Real" });
});

Deno.test("buildGreeting — uses name when present", () => {
  assertEquals(buildGreeting("Harmony"), "Hi Harmony");
});

Deno.test("buildGreeting — falls back to 'Hi there' when empty", () => {
  assertEquals(buildGreeting(""), "Hi there");
});

Deno.test("renderTemplate — substitutes {{var}} tokens", () => {
  const out = renderTemplate("Hi {{name}}, score={{score}}", { name: "Homer", score: "80%" });
  assertEquals(out, "Hi Homer, score=80%");
});

Deno.test("renderTemplate — empty string for missing keys", () => {
  assertEquals(renderTemplate("[{{missing}}]", {}), "[]");
});
