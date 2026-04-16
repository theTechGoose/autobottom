/** Unit tests for webhook-handlers — pure parseVoName + renderTemplate paths.
 *  The end-to-end fireWebhook → email send path is covered by the e2e suite
 *  (tests/e2e/dashboard.test.ts) so we don't need Postmark in unit tests. */

import { assertEquals } from "#assert";
import { __test__ } from "./mod.ts";

const { parseVoName, renderTemplate } = __test__;

Deno.test("parseVoName — strips 'VO XX - ' prefix", () => {
  assertEquals(parseVoName("VO MB - Harmony Eason", "h@x.com"), { full: "Harmony Eason", first: "Harmony" });
});

Deno.test("parseVoName — falls back to email local-part when name empty", () => {
  assertEquals(parseVoName("", "homer.simpson@x.com"), { full: "Homer Simpson", first: "Homer" });
});

Deno.test("parseVoName — uses raw name when no ' - ' separator present", () => {
  assertEquals(parseVoName("Marge Simpson", "x@y.com"), { full: "Marge Simpson", first: "Marge" });
});

Deno.test("renderTemplate — substitutes {{var}} tokens", () => {
  const out = renderTemplate("Hi {{name}}, score={{score}}", { name: "Homer", score: "80%" });
  assertEquals(out, "Hi Homer, score=80%");
});

Deno.test("renderTemplate — empty string for missing keys", () => {
  assertEquals(renderTemplate("[{{missing}}]", {}), "[]");
});
