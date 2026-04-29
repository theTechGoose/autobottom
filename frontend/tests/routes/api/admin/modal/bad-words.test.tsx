/** Tests for the Bad Words modal — exclusion-rules UI rendering. */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import {
  renderWordsTab,
  type BwWordEntry,
} from "../../../../../routes/api/admin/modal/bad-words.tsx";

Deno.test("renderWordsTab — word with no exclusions shows 'no exclusions' badge and empty-state copy when expanded", () => {
  const entries: BwWordEntry[] = [{ word: "free", exclusions: [] }];
  const html = renderToString(renderWordsTab(entries, "free"));
  assertStringIncludes(html, "no exclusions");
  assertStringIncludes(html, "No exclusions — word always triggers");
  // Add-exclusion form is present
  assertStringIncludes(html, 'name="exType"');
  assertStringIncludes(html, 'name="exWord"');
  assertStringIncludes(html, 'name="exBuffer"');
  assertStringIncludes(html, "/api/admin/modal/bad-words/add-exclusion");
});

Deno.test("renderWordsTab — word with 2 exclusions renders count badge and both rows", () => {
  const entries: BwWordEntry[] = [{
    word: "free",
    exclusions: [
      { word: "toll", buffer: 1, type: "prefix" },
      { word: "shipping", buffer: 3, type: "suffix" },
    ],
  }];
  const html = renderToString(renderWordsTab(entries, "free"));
  assertStringIncludes(html, "2 exclusions");
  // Prefix → "before"
  assertStringIncludes(html, "before");
  assertStringIncludes(html, "&quot;toll&quot;");
  assertStringIncludes(html, "within 1 word");
  // Suffix → "after"
  assertStringIncludes(html, "after");
  assertStringIncludes(html, "&quot;shipping&quot;");
  assertStringIncludes(html, "within 3 words");
});

Deno.test("renderWordsTab — singular badge for exactly 1 exclusion", () => {
  const entries: BwWordEntry[] = [{
    word: "free",
    exclusions: [{ word: "toll", buffer: 1, type: "prefix" }],
  }];
  const html = renderToString(renderWordsTab(entries, null));
  assertStringIncludes(html, "1 exclusion");
  // Should NOT have the plural form
  assertEquals(html.includes("1 exclusions"), false);
});

Deno.test("renderWordsTab — only the expanded word renders its body", () => {
  const entries: BwWordEntry[] = [
    { word: "free", exclusions: [{ word: "toll", buffer: 1, type: "prefix" }] },
    { word: "guarantee", exclusions: [{ word: "money-back", buffer: 2, type: "suffix" }] },
  ];
  const html = renderToString(renderWordsTab(entries, "free"));
  // "free" body is expanded → its toll exclusion text is visible
  assertStringIncludes(html, "&quot;toll&quot;");
  // "guarantee" is collapsed → its money-back exclusion text is NOT in the DOM
  assertEquals(html.includes("money-back"), false);
  // Both header badges are present
  assertStringIncludes(html, "free");
  assertStringIncludes(html, "guarantee");
});

Deno.test("renderWordsTab — empty list shows 'No words configured'", () => {
  const html = renderToString(renderWordsTab([], null));
  assertStringIncludes(html, "No words configured");
});

Deno.test("renderWordsTab — modal-sub copy mentions exclusion-rule example", () => {
  const html = renderToString(renderWordsTab([], null));
  assertStringIncludes(html, "Expand a word to add exclusion rules");
  assertStringIncludes(html, "ignore 'free' if 'toll' precedes it");
});

Deno.test("renderWordsTab — header click toggles via hx-get against the same modal target", () => {
  const entries: BwWordEntry[] = [{ word: "free", exclusions: [] }];
  // Collapsed state → header hx-get points to expand URL with the word
  const collapsedHtml = renderToString(renderWordsTab(entries, null));
  assertStringIncludes(collapsedHtml, "tab=words&amp;expand=free");
  assertStringIncludes(collapsedHtml, 'hx-target="#bad-words-modal-content"');

  // Expanded state → header hx-get points to plain `tab=words` (collapse)
  const expandedHtml = renderToString(renderWordsTab(entries, "free"));
  // Expanded chevron present
  assertStringIncludes(expandedHtml, "▾");
});

Deno.test("renderWordsTab — remove-word button uses bad-words modal target (not the old #bw-word-list)", () => {
  const entries: BwWordEntry[] = [{ word: "free", exclusions: [] }];
  const html = renderToString(renderWordsTab(entries, null));
  // Each word card's remove button should target the entire modal so exclusions UI re-renders correctly
  assertStringIncludes(html, "/api/admin/modal/bad-words/remove-word");
  assertStringIncludes(html, 'hx-target="#bad-words-modal-content"');
});
