/** The appeal form starts with every recording the audit used (REQ-007).
 *
 *  A pitch split across two genies opened its "Different Recording" form with
 *  only the first one filled in; an agent adding a callback swapped out the
 *  main sales call without knowing it was ever there. This story seeds a
 *  two-genie audit into the emulator project `serve` reads and opens the form
 *  from the public report the way an agent does. */
import { story } from "#shots";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";

/** The genie IDs currently in the form's recording rows, top to bottom. */
// deno-lint-ignore no-explicit-any
async function genieRows(inputs: any): Promise<string[]> {
  const n: number = await inputs.count();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(await inputs.nth(i).inputValue());
  return out;
}

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

Deno.test("REQ-007: the appeal form lists every recording of a multi-recording audit", (t) =>
  story(t, async ({ page, expect }) => {
    const id = "e2e-genies-" + crypto.randomUUID().slice(0, 8);
    await saveFinding(ORG, {
      id,
      findingStatus: "finished",
      answeredQuestions: [
        { header: "Correct Dates", populated: "Dates confirmed?", thinking: "Wrong date read", defense: "", answer: "No" },
        { header: "Correct Location", populated: "Location stated?", thinking: "Stated", defense: "", answer: "Yes" },
      ],
      completedAt: Date.now(),
      record: { RecordId: "900002", VoName: "DS MB - Demo Agent" },
      recordingId: "27694351",
      genieIds: ["27694351", "27694359"],
      recordingIdField: "VoGenie",
      owner: "api",
    });

    await page.goto(`/audit/report?id=${id}`);
    await page.getByRole("button", { name: "File Appeal" }).click();
    await page.locator(".appeal-choice-card.is-reaudit").click();

    const inputs = page.locator(".recording-input");
    await inputs.first().waitFor();
    const values = await genieRows(inputs);
    expect.eq(JSON.stringify(values), JSON.stringify(["27694351", "27694359"]), "both of the audit's genies are filled in");

    await page.getByRole("button", { name: "+ Add Another" }).click();
    await inputs.nth(2).fill("27694459");
    const after = await genieRows(inputs);
    expect.eq(JSON.stringify(after), JSON.stringify(["27694351", "27694359", "27694459"]), "adding a callback appends it after the originals");
  }));
