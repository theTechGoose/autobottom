/** Postmark stand-in: accepts sends, writes them to disk, serves a mailbox.
 *
 *  Every local email lands as an .html file under
 *  fixtures/json/emulator/mail/ and is listed at http://127.0.0.1:9006/ — so
 *  you can read the audit-result email, the weekly report, the remediation
 *  receipt, exactly as rendered, without a single real message going out.
 *
 *  Returns the response shape the client parses (MessageID / ErrorCode). */

import { EMULATOR_PORTS } from "@core/config/endpoints.ts";

const ROOT = new URL("../../fixtures/json/emulator/mail/", import.meta.url).pathname;

interface Sent {
  file: string;
  to: string;
  subject: string;
  at: string;
}

const sent: Sent[] = [];

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/email" && req.method === "POST") {
    const msg = await req.json().catch(() => ({})) as {
      To?: string; Subject?: string; HtmlBody?: string; From?: string;
      Cc?: string; Bcc?: string; Attachments?: Array<{ Name: string }>;
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `${stamp}--${slug(msg.Subject ?? "no-subject")}.html`;
    await Deno.mkdir(ROOT, { recursive: true });
    const header = `<!-- To: ${msg.To ?? ""}\n     Cc: ${msg.Cc ?? ""}\n     Bcc: ${msg.Bcc ?? ""}\n     From: ${msg.From ?? ""}\n     Subject: ${msg.Subject ?? ""}\n     Attachments: ${(msg.Attachments ?? []).map((a) => a.Name).join(", ")} -->\n`;
    await Deno.writeTextFile(`${ROOT}${file}`, header + (msg.HtmlBody ?? ""));
    sent.unshift({ file, to: msg.To ?? "", subject: msg.Subject ?? "", at: new Date().toISOString() });
    console.log(`[POSTMARK-EMU] ${msg.To} — ${msg.Subject}  → fixtures/json/emulator/mail/${file}`);
    return Response.json({
      To: msg.To,
      SubmittedAt: new Date().toISOString(),
      MessageID: crypto.randomUUID(),
      ErrorCode: 0,
      Message: "OK",
    });
  }

  // Mailbox: index and raw message bodies.
  if (url.pathname === "/" ) {
    const rows = sent.map((s) =>
      `<tr><td>${s.at.slice(11, 19)}</td><td>${s.to}</td><td><a href="/mail/${encodeURIComponent(s.file)}">${s.subject}</a></td></tr>`
    ).join("");
    return new Response(
      `<html><body style="font:14px system-ui;padding:24px"><h1>Local mailbox</h1><p>${sent.length} message(s) this session</p><table cellpadding="6">${rows}</table></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  }

  const mail = /^\/mail\/(.+)$/.exec(url.pathname);
  if (mail) {
    try {
      return new Response(await Deno.readTextFile(`${ROOT}${decodeURIComponent(mail[1])}`), {
        headers: { "content-type": "text/html" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  return Response.json({ ErrorCode: 404, Message: `unhandled ${req.method} ${url.pathname}` }, { status: 404 });
}

export function startPostmark(): Deno.HttpServer {
  return Deno.serve({ port: EMULATOR_PORTS.postmark, onListen: () => {} }, handle);
}
