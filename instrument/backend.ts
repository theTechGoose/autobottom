const kv = await Deno.openKv();
const PORT = parseInt(Deno.env.get("PORT") || "8000");

// --- Types ---

interface Config {
  id: string;
  name: string;
  createdAt: string;
  questionIds: string[];
}

interface Question {
  id: string;
  configId: string;
  name: string;
  fragmentIds: string[];
  testIds: string[];
}

interface Fragment {
  id: string;
  questionId: string;
  text: string;
  operator: "AND" | "OR" | null; // null for the first fragment
  parsedType: string;
  parsedCategory: string;
  versions: { text: string; timestamp: string }[];
  testIds: string[];
}

interface Test {
  id: string;
  parentId: string; // questionId or fragmentId
  parentType: "question" | "fragment";
  snippet: string;
  expected: "yes" | "no";
  lastResult: null | "pass" | "fail";
  lastAnswer: null | string;
  lastRunAt: null | string;
}

// --- Helpers ---

function uid(): string { return crypto.randomUUID().slice(0, 8); }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function cors(): Response {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

// --- KV getters ---

async function get<T>(key: string[]): Promise<T | null> {
  const entry = await kv.get<T>(key);
  return entry.value ?? null;
}

async function getIndex(key: string[]): Promise<string[]> {
  const entry = await kv.get<string[]>(key);
  return entry.value ?? [];
}

// --- LLM (Groq) ---

import Groq from "npm:groq-sdk";

function getGroqClient() {
  return new Groq({ apiKey: Deno.env.get("GROQ_API_KEY") });
}

const LLM_MODEL = "llama-3.3-70b-versatile";

async function llmDisambiguate(text: string, candidates: { type: string; confidence: number }[]): Promise<string> {
  const client = getGroqClient();
  const options = candidates.map(c => c.type).join(", ");
  const res = await client.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: "system", content: `You classify question types. Reply with ONLY one of these types: ${options}. No explanation.` },
      { role: "user", content: `What type of answer does this question expect?\n\n"${text}"\n\nPick one: ${options}` },
    ],
    max_tokens: 20,
  });
  const answer = (res.choices[0]?.message?.content ?? "").trim().toLowerCase();
  // Match to a candidate
  for (const c of candidates) {
    if (answer.includes(c.type)) return c.type;
  }
  return candidates[0].type; // fallback to top candidate
}

// --- Parse Engine ---

interface ParseResult {
  text: string;
  type: "boolean" | "number" | "scope" | "open-ended";
  strategy: "ai" | "instant";
  negated: boolean;
  category: string;
  confidence: number;
  evaluation: string;
}

const CATEGORIES: [RegExp, string][] = [
  [/\b(greet|hello|welcome|introduc|identif|open)\b/i, "Opening"],
  [/\b(hold|wait|transfer|callback|escalat|queue)\b/i, "Process"],
  [/\b(verif|identity|disclos|legal|confirm|account|complian)\b/i, "Compliance"],
  [/\b(clos|goodbye|summary|recap|anything else|thank|wrap)\b/i, "Closing"],
  [/\b(upsell|offer|product|promot|recommend|cross.sell)\b/i, "Sales"],
  [/\b(empathy|apolog|understand|patient|rude|tone|polite|dismiss|courte)\b/i, "Soft Skills"],
  [/\b(address|license|certificate|marriage|spouse|eligib)\b/i, "Verification"],
];

function categorize(text: string): string {
  for (const [re, cat] of CATEGORIES) { if (re.test(text)) return cat; }
  return "General";
}

const AMBIGUITY_THRESHOLD = 0.15; // if gap between top two candidates is less than this, ask LLM

function scoreFragment(text: string): { candidates: { type: ParseResult["type"]; confidence: number }[]; negated: boolean; category: string } {
  const lower = text.toLowerCase();
  const category = categorize(lower);
  const negated = /\b(not|n't|no |never|wasn't|didn't|don't|isn't|without|aren't)\b/i.test(lower);
  const candidates: { type: ParseResult["type"]; confidence: number }[] = [];

  // Scope filter — high confidence, instant
  if (/\b(only (for|when|if)|when department|if department|for .{1,20} department)\b/i.test(lower)) {
    candidates.push({ type: "scope", confidence: 0.97 });
  }

  // Number signals
  let numConf = 0;
  if (/\b(how (old|many|much|long|often|far))\b/i.test(lower)) numConf = 0.80;
  if (/\b(number of|count|total|amount|age|score|rate|percentage)\b/i.test(lower)) numConf = Math.max(numConf, 0.85);
  if (/\b\d+\b/.test(lower) && /\b(more|less|fewer|at least|at most|no more|max|min)\b/i.test(lower)) numConf = Math.max(numConf, 0.88);
  if (numConf > 0) candidates.push({ type: "number", confidence: numConf });

  // Boolean signals
  let boolConf = 0;
  if (/^(did|does|do|is|are|was|were|has|have|can|could|should|will|would)\b/i.test(lower)) boolConf = 0.90;
  if (/\b(confirm|verify|check if|whether)\b/i.test(lower)) boolConf = Math.max(boolConf, 0.88);
  if (boolConf > 0) candidates.push({ type: "boolean", confidence: boolConf });

  // Open-ended signals
  let openConf = 0;
  if (/^(what|why|where|when|who|describe|explain|list|tell|summarize)\b/i.test(lower)) openConf = 0.75;
  if (/^how\b/i.test(lower) && numConf === 0) openConf = Math.max(openConf, 0.70);
  if (openConf > 0) candidates.push({ type: "open-ended", confidence: openConf });

  // Default if nothing matched
  if (candidates.length === 0) candidates.push({ type: "boolean", confidence: 0.50 });

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);
  return { candidates, negated, category };
}

async function parseFragment(text: string): Promise<ParseResult> {
  const trimmed = text.trim();
  const { candidates, negated, category } = scoreFragment(trimmed);

  let finalType = candidates[0].type;
  let confidence = candidates[0].confidence;

  // If ambiguous (top two close), ask LLM to disambiguate
  if (candidates.length >= 2) {
    const gap = candidates[0].confidence - candidates[1].confidence;
    if (gap < AMBIGUITY_THRESHOLD) {
      try {
        finalType = await llmDisambiguate(trimmed, candidates) as ParseResult["type"];
        confidence = 0.95; // LLM-confirmed
      } catch {
        // LLM failed, stick with top candidate
      }
    }
  }

  const strategy = finalType === "scope" ? "instant" as const : "ai" as const;
  return { text: trimmed, type: finalType, strategy, negated, category, confidence, evaluation: trimmed };
}

// --- Mock Evaluator ---

function findRelevantGuestResponse(snippet: string, fragmentText: string): string {
  // Parse transcript into agent-question / guest-response pairs
  const lines = snippet.split("\n").map(l => l.trim()).filter(Boolean);
  const fLower = fragmentText.toLowerCase();
  const keywords = fLower.match(/\b(address|license|certificate|marriage|spouse)\b/g) || [];

  // Walk through lines and find the guest response after the most relevant agent question
  for (let i = 0; i < lines.length; i++) {
    if (/^agent:/i.test(lines[i])) {
      const agentLine = lines[i].toLowerCase();
      const matches = keywords.some(kw => agentLine.includes(kw));
      if (matches && i + 1 < lines.length && /^(guest|caller|customer):/i.test(lines[i + 1])) {
        return lines[i + 1].replace(/^(guest|caller|customer):\s*/i, "").toLowerCase();
      }
    }
  }
  // Fallback: last guest line
  const guestLines = lines.filter(l => /^(guest|caller|customer):/i.test(l))
    .map(l => l.replace(/^(guest|caller|customer):\s*/i, "").toLowerCase());
  return guestLines.length ? guestLines[guestLines.length - 1] : snippet.toLowerCase();
}

function evaluateFragment(fragmentText: string, snippet: string): "yes" | "no" {
  const lower = findRelevantGuestResponse(snippet, fragmentText);
  const qLower = fragmentText.toLowerCase();

  if (qLower.includes("same address") && qLower.includes("license")) {
    const affirm = /\b(yes|yep|yeah|correct|same address|we do|that's right|affirmative|both the same)\b/i.test(lower);
    const deny = /\b(no\b|different address|not the same|don't share)/i.test(lower);
    return affirm && !deny ? "yes" : "no";
  }

  if (qLower.includes("marriage certificate")) {
    const affirm = /\b(yes|absolutely|sure|of course|i have it|i can|bring it)\b/i.test(lower);
    const deny = /\b(no\b|can't find|lost it|don't have|don't think)/i.test(lower);
    return affirm && !deny ? "yes" : "no";
  }

  const affirm = /\b(yes|yeah|yep|correct|absolutely|sure|of course|right|affirmative)\b/i.test(lower);
  return affirm ? "yes" : "no";
}

function evaluateQuestionFragments(fragments: Fragment[], snippet: string): "yes" | "no" {
  if (fragments.length === 0) return "no";
  let result = evaluateFragment(fragments[0].text, snippet) === "yes";
  for (let i = 1; i < fragments.length; i++) {
    const val = evaluateFragment(fragments[i].text, snippet) === "yes";
    if (fragments[i].operator === "OR") result = result || val;
    else result = result && val; // default AND
  }
  return result ? "yes" : "no";
}

// --- Seed ---

const SEED: { configs: Config[]; questions: Question[]; fragments: Fragment[]; tests: Test[] } = {
  configs: [{
    id: "cfg1", name: "Guest Verification", createdAt: new Date().toISOString(), questionIds: ["q1"],
  }],
  questions: [{
    id: "q1", configId: "cfg1", name: "Eligibility Check",
    fragmentIds: ["f1", "f2"], testIds: ["tq1", "tq2", "tq3", "tq4"],
  }],
  fragments: [
    {
      id: "f1", questionId: "q1", operator: null, parsedType: "boolean", parsedCategory: "Verification",
      text: "Does the guest confirm that both they and their spouse share the same address on their driver's licenses? Any affirmative reply counts as \"Yes.\"",
      versions: [], testIds: ["tf1", "tf2"],
    },
    {
      id: "f2", questionId: "q1", operator: "AND", parsedType: "boolean", parsedCategory: "Verification",
      text: "Does the guest confirm that they can bring a marriage certificate? Any affirmative reply counts as \"Yes.\"",
      versions: [], testIds: ["tf3", "tf4"],
    },
  ],
  tests: [
    // Question-level tests (evaluate ALL fragments with AND)
    { id: "tq1", parentId: "q1", parentType: "question", expected: "yes", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Do you and your spouse share the same address on your licenses?\nGuest: Yes we do.\nAgent: Can you bring your marriage certificate?\nGuest: Absolutely, I have it ready." },
    { id: "tq2", parentId: "q1", parentType: "question", expected: "no", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Do you and your spouse share the same address on your licenses?\nGuest: No, different addresses.\nAgent: Can you bring your marriage certificate?\nGuest: Yes I can." },
    { id: "tq3", parentId: "q1", parentType: "question", expected: "no", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Do you and your spouse share the same address?\nGuest: Yes same address.\nAgent: Can you bring your marriage certificate?\nGuest: No I lost it." },
    { id: "tq4", parentId: "q1", parentType: "question", expected: "no", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Do you share the same address?\nGuest: No, different.\nAgent: Can you bring your marriage certificate?\nGuest: No I can't find it." },
    // Fragment-level tests
    { id: "tf1", parentId: "f1", parentType: "fragment", expected: "yes", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Do you and your spouse share the same address on your licenses?\nGuest: Yes we do, same address." },
    { id: "tf2", parentId: "f1", parentType: "fragment", expected: "no", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Do you share the same address?\nGuest: No, we have different addresses." },
    { id: "tf3", parentId: "f2", parentType: "fragment", expected: "yes", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Can you bring your marriage certificate?\nGuest: Absolutely, I have it ready." },
    { id: "tf4", parentId: "f2", parentType: "fragment", expected: "no", lastResult: null, lastAnswer: null, lastRunAt: null,
      snippet: "Agent: Can you bring your marriage certificate?\nGuest: I don't think I can find it." },
  ],
};

async function handleSeed(): Promise<Response> {
  for await (const entry of kv.list({ prefix: [] })) await kv.delete(entry.key);
  await kv.set(["config-index"], SEED.configs.map(c => c.id));
  for (const c of SEED.configs) await kv.set(["configs", c.id], c);
  for (const q of SEED.questions) await kv.set(["questions", q.id], q);
  for (const f of SEED.fragments) await kv.set(["fragments", f.id], f);
  for (const t of SEED.tests) await kv.set(["tests", t.id], t);
  return new Response("Seeded", { status: 200 });
}

// --- Router ---

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return cors();

  // Static — serve index.html for all non-API paths
  if (method === "GET" && !path.startsWith("/api/") && path !== "/seed") {
    const file = await Deno.readTextFile(new URL("./index.html", import.meta.url).pathname);
    return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (path === "/seed") return handleSeed();

  // Parse
  if (path === "/api/parse" && method === "POST") {
    const body = await req.json();
    return json(await parseFragment(body.text || ""));
  }

  // ── Configs ──

  if (path === "/api/configs" && method === "GET") {
    const ids = await getIndex(["config-index"]);
    const configs: Config[] = [];
    for (const id of ids) { const c = await get<Config>(["configs", id]); if (c) configs.push(c); }
    return json(configs);
  }

  if (path === "/api/configs" && method === "POST") {
    const body = await req.json();
    const c: Config = { id: `cfg${uid()}`, name: body.name || "Untitled", createdAt: new Date().toISOString(), questionIds: [] };
    await kv.set(["configs", c.id], c);
    const idx = await getIndex(["config-index"]); idx.push(c.id); await kv.set(["config-index"], idx);
    return json(c, 201);
  }

  const cfgMatch = path.match(/^\/api\/configs\/([a-zA-Z0-9_-]+)$/);

  if (cfgMatch && method === "GET") {
    const c = await get<Config>(["configs", cfgMatch[1]]);
    if (!c) return json({ error: "Not found" }, 404);
    const questions: Question[] = [];
    for (const qid of c.questionIds) { const q = await get<Question>(["questions", qid]); if (q) questions.push(q); }
    return json({ ...c, questions });
  }

  if (cfgMatch && method === "PUT") {
    const c = await get<Config>(["configs", cfgMatch[1]]);
    if (!c) return json({ error: "Not found" }, 404);
    const body = await req.json();
    if (body.name !== undefined) c.name = body.name;
    await kv.set(["configs", c.id], c);
    return json(c);
  }

  if (cfgMatch && method === "DELETE") {
    const c = await get<Config>(["configs", cfgMatch[1]]);
    if (!c) return json({ error: "Not found" }, 404);
    // Cascade: delete questions → fragments → tests
    for (const qid of c.questionIds) {
      const q = await get<Question>(["questions", qid]);
      if (q) {
        for (const fid of q.fragmentIds) {
          const f = await get<Fragment>(["fragments", fid]);
          if (f) { for (const tid of f.testIds) await kv.delete(["tests", tid]); }
          await kv.delete(["fragments", fid]);
        }
        for (const tid of q.testIds) await kv.delete(["tests", tid]);
        await kv.delete(["questions", qid]);
      }
    }
    await kv.delete(["configs", c.id]);
    const idx = await getIndex(["config-index"]); await kv.set(["config-index"], idx.filter(id => id !== c.id));
    return json({ ok: true });
  }

  // ── Questions ──

  const qCreateMatch = path.match(/^\/api\/configs\/([a-zA-Z0-9_-]+)\/questions$/);
  if (qCreateMatch && method === "POST") {
    const c = await get<Config>(["configs", qCreateMatch[1]]);
    if (!c) return json({ error: "Config not found" }, 404);
    const body = await req.json();
    const q: Question = { id: `q${uid()}`, configId: c.id, name: body.name || "Untitled", fragmentIds: [], testIds: [] };
    await kv.set(["questions", q.id], q);
    c.questionIds.push(q.id); await kv.set(["configs", c.id], c);
    return json(q, 201);
  }

  const qMatch = path.match(/^\/api\/questions\/([a-zA-Z0-9_-]+)$/);

  if (qMatch && method === "GET") {
    const q = await get<Question>(["questions", qMatch[1]]);
    if (!q) return json({ error: "Not found" }, 404);
    const fragments: (Fragment & { tests: Test[] })[] = [];
    for (const fid of q.fragmentIds) {
      const f = await get<Fragment>(["fragments", fid]);
      if (f) {
        const ftests: Test[] = [];
        for (const tid of f.testIds) { const t = await get<Test>(["tests", tid]); if (t) ftests.push(t); }
        fragments.push({ ...f, tests: ftests });
      }
    }
    const tests: Test[] = [];
    for (const tid of q.testIds) { const t = await get<Test>(["tests", tid]); if (t) tests.push(t); }
    return json({ ...q, fragments, tests });
  }

  if (qMatch && method === "PUT") {
    const q = await get<Question>(["questions", qMatch[1]]);
    if (!q) return json({ error: "Not found" }, 404);
    const body = await req.json();
    if (body.name !== undefined) q.name = body.name;
    await kv.set(["questions", q.id], q);
    return json(q);
  }

  if (qMatch && method === "DELETE") {
    const q = await get<Question>(["questions", qMatch[1]]);
    if (!q) return json({ error: "Not found" }, 404);
    for (const fid of q.fragmentIds) {
      const f = await get<Fragment>(["fragments", fid]);
      if (f) { for (const tid of f.testIds) await kv.delete(["tests", tid]); }
      await kv.delete(["fragments", fid]);
    }
    for (const tid of q.testIds) await kv.delete(["tests", tid]);
    await kv.delete(["questions", q.id]);
    const c = await get<Config>(["configs", q.configId]);
    if (c) { c.questionIds = c.questionIds.filter(id => id !== q.id); await kv.set(["configs", c.id], c); }
    return json({ ok: true });
  }

  // ── Fragments ──

  const fCreateMatch = path.match(/^\/api\/questions\/([a-zA-Z0-9_-]+)\/fragments$/);
  if (fCreateMatch && method === "POST") {
    const q = await get<Question>(["questions", fCreateMatch[1]]);
    if (!q) return json({ error: "Question not found" }, 404);
    const body = await req.json();
    const text = (body.text || "").trim();

    // Detect compound: split on " and " or " or " between clauses
    const andSplit = text.split(/\b\s+and\s+(?=do |does |did |is |are |was |were |has |have |can |could |should |will |would )/i);
    const orSplit = text.split(/\b\s+or\s+(?=do |does |did |is |are |was |were |has |have |can |could |should |will |would )/i);

    let parts: { text: string; op: "AND" | "OR" | null }[];
    if (andSplit.length > 1) {
      parts = andSplit.map((t, i) => ({ text: t.trim(), op: i === 0 ? null : "AND" as const }));
    } else if (orSplit.length > 1) {
      parts = orSplit.map((t, i) => ({ text: t.trim(), op: i === 0 ? null : "OR" as const }));
    } else {
      parts = [{ text, op: null }];
    }

    const created: Fragment[] = [];
    for (const part of parts) {
      const isFirst = q.fragmentIds.length === 0;
      const parsed = await parseFragment(part.text);
      const f: Fragment = {
        id: `f${uid()}`, questionId: q.id, text: part.text,
        operator: isFirst ? null : (part.op || body.operator || "AND"),
        parsedType: parsed.type, parsedCategory: parsed.category,
        versions: [], testIds: [],
      };
      await kv.set(["fragments", f.id], f);
      q.fragmentIds.push(f.id);
      created.push(f);
    }
    await kv.set(["questions", q.id], q);
    return json(created.length === 1 ? created[0] : created, 201);
  }

  const fMatch = path.match(/^\/api\/fragments\/([a-zA-Z0-9_-]+)$/);

  if (fMatch && method === "GET") {
    const f = await get<Fragment>(["fragments", fMatch[1]]);
    if (!f) return json({ error: "Not found" }, 404);
    const tests: Test[] = [];
    for (const tid of f.testIds) { const t = await get<Test>(["tests", tid]); if (t) tests.push(t); }
    return json({ ...f, tests });
  }

  if (fMatch && method === "PUT") {
    const f = await get<Fragment>(["fragments", fMatch[1]]);
    if (!f) return json({ error: "Not found" }, 404);
    const body = await req.json();
    if (body.text && body.text !== f.text) {
      f.versions.unshift({ text: f.text, timestamp: new Date().toISOString() });
      const parsed = await parseFragment(body.text);
      f.parsedType = parsed.type;
      f.parsedCategory = parsed.category;
    }
    if (body.text !== undefined) f.text = body.text;
    if (body.operator !== undefined) f.operator = body.operator;
    await kv.set(["fragments", f.id], f);
    return json(f);
  }

  if (fMatch && method === "DELETE") {
    const f = await get<Fragment>(["fragments", fMatch[1]]);
    if (!f) return json({ error: "Not found" }, 404);
    for (const tid of f.testIds) await kv.delete(["tests", tid]);
    await kv.delete(["fragments", f.id]);
    const q = await get<Question>(["questions", f.questionId]);
    if (q) { q.fragmentIds = q.fragmentIds.filter(id => id !== f.id); await kv.set(["questions", q.id], q); }
    return json({ ok: true });
  }

  // ── Tests ──

  // Create test on question
  const tqCreateMatch = path.match(/^\/api\/questions\/([a-zA-Z0-9_-]+)\/tests$/);
  if (tqCreateMatch && method === "POST") {
    const q = await get<Question>(["questions", tqCreateMatch[1]]);
    if (!q) return json({ error: "Question not found" }, 404);
    const body = await req.json();
    const t: Test = { id: `t${uid()}`, parentId: q.id, parentType: "question", snippet: body.snippet || "", expected: body.expected === "no" ? "no" : "yes", lastResult: null, lastAnswer: null, lastRunAt: null };
    await kv.set(["tests", t.id], t);
    q.testIds.push(t.id); await kv.set(["questions", q.id], q);
    return json(t, 201);
  }

  // Create test on fragment
  const tfCreateMatch = path.match(/^\/api\/fragments\/([a-zA-Z0-9_-]+)\/tests$/);
  if (tfCreateMatch && method === "POST") {
    const f = await get<Fragment>(["fragments", tfCreateMatch[1]]);
    if (!f) return json({ error: "Fragment not found" }, 404);
    const body = await req.json();
    const t: Test = { id: `t${uid()}`, parentId: f.id, parentType: "fragment", snippet: body.snippet || "", expected: body.expected === "no" ? "no" : "yes", lastResult: null, lastAnswer: null, lastRunAt: null };
    await kv.set(["tests", t.id], t);
    f.testIds.push(t.id); await kv.set(["fragments", f.id], f);
    return json(t, 201);
  }

  const tMatch = path.match(/^\/api\/tests\/([a-zA-Z0-9_-]+)$/);

  if (tMatch && method === "PUT") {
    const t = await get<Test>(["tests", tMatch[1]]);
    if (!t) return json({ error: "Not found" }, 404);
    const body = await req.json();
    if (body.snippet !== undefined) t.snippet = body.snippet;
    if (body.expected !== undefined) t.expected = body.expected;
    t.lastResult = null; t.lastAnswer = null; t.lastRunAt = null;
    await kv.set(["tests", t.id], t);
    return json(t);
  }

  if (tMatch && method === "DELETE") {
    const t = await get<Test>(["tests", tMatch[1]]);
    if (!t) return json({ error: "Not found" }, 404);
    if (t.parentType === "question") {
      const q = await get<Question>(["questions", t.parentId]);
      if (q) { q.testIds = q.testIds.filter(id => id !== t.id); await kv.set(["questions", q.id], q); }
    } else {
      const f = await get<Fragment>(["fragments", t.parentId]);
      if (f) { f.testIds = f.testIds.filter(id => id !== t.id); await kv.set(["fragments", f.id], f); }
    }
    await kv.delete(["tests", t.id]);
    return json({ ok: true });
  }

  // ── Run Tests ──

  // Run question-level tests (evaluates all fragments with AND/OR)
  const runQMatch = path.match(/^\/api\/questions\/([a-zA-Z0-9_-]+)\/run$/);
  if (runQMatch && method === "POST") {
    const q = await get<Question>(["questions", runQMatch[1]]);
    if (!q) return json({ error: "Not found" }, 404);
    const fragments: Fragment[] = [];
    for (const fid of q.fragmentIds) { const f = await get<Fragment>(["fragments", fid]); if (f) fragments.push(f); }
    const tests: Test[] = [];
    for (const tid of q.testIds) { const t = await get<Test>(["tests", tid]); if (t) tests.push(t); }
    const results = [];
    for (const t of tests) {
      const answer = evaluateQuestionFragments(fragments, t.snippet);
      const status = (answer === "yes" && t.expected === "yes") || (answer === "no" && t.expected === "no") ? "pass" : "fail";
      t.lastResult = status; t.lastAnswer = answer; t.lastRunAt = new Date().toISOString();
      await kv.set(["tests", t.id], t);
      results.push({ testId: t.id, expected: t.expected, answer, status });
    }
    return json(results);
  }

  // Run fragment-level tests
  const runFMatch = path.match(/^\/api\/fragments\/([a-zA-Z0-9_-]+)\/run$/);
  if (runFMatch && method === "POST") {
    const f = await get<Fragment>(["fragments", runFMatch[1]]);
    if (!f) return json({ error: "Not found" }, 404);
    const tests: Test[] = [];
    for (const tid of f.testIds) { const t = await get<Test>(["tests", tid]); if (t) tests.push(t); }
    const results = [];
    for (const t of tests) {
      const answer = evaluateFragment(f.text, t.snippet);
      const status = (answer === "yes" && t.expected === "yes") || (answer === "no" && t.expected === "no") ? "pass" : "fail";
      t.lastResult = status; t.lastAnswer = answer; t.lastRunAt = new Date().toISOString();
      await kv.set(["tests", t.id], t);
      results.push({ testId: t.id, expected: t.expected, answer, status });
    }
    return json(results);
  }

  // ── Serve (IQuestionSeed format) ──

  const serveMatch = path.match(/^\/api\/configs\/([a-zA-Z0-9_-]+)\/serve$/);
  if (serveMatch && method === "GET") {
    const c = await get<Config>(["configs", serveMatch[1]]);
    if (!c) return json({ error: "Not found" }, 404);
    const seeds = [];
    for (const qid of c.questionIds) {
      const q = await get<Question>(["questions", qid]);
      if (!q) continue;
      const fragments: Fragment[] = [];
      for (const fid of q.fragmentIds) { const f = await get<Fragment>(["fragments", fid]); if (f) fragments.push(f); }
      // Each fragment becomes an IQuestionSeed
      for (const f of fragments) {
        seeds.push({ header: q.name + ": " + f.text.slice(0, 40), unpopulated: f.text, populated: f.text, autoYesExp: "" });
      }
    }
    return json(seeds);
  }

  return json({ error: "Not found" }, 404);
}

Deno.serve({ port: PORT }, handler);
console.log(`Instrument running on http://localhost:${PORT}`);
