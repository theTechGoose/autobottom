/** Postmark email sender. Ported from providers/postmark.ts. */

export interface EmailAttachment {
  name: string;
  content: string; // base64-encoded
  contentType: string;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  htmlBody: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
}): Promise<void> {
  const token = Deno.env.get("POSTMARK_SERVER");
  if (!token) throw new Error("POSTMARK_SERVER required");

  const to = Array.isArray(opts.to) ? opts.to.join(",") : opts.to;
  const cc = opts.cc ? (Array.isArray(opts.cc) ? opts.cc.join(",") : opts.cc) : undefined;
  const bcc = opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc.join(",") : opts.bcc) : undefined;

  const payload: Record<string, unknown> = {
    From: opts.from ?? (Deno.env.get("FROM_EMAIL") || "noreply@example.com"),
    To: to,
    Subject: opts.subject,
    HtmlBody: opts.htmlBody,
  };
  if (cc) payload.Cc = cc;
  if (bcc) payload.Bcc = bcc;
  if (opts.attachments?.length) {
    payload.Attachments = opts.attachments.map((a) => ({
      Name: a.name,
      Content: a.content,
      ContentType: a.contentType,
    }));
  }

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": token },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Postmark failed: ${res.status} ${await res.text()}`);
}
