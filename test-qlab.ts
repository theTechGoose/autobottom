/**
 * Test script: creates findings with sample transcripts and triggers the
 * prepare->ask->finalize pipeline using Question Lab questions.
 *
 * Usage: LOCAL_QUEUE=true SELF_URL=http://localhost:8000 deno run --allow-all --unstable-kv --env=auto-bot/.env auto-bot/test-qlab.ts
 */

const SELF = Deno.env.get("SELF_URL") ?? "http://localhost:8000";
const RIDS = ["444781", "444801", "444813", "444815", "444819", "444823"];
const QLAB_CONFIG = "dooks";

const SAMPLE_TRANSCRIPT = `[AGENT] Thank you for calling Monster Reservations Group, my name is Sarah. How can I help you today?
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

async function post(path: string, body: unknown) {
  const res = await fetch(`${SELF}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path: string) {
  const res = await fetch(`${SELF}${path}`);
  return { status: res.status, data: await res.json() };
}

// Open KV to seed findings directly
const db = await Deno.openKv();

// Helper to create a chunked KV entry (matching ChunkedKv format)
async function chunkedSet(prefix: Deno.KvKey, value: unknown) {
  const raw = JSON.stringify(value);
  const CHUNK_LIMIT = 55_000;
  if (raw.length <= CHUNK_LIMIT) {
    await db.set([...prefix, 0], raw);
    await db.set([...prefix, "_n"], 1);
    return;
  }
  const n = Math.ceil(raw.length / CHUNK_LIMIT);
  const ops = db.atomic();
  for (let i = 0; i < n; i++) {
    ops.set([...prefix, i], raw.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT));
  }
  ops.set([...prefix, "_n"], n);
  await ops.commit();
}

for (const rid of RIDS) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TESTING RID: ${rid}`);
  console.log("=".repeat(60));

  const findingId = `test-qlab-${rid}`;
  const jobId = `test-job-${rid}`;

  // 1. Seed finding directly into KV
  const finding = {
    id: findingId,
    auditJobId: jobId,
    findingStatus: "transcribing",
    feedback: { heading: "", text: "", viewUrl: "" },
    job: {
      id: jobId,
      doneAuditIds: [],
      status: "running",
      timestamp: new Date().toISOString(),
      owner: "test",
      updateEndpoint: "none",
      recordsToAudit: [rid],
    },
    record: { RecordId: rid },
    recordingIdField: "VoGenie",
    recordingId: rid,
    owner: "test",
    updateEndpoint: "none",
    rawTranscript: SAMPLE_TRANSCRIPT,
    diarizedTranscript: SAMPLE_TRANSCRIPT,
    qlabConfig: QLAB_CONFIG,
  };

  await chunkedSet(["audit-finding", findingId], finding);
  // Also save transcript to dedicated key
  await chunkedSet(["audit-transcript", findingId], {
    raw: SAMPLE_TRANSCRIPT,
    diarized: SAMPLE_TRANSCRIPT,
  });

  console.log(`[1/4] Finding seeded: ${findingId}`);

  // 2. Trigger prepare step directly (skips init/transcribe)
  console.log(`[2/4] Triggering prepare step...`);
  const prepareRes = await post("/audit/step/prepare", { findingId });
  console.log(`  Prepare response: ${prepareRes.status}`, JSON.stringify(prepareRes.data));

  if (prepareRes.status !== 200 || prepareRes.data.error) {
    console.error(`  FAILED at prepare step!`);
    continue;
  }

  // 3. Wait for pipeline to complete (local queue is async via setTimeout)
  const batchCount = prepareRes.data.batches ?? 0;
  console.log(`[3/4] Waiting for ${batchCount} batch(es) to complete...`);

  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max
  let status = "";
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;

    const findingRes = await get(`/audit/finding?id=${findingId}`);
    status = findingRes.data?.findingStatus ?? "unknown";
    console.log(`  Poll ${attempts}: status=${status}`);

    if (status === "finished") break;
  }

  if (status !== "finished") {
    console.error(`  TIMEOUT: status=${status} after ${maxAttempts * 2}s`);
    continue;
  }

  // 4. Validate report
  console.log(`[4/4] Validating report...`);
  const reportRes = await fetch(`${SELF}/audit/report?id=${findingId}`);
  const reportHtml = await reportRes.text();
  const reportStatus = reportRes.status;

  const hasSnippet = reportHtml.includes("snippet-text");
  const hasCopyBtn = reportHtml.includes("copy-btn");
  const hasQuestions = reportHtml.includes("Greeting") && reportHtml.includes("Verification") && reportHtml.includes("Closing");

  console.log(`  Report status: ${reportStatus}`);
  console.log(`  Has questions: ${hasQuestions}`);
  console.log(`  Has snippets: ${hasSnippet}`);
  console.log(`  Has copy buttons: ${hasCopyBtn}`);

  if (reportStatus === 200 && hasQuestions && hasSnippet && hasCopyBtn) {
    console.log(`  PASS`);
  } else {
    console.log(`  FAIL - missing features in report`);
  }
}

console.log(`\nDone.`);
db.close();
