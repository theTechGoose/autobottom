/** The appeal form's "Different Recording" tab is seeded from the audit's
 *  recordings. Seeding only `recordingId` (the first genie) made an agent who
 *  "added" a callback silently drop the audit's other recordings. */
import { assertEquals } from "@std/assert";
import { appealGenieIds } from "../../lib/appeal-genie-ids.ts";

Deno.test("REQ-007: a multi-recording audit seeds every genie into the appeal form", () => {
  // The prod case: pitch split across two genies, recordingId is the first.
  assertEquals(
    appealGenieIds({ recordingId: "27694351", genieIds: ["27694351", "27694359"] }),
    ["27694351", "27694359"],
  );
});

Deno.test("REQ-007: a single-recording audit seeds its one genie", () => {
  assertEquals(appealGenieIds({ recordingId: "27200000" }), ["27200000"]);
  assertEquals(appealGenieIds({ recordingId: 27200000, genieIds: [] }), ["27200000"]);
});

Deno.test("REQ-007: falls back to the record's VoGenie, and to nothing", () => {
  assertEquals(appealGenieIds({ record: { VoGenie: "27200005" } }), ["27200005"]);
  assertEquals(appealGenieIds({}), []);
  assertEquals(appealGenieIds({ genieIds: ["", " 27200006 "] }), ["27200006"]);
});
