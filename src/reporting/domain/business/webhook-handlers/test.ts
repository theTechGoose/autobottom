/** Unit tests for webhook-handlers — pure parseVoName + renderTemplate paths.
 *  The end-to-end fireWebhook → email send path is covered by the e2e suite
 *  (tests/e2e/dashboard.test.ts) so we don't need Postmark in unit tests. */

import { assertEquals } from "#assert";
import { parseVoName, renderTemplate, buildGreeting, renderFailedQuestionsBlock } from "./mod.ts";

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

Deno.test("renderFailedQuestionsBlock — empty when nothing upheld (all overturned)", () => {
  assertEquals(renderFailedQuestionsBlock([]), "");
});

Deno.test("renderFailedQuestionsBlock — one entry per upheld question with name + reason", () => {
  const html = renderFailedQuestionsBlock([
    { header: "Greeted the customer", reason: "No greeting in the first 30 seconds." },
    { header: "Confirmed the booking", reason: "Never read back the dates." },
  ]);
  assertEquals(html.includes("Failed Questions"), true);
  assertEquals(html.includes("Greeted the customer"), true);
  assertEquals(html.includes("No greeting in the first 30 seconds."), true);
  assertEquals(html.includes("Confirmed the booking"), true);
  assertEquals(html.includes("Never read back the dates."), true);
});

Deno.test("renderFailedQuestionsBlock — escapes HTML in judge-typed reason", () => {
  const html = renderFailedQuestionsBlock([{ header: "Q<1>", reason: 'said "hi" & <b>bye</b>' }]);
  assertEquals(html.includes("&lt;b&gt;bye&lt;/b&gt;"), true);
  assertEquals(html.includes("&amp;"), true);
  assertEquals(html.includes("<b>bye</b>"), false); // raw tag must not survive
});
