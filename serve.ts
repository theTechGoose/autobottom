// Minimal dev server: serves static files + /classify endpoint via Anthropic API
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Export it before running.");
  Deno.exit(1);
}

async function callHaiku(prompt: string, maxTokens: number): Promise<{ text: string; ms: number }> {
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
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await resp.json();
  const text = (body.content?.[0]?.text || "").trim();
  return { text, ms: Math.round(performance.now() - t0) };
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
    const { text: raw, ms } = await callHaiku(prompt, 4);
    const resolved = candidates.find((c) => raw.toLowerCase().includes(c)) || candidates[0];
    console.log(`[classify] → ${resolved} (${ms}ms) raw="${raw}"`);

    return new Response(JSON.stringify({ type: resolved }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname === "/compile" && req.method === "POST") {
    const { text } = await req.json() as { text: string };
    console.log(`[compile] text="${text}"`);
    const timing: Record<string, number> = {};

    // Step 1: Intent
    const intentResult = await callHaiku(
      `What does this condition check for in a customer service call?\nCondition: "${text}"\nReply in one brief sentence.`,
      100,
    );
    timing.intent = intentResult.ms;
    const intent = intentResult.text;
    console.log(`[compile] intent="${intent}" (${intentResult.ms}ms)`);

    // Step 2: Strategy
    const strategyResult = await callHaiku(
      [
        `Given this condition about a call: "${text}"`,
        `Intent: ${intent}`,
        `Pick the cheapest evaluation strategy:`,
        `- keyword_any: true if ANY keyword appears in transcript (e.g. greetings, product names)`,
        `- keyword_all: true if ALL keywords appear in transcript`,
        `- regex: true if a regex pattern matches in transcript`,
        `- llm_eval: needs LLM reasoning (sentiment, judgment, complex logic)`,
        `Reply with exactly one of: keyword_any, keyword_all, regex, llm_eval`,
      ].join("\n"),
      10,
    );
    timing.strategy = strategyResult.ms;
    const strategy = strategyResult.text.toLowerCase().replace(/[^a-z_]/g, "");
    const validStrategies = ["keyword_any", "keyword_all", "regex", "llm_eval"];
    const resolvedStrategy = validStrategies.includes(strategy) ? strategy : "llm_eval";
    console.log(`[compile] strategy="${resolvedStrategy}" (${strategyResult.ms}ms) raw="${strategyResult.text}"`);

    // Step 3: Compile params
    let compilePrompt: string;
    if (resolvedStrategy === "keyword_any" || resolvedStrategy === "keyword_all") {
      compilePrompt = [
        `Condition: "${text}"`,
        `Strategy: ${resolvedStrategy}`,
        `Generate the keyword list to search for in a call transcript.`,
        `Reply with ONLY a JSON object: {"keywords": ["word1", "word2", ...]}`,
      ].join("\n");
    } else if (resolvedStrategy === "regex") {
      compilePrompt = [
        `Condition: "${text}"`,
        `Generate a regex pattern to match in a call transcript.`,
        `Reply with ONLY a JSON object: {"pattern": "your_regex_here"}`,
      ].join("\n");
    } else {
      compilePrompt = [
        `Condition: "${text}"`,
        `This needs LLM evaluation at runtime. Write a concise prompt that an LLM will use to evaluate this condition against a call transcript.`,
        `Reply with ONLY a JSON object: {"prompt": "your_prompt_here"}`,
      ].join("\n");
    }
    const compileResult = await callHaiku(compilePrompt, 200);
    timing.compile = compileResult.ms;
    console.log(`[compile] params raw="${compileResult.text}" (${compileResult.ms}ms)`);

    let params: Record<string, unknown>;
    try {
      const jsonMatch = compileResult.text.match(/\{[\s\S]*\}/);
      params = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      params = resolvedStrategy === "llm_eval"
        ? { prompt: compileResult.text }
        : { keywords: [text] };
    }

    const totalMs = timing.intent + timing.strategy + timing.compile;
    console.log(`[compile] done (${totalMs}ms total)`);

    return new Response(
      JSON.stringify({ intent, strategy: resolvedStrategy, params, timing }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Static files
  const filePath = url.pathname === "/" ? "/expression-builder.html" : url.pathname;
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
