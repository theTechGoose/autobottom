/** AssemblyAI transcription adapter. Ported from providers/assemblyai.ts. */
import { withSpan, metric } from "@core/data/datadog-otel/mod.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const BASE = "https://api.assemblyai.com/v2";

function authHeaders(): Record<string, string> {
  return { authorization: Deno.env.get("ASSEMBLYAI_API_KEY") || "" };
}

export interface LabeledUtterance {
  role: string;
  text: string;
  start: number;
  end: number;
}

export interface TranscriptResult {
  text: string;
  utterances: LabeledUtterance[];
}

export async function uploadAudio(bytes: Uint8Array, timeoutMs = 60_000): Promise<string> {
  return withSpan("assemblyai.uploadAudio", async (span) => {
    span.setAttribute("assemblyai.payload_bytes", bytes.byteLength);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/upload`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/octet-stream" },
        body: bytes as BodyInit,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AssemblyAI upload failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      metric("autobottom.assemblyai.upload", 1);
      return data.upload_url;
    } finally {
      clearTimeout(timer);
    }
  }, {}, "client");
}

export async function transcribe(audioBytes: Uint8Array, maxAttempts = 3, delayMs = 1500, findingId?: string): Promise<string> {
  return withSpan("assemblyai.transcribe", async () => {
    let lastError: unknown;
    const tag = findingId ? `${findingId}: ` : "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const uploadUrl = await uploadAudio(audioBytes);
        const submitRes = await fetch(`${BASE}/transcript`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ audio_url: uploadUrl, language_code: "en_us", punctuate: true, format_text: true, speaker_labels: true }),
        });
        if (!submitRes.ok) throw new Error(`AssemblyAI submit failed: ${submitRes.status}`);
        let transcript = await submitRes.json();
        if (transcript.status === "error") throw new Error(transcript.error || "AssemblyAI transcription error");

        while (transcript.status === "queued" || transcript.status === "processing") {
          await sleep(3000);
          try {
            const pollRes = await fetch(`${BASE}/transcript/${transcript.id}`, { headers: authHeaders() });
            if (!pollRes.ok) continue;
            transcript = await pollRes.json();
          } catch { continue; }
          if (transcript.status === "error") throw new Error(transcript.error || "AssemblyAI error during polling");
        }

        if (transcript.status !== "completed") throw new Error(`Transcription status: ${transcript.status}`);

        if (transcript.utterances?.length > 0) {
          const labeled = identifyRoles(transcript.utterances);
          const text = labeled.map((u) => `${u.role}: ${u.text}`).join("\n");
          if (text.trim().length > 0) {
            console.log(`[ASSEMBLYAI] ${tag}transcription done (attempt ${attempt})`);
            metric("autobottom.assemblyai.transcribe", 1);
            return text;
          }
        }
        metric("autobottom.assemblyai.transcribe", 1);
        return transcript.text || "";
      } catch (err) {
        lastError = err;
        console.error(`[ASSEMBLYAI] ${tag}attempt ${attempt} failed:`, err);
        if (attempt < maxAttempts) await sleep(delayMs);
      }
    }
    throw new Error(`Transcription failed after ${maxAttempts} attempts: ${String(lastError)}`);
  }, {}, "client");
}

export async function transcribeWithUtterances(audioBytes: Uint8Array, maxAttempts = 3, delayMs = 1500, findingId?: string): Promise<TranscriptResult> {
  return withSpan("assemblyai.transcribeWithUtterances", async () => {
    let lastError: unknown;
    const tag = findingId ? `${findingId}: ` : "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const uploadUrl = await uploadAudio(audioBytes);
        const submitRes = await fetch(`${BASE}/transcript`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ audio_url: uploadUrl, language_code: "en_us", punctuate: true, format_text: true, speaker_labels: true }),
        });
        if (!submitRes.ok) throw new Error(`AssemblyAI submit failed: ${submitRes.status}`);
        let transcript = await submitRes.json();
        if (transcript.status === "error") throw new Error(transcript.error || "AssemblyAI transcription error");

        while (transcript.status === "queued" || transcript.status === "processing") {
          await sleep(3000);
          try {
            const pollRes = await fetch(`${BASE}/transcript/${transcript.id}`, { headers: authHeaders() });
            if (!pollRes.ok) continue;
            transcript = await pollRes.json();
          } catch { continue; }
          if (transcript.status === "error") throw new Error(transcript.error || "AssemblyAI error during polling");
        }

        if (transcript.status !== "completed") throw new Error(`Transcription status: ${transcript.status}`);

        const labeled = transcript.utterances?.length > 0 ? identifyRoles(transcript.utterances) : [];
        const text = labeled.length > 0 ? labeled.map((u) => `${u.role}: ${u.text}`).join("\n") : (transcript.text || "");
        console.log(`[ASSEMBLYAI] ${tag}transcription done (attempt ${attempt})`);
        metric("autobottom.assemblyai.transcribe_utterances", 1);
        return { text, utterances: labeled };
      } catch (err) {
        lastError = err;
        console.error(`[ASSEMBLYAI] ${tag}attempt ${attempt} failed:`, err);
        if (attempt < maxAttempts) await sleep(delayMs);
      }
    }
    throw new Error(`Transcription failed after ${maxAttempts} attempts: ${String(lastError)}`);
  }, {}, "client");
}

export async function submitTranscription(uploadUrl: string, findingId?: string): Promise<string> {
  return withSpan("assemblyai.submitTranscription", async () => {
    const tag = findingId ? `${findingId}: ` : "";
    const res = await fetch(`${BASE}/transcript`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: uploadUrl, language_code: "en_us", punctuate: true, format_text: true, speaker_labels: true }),
    });
    if (!res.ok) throw new Error(`AssemblyAI submit failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (data.status === "error") throw new Error(data.error || "AssemblyAI submit error");
    console.log(`[ASSEMBLYAI] ${tag}submitted transcript ${data.id}`);
    metric("autobottom.assemblyai.submit", 1);
    return data.id;
  }, {}, "client");
}

export async function pollTranscriptOnce(transcriptId: string): Promise<any> {
  return withSpan("assemblyai.pollTranscriptOnce", async () => {
    const res = await fetch(`${BASE}/transcript/${transcriptId}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status} ${await res.text()}`);
    metric("autobottom.assemblyai.poll", 1);
    return res.json();
  }, {}, "client");
}

export function processTranscriptResult(transcript: any, snipStart?: number | null, snipEnd?: number | null): TranscriptResult {
  const allLabeled = transcript.utterances?.length > 0 ? identifyRoles(transcript.utterances) : [];
  let utterances = allLabeled;
  if (snipStart != null && utterances.length > 0) {
    utterances = utterances.filter((u) => u.start >= snipStart! && (snipEnd == null || u.end <= snipEnd));
  }
  const text = utterances.length > 0 ? utterances.map((u) => `${u.role}: ${u.text}`).join("\n") : (transcript.text || "");
  return { text, utterances };
}

/** Identify agent (most talkative) vs customer from speaker labels. */
export function identifyRoles(utterances: any[]): LabeledUtterance[] {
  if (!utterances?.length) return [];
  const durations = new Map<string, number>();
  for (const u of utterances) {
    const d = (u.end || 0) - (u.start || 0);
    durations.set(u.speaker, (durations.get(u.speaker) || 0) + d);
  }
  const sorted = [...durations.entries()].sort((a, b) => b[1] - a[1]);
  const agentLabel = sorted[0]?.[0];
  const customerLabel = sorted[1]?.[0];
  return utterances.map((u) => ({
    role: u.speaker === agentLabel ? "[AGENT]" : u.speaker === customerLabel ? "[CUSTOMER]" : "Unknown",
    text: u.text, start: u.start, end: u.end,
  })).sort((a, b) => a.start - b.start);
}
