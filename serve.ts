// Minimal dev server: serves static files + /classify endpoint via Anthropic API
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Export it before running.");
  Deno.exit(1);
}

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname === "/classify" && req.method === "POST") {
    const { question, candidates } = await req.json() as {
      question: string;
      candidates: string[];
    };
    const prompt = [
      `Classify this question's expected answer type.`,
      `Question: "${question}"`,
      `Options: ${candidates.join(", ")}`,
      `Rules: boolean=yes/no, string=word/phrase/name, number=numeric value.`,
      `Reply with exactly one word from the options.`,
    ].join("\n");

    console.log(`[classify] q="${question}" candidates=[${candidates}]`);
    const t0 = performance.now();

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const body = await resp.json();
    const raw = (body.content?.[0]?.text || "").trim().toLowerCase();
    const resolved = candidates.find((c) => raw.includes(c)) || candidates[0];
    console.log(`[classify] → ${resolved} (${Math.round(performance.now() - t0)}ms) raw="${raw}"`);

    return new Response(JSON.stringify({ type: resolved }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Static files
  const filePath = url.pathname === "/" ? "/expr-builder-demo.html" : url.pathname;
  try {
    const file = await Deno.readFile("." + filePath);
    const ext = filePath.split(".").pop() || "";
    const types: Record<string, string> = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
      png: "image/png",
      ico: "image/x-icon",
    };
    return new Response(file, {
      headers: { "Content-Type": types[ext] || "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

Deno.serve({ port: 8787 }, handler);
