/** Postmark email sender. */

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  htmlBody: string;
  from?: string;
}) {
  const token = Deno.env.get("POSTMARK_SERVER");
  if (!token) throw new Error("POSTMARK_SERVER required");

  const to = Array.isArray(opts.to) ? opts.to.join(",") : opts.to;

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: opts.from ?? "notifications@monsterrg.com",
      To: to,
      Subject: opts.subject,
      HtmlBody: opts.htmlBody,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark failed: ${res.status} ${text}`);
  }
}
