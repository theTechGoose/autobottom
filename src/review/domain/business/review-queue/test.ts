/** Tests for review queue FIFO ordering and selection logic. */

import { assertEquals, assert } from "jsr:@std/assert";
import { selectOldestFinding } from "./mod.ts";
import type { ReviewItem } from "@core/dto/types.ts";

function makeItem(findingId: string, questionIndex: number, completedAt?: number, recordingIdField?: string): { value: ReviewItem } {
  return {
    value: {
      findingId, questionIndex, reviewIndex: questionIndex + 1, totalForFinding: 1,
      header: `Q${questionIndex}`, populated: `Question ${questionIndex}`,
      thinking: "thinking", defense: "defense", answer: "No",
      ...(completedAt != null ? { completedAt } : {}),
      ...(recordingIdField ? { recordingIdField } : {}),
    },
  };
}

Deno.test("FIFO — oldest finding picked first", () => {
  const fri = new Date("2026-04-10T12:00:00Z").getTime();
  const sat = new Date("2026-04-11T12:00:00Z").getTime();
  const sun = new Date("2026-04-12T12:00:00Z").getTime();
  const items = [makeItem("sat", 0, sat), makeItem("sun", 0, sun), makeItem("fri", 0, fri)];
  assertEquals(selectOldestFinding(items).targetFindingId, "fri");
});

Deno.test("FIFO — no completedAt treated as oldest", () => {
  const items = [makeItem("new", 0, Date.now()), makeItem("old-no-ts", 0)];
  assertEquals(selectOldestFinding(items).targetFindingId, "old-no-ts");
});

Deno.test("FIFO — type filtering before selection", () => {
  const items = [makeItem("pkg", 0, 1000, "GenieNumber"), makeItem("dl", 0, 2000)];
  assertEquals(selectOldestFinding(items, ["date-leg"]).targetFindingId, "dl");
});

Deno.test("FIFO — all items for selected finding returned", () => {
  const items = [makeItem("A", 0, 1000), makeItem("A", 1, 1000), makeItem("A", 2, 1000), makeItem("B", 0, 2000)];
  const { targetFindingId, indices } = selectOldestFinding(items);
  assertEquals(targetFindingId, "A");
  assertEquals(indices.length, 3);
});

Deno.test("FIFO — empty returns null", () => {
  assertEquals(selectOldestFinding([]).targetFindingId, null);
});

Deno.test("FIFO — type filter removes all returns null", () => {
  const items = [makeItem("pkg", 0, 1000, "GenieNumber")];
  assertEquals(selectOldestFinding(items, ["date-leg"]).targetFindingId, null);
});
