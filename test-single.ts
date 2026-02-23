/** Quick single-RID test to validate report rendering after fixes. */
const SELF = Deno.env.get("SELF_URL") ?? "http://localhost:8000";
const findingId = "test-report-fix";
const db = await Deno.openKv();

const TRANSCRIPT = `[AGENT] Thank you for calling Monster Reservations Group, my name is Sarah. How can I help you today?
[CUSTOMER] Hi Sarah, I'm calling about a reservation I made last week. My name is John Smith.
[AGENT] Hi John! Let me pull up your account. Can you verify the email address on file?
[CUSTOMER] Sure, it's john.smith@email.com.
[AGENT] Great, I found your reservation. It looks like you have a stay booked at the Grand Resort for March 15th through March 18th. Is that the one you're calling about?
[CUSTOMER] Yes that's the one. I was wondering if I could change the dates to a week later.
[AGENT] Absolutely, let me check availability for March 22nd through March 25th. One moment please.
[CUSTOMER] Sure, take your time.
[AGENT] Great news John, those dates are available at the same rate. I've updated your reservation. You'll receive a confirmation email shortly.
[CUSTOMER] Perfect, thank you so much.
[AGENT] You're welcome John! Is there anything else I can help you with today?
[CUSTOMER] No that's all, thanks.
[AGENT] Alright, thank you for calling Monster Reservations Group and have a wonderful day!
[CUSTOMER] You too, bye.`;

const CHUNK_LIMIT = 55_000;
async function chunkedSet(prefix: Deno.KvKey, value: unknown) {
  const raw = JSON.stringify(value);
  if (raw.length <= CHUNK_LIMIT) {
    await db.set([...prefix, 0], raw);
    await db.set([...prefix, "_n"], 1);
    return;
  }
  const n = Math.ceil(raw.length / CHUNK_LIMIT);
  const ops = db.atomic();
  for (let i = 0; i < n; i++) ops.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT));
  ops.set([...prefix, "_n"], n);
  await ops.commit();
}

const finding = {
  id: findingId,
  auditJobId: "test-job-fix",
  findingStatus: "transcribing",
  feedback: { heading: "", text: "", viewUrl: "" },
  job: { id: "test-job-fix", doneAuditIds: [], status: "running", timestamp: new Date().toISOString(), owner: "test", updateEndpoint: "none", recordsToAudit: ["444781"] },
  record: { RecordId: "444781" },
  recordingIdField: "VoGenie",
  recordingId: "444781",
  owner: "test",
  updateEndpoint: "none",
  rawTranscript: TRANSCRIPT,
  diarizedTranscript: TRANSCRIPT,
  qlabConfig: "dooks",
};

await chunkedSet(["audit-finding", findingId], finding);
await chunkedSet(["audit-transcript", findingId], { raw: TRANSCRIPT, diarized: TRANSCRIPT });
console.log("Seeded finding, triggering prepare...");

const res = await fetch(`${SELF}/audit/step/prepare`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ findingId }),
});
console.log("Prepare:", res.status, await res.json());

let status = "";
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const r = await fetch(`${SELF}/audit/finding?id=${findingId}`);
  const d = await r.json();
  status = d.findingStatus;
  console.log(`Poll ${i + 1}: ${status}`);
  if (status === "finished") break;
}

if (status === "finished") {
  // Validate report
  const reportRes = await fetch(`${SELF}/audit/report?id=${findingId}`);
  const html = await reportRes.text();

  // Check answers are normalized
  const hasObjectObject = html.includes("[object Object]");
  const hasTrueRaw = html.includes('>true<');
  const hasYesNo = html.includes("answer-yes\">Yes") || html.includes("answer-no\">No");

  // Check snippet formatting
  const hasNewlineSnippet = html.includes("[AGENT]") && html.includes("\n[CUSTOMER]");

  // Check score
  const scoreMatch = html.match(/(\d+)%/);
  const score = scoreMatch ? scoreMatch[1] : "?";

  console.log("\n=== REPORT VALIDATION ===");
  console.log(`Score: ${score}%`);
  console.log(`Has [object Object]: ${hasObjectObject} (should be false)`);
  console.log(`Has raw 'true': ${hasTrueRaw} (should be false)`);
  console.log(`Has clean Yes/No: ${hasYesNo} (should be true)`);
  console.log(`Snippet has line breaks: ${hasNewlineSnippet} (should be true)`);

  if (!hasObjectObject && !hasTrueRaw && hasYesNo && hasNewlineSnippet) {
    console.log("PASS - Report looks clean");
  } else {
    console.log("FAIL - Issues remain");
  }

  // Save for visual inspection
  await Deno.writeTextFile("/tmp/report-fixed.html", html);
  console.log("Saved to /tmp/report-fixed.html");
}

db.close();
