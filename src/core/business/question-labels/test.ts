import { assertEquals } from "#assert";
import { QUESTION_LABELS, questionLabel, shortQuestionLabel } from "./mod.ts";
import { createQuestion } from "@core/dto/types.ts";

Deno.test("shortQuestionLabel — renames a mapped header, passes anything else through", () => {
  assertEquals(shortQuestionLabel("9% Service Fee"), "11% Service Fee");
  assertEquals(shortQuestionLabel("Preview 15 Months"), "Previous Presentation");
  assertEquals(shortQuestionLabel("Attending Presentation Together?"), "Presentation Disclosure");
  assertEquals(shortQuestionLabel("Guest Name"), "Guest Name");
  assertEquals(shortQuestionLabel("Some Question We Never Renamed"), "Some Question We Never Renamed");
  assertEquals(shortQuestionLabel("  Taxes  "), "Taxes");
});

Deno.test("shortQuestionLabel — applying it twice changes nothing", () => {
  // Surfaces relabel at several layers (repository → route → component); a
  // label that mapped again would drift a second time.
  for (const [header, label] of Object.entries(QUESTION_LABELS)) {
    assertEquals(shortQuestionLabel(label), label, `${header} → ${label} is not stable`);
  }
});

Deno.test("questionLabel — prefers the stamped label, else derives it from the header", () => {
  assertEquals(questionLabel({ displayHeader: "11% Service Fee", header: "9% Service Fee" }), "11% Service Fee");
  // Pre-2026-08 findings carry no displayHeader — they still relabel.
  assertEquals(questionLabel({ header: "9% Service Fee" }), "11% Service Fee");
  // A header-less question falls back to the prompt rather than rendering blank.
  assertEquals(questionLabel({ populated: "Did the team member…" }), "Did the team member…");
  assertEquals(questionLabel(null), "");
});

Deno.test("createQuestion — stamps the display label without touching the header", () => {
  const q = createQuestion({
    header: "Preview 15 Months",
    unpopulated: "Did they attend…",
    populated: "Did they attend…",
    autoYesExp: "",
  });
  assertEquals(q.header, "Preview 15 Months", "header is the identity — indexes and stats key off it");
  assertEquals(q.displayHeader, "Previous Presentation");
  assertEquals(questionLabel(q), "Previous Presentation");
});
