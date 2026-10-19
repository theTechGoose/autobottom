/** The scrub view plays every recording of a multi-recording audit (REQ-014),
 *  and clicking a line plays ITS recording at that line's time (REQ-015).
 *
 *  Pxsca8VF5NlibMlX7xP8Q had two recordings on its report while the scrub page
 *  only ever loaded the first, and none of its lines could be clicked: the two
 *  recordings' times were thrown away because each restarts at 0:00. This story
 *  seeds a two-recording audit — real audio in the S3 stand-in, per-recording
 *  line times on the finding — and drives the page the way a manager does. */
import { story } from "#shots";
import { saveFinding } from "@audit/domain/data/audit-repository/mod.ts";
import { S3Ref } from "@core/data/s3/mod.ts";

const ORG = Deno.env.get("DEFAULT_ORG_ID") as unknown as Parameters<typeof saveFinding>[0];

/** A mono 8 kHz 8-bit WAV of `seconds` of a quiet tone — real, seekable audio. */
function wav(seconds: number, hz: number): Uint8Array {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new Uint8Array(44 + n);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(20 * Math.sin((2 * Math.PI * hz * i) / rate));
  return buf;
}

async function seedTwoRecordingAudit(): Promise<string> {
  const id = "e2e-scrub-recs-" + crypto.randomUUID().slice(0, 8);
  const bucket = Deno.env.get("S3_BUCKET") ?? "";
  const keys = [`recordings/${id}/27708636.wav`, `recordings/${id}/27702370.wav`];
  await new S3Ref(bucket, keys[0]).save(wav(20, 220));
  await new S3Ref(bucket, keys[1]).save(wav(30, 330));
  await saveFinding(ORG, {
    id,
    findingStatus: "finished",
    completedAt: Date.now(),
    record: { RecordId: "900003", VoName: "DS MB - Demo Agent" },
    recordingId: "27708636",
    genieIds: ["27708636", "27702370"],
    s3RecordingKeys: keys,
    recordingIdField: "VoGenie",
    owner: "api",
    rawTranscript: [
      "[AGENT]: Thanks for calling, this is the first call.",
      "[CUSTOMER]: Hi, I wanted to book the trip.",
      "[AGENT]: Calling you back about the booking from earlier.",
      "[CUSTOMER]: Great, the dates are confirmed for June.",
    ].join("\n"),
    recordingLineTimes: [0, 5000, 0, 12000],
    recordingLineIdx: [0, 0, 1, 1],
    answeredQuestions: [
      { header: "Correct Dates", populated: "Dates confirmed?", thinking: "", defense: 'The customer says "the dates are confirmed for June".', answer: "Yes" },
    ],
  });
  return id;
}

/** In-page expression for the audio bar's <audio> (strings: e2e files have no DOM types). */
const AUDIO = `document.querySelector(".queue-audio-bar audio")`;

/** The audio bar's state: which recording it loaded and where the playhead is. */
// deno-lint-ignore no-explicit-any
async function audioState(page: any): Promise<{ src: string; t: number }> {
  return await page.evaluate(`({ src: ${AUDIO}.src, t: ${AUDIO}.currentTime })`);
}

/** Wait until the bar is on recording `idx` with the playhead at or past `secs`. */
// deno-lint-ignore no-explicit-any
async function waitForAudio(page: any, idx: number, secs = 0): Promise<void> {
  await page.waitForFunction(`${AUDIO}.src.includes("idx=${idx}") && ${AUDIO}.currentTime >= ${secs}`);
}

Deno.test("REQ-014: the scrub page plays every recording of a multi-recording audit", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await seedTwoRecordingAudit();
    await page.goto(`/audit/scrub?id=${id}`);

    const rec1 = page.locator(".queue-audio-bar .ap-rec-tab", { hasText: "REC 1" });
    const rec2 = page.locator(".queue-audio-bar .ap-rec-tab", { hasText: "REC 2" });
    await rec2.waitFor();
    expect(await rec1.count() === 1, "a REC 1 tab");
    expect((await audioState(page)).src.includes("idx=0"), "starts on recording 1");

    await rec2.click();
    await waitForAudio(page, 1);
    expect((await audioState(page)).src.includes("idx=1"), "REC 2 loads the second recording");
    expect((await rec2.getAttribute("aria-pressed")) === "true", "REC 2 shows as the active tab");
    expect(await page.getByText("27708636, 27702370").count() === 1, "both recording IDs are listed");
  }));

Deno.test("REQ-015: clicking a line plays its own recording at that line's time", (t) =>
  story(t, async ({ page, expect }) => {
    const id = await seedTwoRecordingAudit();
    await page.goto(`/audit/scrub?id=${id}`);
    await page.locator(".t-rec-divider", { hasText: "Recording 2" }).waitFor();

    // Line 4 is 0:12 on recording 2 — on recording 1's clock it would be wrong.
    const line = page.locator(".t-line", { hasText: "the dates are confirmed for June" });
    expect((await line.locator(".t-timestamp").innerText()).trim() === "0:12", "the line shows its own recording's time");
    await line.click();
    await waitForAudio(page, 1, 11.5);
    const s = await audioState(page);
    expect(s.src.includes("idx=1"), "switched to recording 2");
    expect(s.t >= 11.5 && s.t < 14, `playhead at ~0:12 (got ${s.t})`);

    // Back to a recording-1 line: the bar follows.
    await page.locator(".t-line", { hasText: "I wanted to book the trip" }).click();
    await waitForAudio(page, 0, 4.5);
    const back = await audioState(page);
    expect(back.src.includes("idx=0") && back.t < 7, `back on recording 1 at ~0:05 (got ${back.t})`);

    // The question cites a recording-2 line, so it jumps there too.
    await page.locator(".rem-q-row", { hasText: "Correct Dates" }).click();
    await waitForAudio(page, 1, 11.5);
    expect((await audioState(page)).src.includes("idx=1"), "a question's evidence on recording 2 plays recording 2");
  }));
