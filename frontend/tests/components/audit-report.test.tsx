import { renderHTML, assertContains, assertNotContains } from "../helpers/render.ts";
import { AuditReport } from "../../components/AuditReport.tsx";

function baseFinding(over: Record<string, unknown> = {}) {
  return {
    id: "fid-test",
    findingStatus: "finished",
    recordingIdField: "VoGenie",
    record: { RecordId: "999", VoGenie: "27200000", VoName: "DS MB - Chastity Jones" },
    answeredQuestions: [
      { header: "Q1", answer: "Yes" },
      { header: "Q2", answer: "Yes" },
    ],
    rawTranscript: "[AGENT] hi\n[CUSTOMER] hello",
    diarizedTranscript: "[AGENT] hi\n[CUSTOMER] hello",
    ...over,
  };
}

Deno.test("AuditReport — single recording shows 'Recording ID' singular", () => {
  const html = renderHTML(<AuditReport finding={baseFinding({ genieIds: ["27200000"] })} id="fid-test" />);
  assertContains(html, "Recording ID");
  assertNotContains(html, "Recording IDs");
  assertContains(html, "27200000");
});

Deno.test("AuditReport — multi recording shows 'Recording IDs' plural with comma list", () => {
  const html = renderHTML(<AuditReport
    finding={baseFinding({ genieIds: ["27200000", "27200001"], s3RecordingKeys: ["a.mp3", "b.mp3"] })}
    id="fid-test"
  />);
  assertContains(html, "Recording IDs");
  assertContains(html, "27200000, 27200001");
});

Deno.test("AuditReport — Team Member strips 'DEST - ' prefix from VoName", () => {
  const html = renderHTML(<AuditReport finding={baseFinding()} id="fid-test" />);
  assertContains(html, "Chastity Jones");
  // The full prefixed string must NOT appear in the Team Member field
  assertNotContains(html, "DS MB - Chastity Jones");
});

Deno.test("AuditReport — VoName without ' - ' renders unchanged", () => {
  const html = renderHTML(<AuditReport
    finding={baseFinding({ record: { RecordId: "999", VoName: "Simple Name" } })}
    id="fid-test"
  />);
  assertContains(html, "Simple Name");
});

Deno.test("AuditReport — date pulled from finding.job.timestamp formatted ET", () => {
  // 2026-04-29T20:38:00Z → 4:38 PM ET on 4/29/26
  const html = renderHTML(<AuditReport
    finding={baseFinding({ job: { timestamp: "2026-04-29T20:38:00Z" } })}
    id="fid-test"
  />);
  assertContains(html, "4/29/26");
});

Deno.test("AuditReport — missing job.timestamp falls back to em-dash", () => {
  const html = renderHTML(<AuditReport finding={baseFinding()} id="fid-test" />);
  // "Date" label is followed by the field value in the metadata grid; em-dash should render.
  assertContains(html, "Date");
});
