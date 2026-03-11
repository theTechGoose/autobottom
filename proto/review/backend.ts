// Minimal backend for demoer -- static HTML mock, no API needed
const PORT = parseInt(Deno.env.get("PORT") || "8788");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve({ port: PORT }, async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (url.pathname === "/seed") return json({ ok: true });

  // Serve static files
  const filePath = url.pathname === "/" ? "/mock.html" : url.pathname;
  try {
    const file = await Deno.readFile("." + filePath);
    const ext = filePath.split(".").pop() || "";
    const mime: Record<string, string> = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png" };
    return new Response(file, { headers: { "Content-Type": mime[ext] || "application/octet-stream" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});

console.log(`Review mock server on http://localhost:${PORT}`);
