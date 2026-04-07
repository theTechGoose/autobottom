/** AssemblyAI transcription provider - uses raw fetch (no SDK). */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const BASE = "https://api.assemblyai.com/v2";

function authHeaders(): Record<string, string> {
  return { authorization: Deno.env.get("ASSEMBLYAI_API_KEY") || "" };
}

/** Upload raw audio bytes to AssemblyAI. Returns the upload URL. */
async function uploadAudio(bytes: Uint8Array): Promise<string> {
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`AssemblyAI upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.upload_url;
}

/** Transcribe raw audio bytes. Returns speaker-labeled transcript text. */
export async function transcribe(audioBytes: Uint8Array, maxAttempts = 3, delayMs = 1500): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Upload bytes to AssemblyAI
      const uploadUrl = await uploadAudio(audioBytes);

      // Submit transcription job
      const submitRes = await fetch(`${BASE}/transcript`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_url: uploadUrl,
          language_code: "en_us",
          punctuate: true,
          format_text: true,
          speaker_labels: true,
        }),
      });
      if (!submitRes.ok) throw new Error(`AssemblyAI submit failed: ${submitRes.status}`);
      let transcript = await submitRes.json();

      if (transcript.status === "error") {
        throw new Error(transcript.error || "AssemblyAI transcription error");
      }

      // Poll until done
      while (transcript.status === "queued" || transcript.status === "processing") {
        await sleep(3000);
        try {
          const pollRes = await fetch(`${BASE}/transcript/${transcript.id}`, {
            headers: authHeaders(),
          });
          if (!pollRes.ok) { console.warn("[ASSEMBLYAI] poll retry"); continue; }
          transcript = await pollRes.json();
        } catch (err) {
          console.warn("[ASSEMBLYAI] polling retry:", err);
          continue;
        }
        if (transcript.status === "error") {
          throw new Error(transcript.error || "AssemblyAI error during polling");
        }
      }

      if (transcript.status !== "completed") {
        throw new Error(`Transcription status: ${transcript.status}`);
      }

      // Build speaker-labeled text
      if (transcript.utterances && transcript.utterances.length > 0) {
        const labeled = identifyRoles(transcript.utterances);
        const text = labeled.map((u: LabeledUtterance) => `${u.role}: ${u.text}`).join("\n");
        if (text.trim().length > 0) {
          console.log(`[ASSEMBLYAI] transcription success on attempt ${attempt}`);
          return text;
        }
      }

      return transcript.text || "";
    } catch (err) {
      lastError = err;
      console.error(`[ASSEMBLYAI] attempt ${attempt} failed:`, err);
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }

  throw new Error(`Transcription failed after ${maxAttempts} attempts: ${String(lastError)}`);
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

/** Transcribe raw audio bytes. Returns structured result with text and utterances. */
export async function transcribeWithUtterances(audioBytes: Uint8Array, maxAttempts = 3, delayMs = 1500): Promise<TranscriptResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const uploadUrl = await uploadAudio(audioBytes);

      const submitRes = await fetch(`${BASE}/transcript`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_url: uploadUrl,
          language_code: "en_us",
          punctuate: true,
          format_text: true,
          speaker_labels: true,
        }),
      });
      if (!submitRes.ok) throw new Error(`AssemblyAI submit failed: ${submitRes.status}`);
      let transcript = await submitRes.json();

      if (transcript.status === "error") {
        throw new Error(transcript.error || "AssemblyAI transcription error");
      }

      while (transcript.status === "queued" || transcript.status === "processing") {
        await sleep(3000);
        try {
          const pollRes = await fetch(`${BASE}/transcript/${transcript.id}`, {
            headers: authHeaders(),
          });
          if (!pollRes.ok) { console.warn("[ASSEMBLYAI] poll retry"); continue; }
          transcript = await pollRes.json();
        } catch (err) {
          console.warn("[ASSEMBLYAI] polling retry:", err);
          continue;
        }
        if (transcript.status === "error") {
          throw new Error(transcript.error || "AssemblyAI error during polling");
        }
      }

      if (transcript.status !== "completed") {
        throw new Error(`Transcription status: ${transcript.status}`);
      }

      const labeled = transcript.utterances?.length > 0
        ? identifyRoles(transcript.utterances)
        : [];
      const text = labeled.length > 0
        ? labeled.map((u: LabeledUtterance) => `${u.role}: ${u.text}`).join("\n")
        : (transcript.text || "");

      console.log(`[ASSEMBLYAI] transcription (with utterances) success on attempt ${attempt}`);
      return { text, utterances: labeled };
    } catch (err) {
      lastError = err;
      console.error(`[ASSEMBLYAI] attempt ${attempt} failed:`, err);
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }

  throw new Error(`Transcription failed after ${maxAttempts} attempts: ${String(lastError)}`);
}

export function identifyRoles(utterances: any[]): LabeledUtterance[] {
  if (!utterances || utterances.length === 0) return [];

  // Identify agent as the speaker who talks the most
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
    text: u.text,
    start: u.start,
    end: u.end,
  })).sort((a, b) => a.start - b.start);
}
