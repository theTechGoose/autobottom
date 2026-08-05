/** Unit tests for webhook-handlers — pure parseVoName + renderTemplate paths.
 *  The end-to-end fireWebhook → email send path is covered by the e2e suite
 *  (tests/e2e/dashboard.test.ts) so we don't need Postmark in unit tests. */

import { assertEquals } from "#assert";
import { parseVoName, renderTemplate, buildGreeting, renderFailedQuestionsBlock, resolveManagerCc, overturnPhraseFor, envFlagEnabled } from "./mod.ts";

/** Build a minimal finding whose record carries the given SupervisorEmail. */
const findingWithSupervisor = (supervisorEmail: string) => ({
  id: "test-fid",
  record: { SupervisorEmail: supervisorEmail },
});

Deno.test("resolveManagerCc — reads SupervisorEmail and trims the comma-space (the May 11 bug)", () => {
  // The CRM formula emits ", "-joined values. The old code fed that straight in
  // and the space made the whole string an invalid address. parseEmailList now
  // splits + trims, so both supervisors come back clean.
  const cc = resolveManagerCc(findingWithSupervisor("haleys@monsterrg.com, keonib@monsterrg.com"), "asantiago@monsterrg.com");
  assertEquals(cc, "haleys@monsterrg.com, keonib@monsterrg.com");
});

Deno.test("resolveManagerCc — single supervisor", () => {
  assertEquals(
    resolveManagerCc(findingWithSupervisor("gigia@monsterrg.com"), "vo@monsterrg.com"),
    "gigia@monsterrg.com",
  );
});

Deno.test("resolveManagerCc — drops the primary recipient from the CC", () => {
  // The person the email is going TO must not be CC'd on their own email.
  const cc = resolveManagerCc(findingWithSupervisor("haleys@monsterrg.com, keonib@monsterrg.com"), "KEONIB@monsterrg.com");
  assertEquals(cc, "haleys@monsterrg.com");
});

Deno.test("resolveManagerCc — de-dupes repeated addresses", () => {
  assertEquals(
    resolveManagerCc(findingWithSupervisor("haleys@monsterrg.com, haleys@monsterrg.com"), "vo@monsterrg.com"),
    "haleys@monsterrg.com",
  );
});

Deno.test("resolveManagerCc — empty / missing SupervisorEmail yields no CC", () => {
  assertEquals(resolveManagerCc(findingWithSupervisor(""), "vo@monsterrg.com"), undefined);
  assertEquals(resolveManagerCc({ id: "x", record: {} }, "vo@monsterrg.com"), undefined);
  assertEquals(resolveManagerCc({ id: "x" }, "vo@monsterrg.com"), undefined);
});

Deno.test("resolveManagerCc — drops malformed entries but keeps valid ones", () => {
  // A blank between commas or a spaceful token isn't a valid address; only the
  // real one survives.
  assertEquals(
    resolveManagerCc(findingWithSupervisor("not an email, haleys@monsterrg.com, "), "vo@monsterrg.com"),
    "haleys@monsterrg.com",
  );
});

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

Deno.test("renderFailedQuestionsBlock — embeds inline images via cid content IDs", () => {
  const html = renderFailedQuestionsBlock([
    { header: "Greeted the customer", reason: "No greeting.", imageCids: ["shot-abc-0-0", "shot-abc-0-1"] },
  ]);
  assertEquals(html.includes('src="cid:shot-abc-0-0"'), true);
  assertEquals(html.includes('src="cid:shot-abc-0-1"'), true);
  assertEquals((html.match(/<img /g) ?? []).length, 2);
});

Deno.test("renderFailedQuestionsBlock — no <img> when a question has no screenshots", () => {
  const html = renderFailedQuestionsBlock([{ header: "Q", reason: "why", imageCids: [] }]);
  assertEquals(html.includes("<img "), false);
});

// The appeal-result email pairs this with "{{overturns}} of {{totalQuestions}}".
// totalQuestions counts the questions in the APPEAL, not the audit — prod sent
// "7 of 7 questions were overturned" on a 25-question audit (fid
// cEs2p0IYZXJbHugyqZgt5), which reads as if the audit had 7 questions.
Deno.test("overturnPhraseFor — names the scope as the appeal, not the audit", () => {
  assertEquals(
    `11 of 11 ${overturnPhraseFor(11)}`,
    "11 of 11 appealed questions were overturned",
  );
  assertEquals(
    `7 of 11 ${overturnPhraseFor(11)}`,
    "7 of 11 appealed questions were overturned",
  );
});

Deno.test("overturnPhraseFor — a one-question appeal reads as singular", () => {
  assertEquals(`1 of 1 ${overturnPhraseFor(1)}`, "1 of 1 appealed question was overturned");
  assertEquals(`0 of 1 ${overturnPhraseFor(1)}`, "0 of 1 appealed question was overturned");
});

// envFlagEnabled gates remediation emails. Its failure mode is emailing real
// team members, so anything it doesn't clearly recognise must read as OFF.

Deno.test("envFlagEnabled — an unset var is OFF, so a fresh deploy never mails", () => {
  assertEquals(envFlagEnabled(undefined), false);
  assertEquals(envFlagEnabled(""), false);
  assertEquals(envFlagEnabled("   "), false);
});

Deno.test("envFlagEnabled — explicit affirmatives turn it on, case and spacing forgiven", () => {
  for (const raw of ["true", "TRUE", " True ", "1", "yes", "on"]) {
    assertEquals(envFlagEnabled(raw), true, `${raw} should enable`);
  }
});

Deno.test("envFlagEnabled — negatives and typos stay OFF", () => {
  for (const raw of ["false", "0", "no", "off", "ture", "enabled", "maybe"]) {
    assertEquals(envFlagEnabled(raw), false, `${raw} must not enable`);
  }
});
