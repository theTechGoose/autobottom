const kv = await Deno.openKv();
const PORT = parseInt(Deno.env.get("PORT") || "8000");

// --- Types ---

interface Field {
  name: string;
  type: "string" | "number" | "boolean";
}

interface Expression {
  field: string;
  operator: string;
  value: string;
}

interface Condition {
  id: string;
  text: string;
  type: "boolean" | "number" | "expression" | "scope" | "compound";
  negated: boolean;
  strategy: "instant" | "ai";
  category: string;
  confidence: number;
  evaluation: string;
  expression?: Expression;
  groupId?: string;
  versions: { text: string; ts: number }[];
}

interface Group {
  id: string;
  label: string;
  operator: "OR" | "AND";
}

interface TestCase {
  id: string;
  name: string;
  transcript: string;
  expected: "pass" | "fail";
  lastResult?: "pass" | "fail";
  fragmentResults?: { text: string; result: "pass" | "fail" }[];
}

interface Question {
  id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  version: string;
  fields: Field[];
  conditions: Condition[];
  groups: Group[];
  testCases: TestCase[];
}

// --- Seed Data ---

const SEED: Question[] = [
  {
    id: "q1",
    name: "Call Opening Compliance",
    description: "Evaluates whether the agent properly opened the call per company standards.",
    status: "active",
    version: "v3",
    fields: [
      { name: "holdCount", type: "number" },
      { name: "department", type: "string" },
      { name: "callDuration", type: "number" },
    ],
    groups: [
      { id: "g1", label: "Hold Management", operator: "OR" },
    ],
    conditions: [
      {
        id: "c1",
        text: "Agent used proper greeting and identified themselves",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Opening",
        confidence: 0.95,
        evaluation: "Did the agent greet the caller with a proper greeting and state their name?",
        versions: [
          { text: "Agent said hello", ts: Date.now() - 86400000 * 5 },
          { text: "Agent greeted the caller", ts: Date.now() - 86400000 * 2 },
          { text: "Agent used proper greeting and identified themselves", ts: Date.now() - 3600000 },
        ],
      },
      {
        id: "c2",
        text: "Number of holds no more than 2",
        type: "expression",
        negated: false,
        strategy: "instant",
        category: "Process",
        confidence: 0.99,
        evaluation: "holdCount <= 2",
        expression: { field: "holdCount", operator: "<=", value: "2" },
        versions: [
          { text: "Number of holds no more than 2", ts: Date.now() - 86400000 },
        ],
      },
      {
        id: "c3",
        text: "Agent verified caller's identity",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Compliance",
        confidence: 0.92,
        evaluation: "Did the agent verify the caller's identity by asking for account info or personal details?",
        versions: [
          { text: "Agent verified caller's identity", ts: Date.now() - 86400000 * 3 },
        ],
      },
      {
        id: "c4",
        text: "Agent offered callback when hold exceeded 2 minutes",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Process",
        confidence: 0.88,
        evaluation: "Did the agent offer a callback option when the hold time was long?",
        groupId: "g1",
        versions: [
          { text: "Agent offered callback when hold exceeded 2 minutes", ts: Date.now() - 86400000 },
        ],
      },
      {
        id: "c5",
        text: "Agent provided estimated wait time before holding",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Process",
        confidence: 0.90,
        evaluation: "Did the agent tell the caller how long the hold would be?",
        groupId: "g1",
        versions: [
          { text: "Agent provided estimated wait time before holding", ts: Date.now() - 86400000 },
        ],
      },
      {
        id: "c6",
        text: "Agent wasn't rude or dismissive",
        type: "boolean",
        negated: true,
        strategy: "ai",
        category: "Soft Skills",
        confidence: 0.93,
        evaluation: "Was the agent rude or dismissive at any point during the call?",
        versions: [
          { text: "Agent was polite", ts: Date.now() - 86400000 * 4 },
          { text: "Agent wasn't rude or dismissive", ts: Date.now() - 86400000 },
        ],
      },
      {
        id: "c7",
        text: "Only for sales department",
        type: "scope",
        negated: false,
        strategy: "instant",
        category: "Scope",
        confidence: 1.0,
        evaluation: "department == \"sales\"",
        expression: { field: "department", operator: "==", value: "sales" },
        versions: [
          { text: "Only for sales department", ts: Date.now() - 86400000 * 2 },
        ],
      },
    ],
    testCases: [
      {
        id: "t1",
        name: "Good greeting",
        transcript: "Agent: Hi, thanks for calling Acme Corp! My name is Sarah. How can I help you today?\nCaller: Hi Sarah, I need help with my account.\nAgent: Of course! Can I get your account number to pull up your information?\nCaller: Sure, it's 4829103.\nAgent: Great, I've got your account here. What seems to be the issue?",
        expected: "pass",
        lastResult: "pass",
      },
      {
        id: "t2",
        name: "Bad greeting",
        transcript: "Agent: Yeah what do you want?\nCaller: Um, I need help with billing.\nAgent: Account number.\nCaller: 5839201.\nAgent: What's the problem.",
        expected: "fail",
        lastResult: "fail",
      },
      {
        id: "t3",
        name: "Good with verification",
        transcript: "Agent: Welcome to Acme Corp, this is James speaking. Before I can assist you, I'll need to verify your identity. Can you confirm your full name and the last four digits of your SSN?\nCaller: John Smith, 4829.\nAgent: Thank you John, you're verified. How can I help?",
        expected: "pass",
        lastResult: "pass",
      },
      {
        id: "t4",
        name: "Too many holds",
        transcript: "Agent: Hi there, thanks for calling. Let me put you on hold real quick.\n[Hold - 3 minutes]\nAgent: Ok I'm back. Actually hold on again, I need to check something.\n[Hold - 2 minutes]\nAgent: Sorry about that. One more moment please.\n[Hold - 4 minutes]\nAgent: Alright, thanks for waiting.",
        expected: "fail",
        lastResult: "fail",
      },
      {
        id: "t5",
        name: "Rude agent",
        transcript: "Agent: Acme Corp, what is it?\nCaller: I'd like to dispute a charge on my account.\nAgent: Look, I don't have all day. Give me your account number.\nCaller: It's 9382017.\nAgent: Fine. Which charge? And make it quick.",
        expected: "fail",
        lastResult: "fail",
      },
    ],
  },
  {
    id: "q2",
    name: "Closing Quality",
    description: "Checks whether the agent properly wrapped up the call.",
    status: "draft",
    version: "v1",
    fields: [],
    groups: [],
    conditions: [
      {
        id: "c8",
        text: "Agent provided a clear summary of the resolution",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Closing",
        confidence: 0.91,
        evaluation: "Did the agent summarize what was discussed and resolved before ending the call?",
        versions: [
          { text: "Agent provided a clear summary of the resolution", ts: Date.now() - 3600000 },
        ],
      },
      {
        id: "c9",
        text: "Agent asked if there was anything else",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Closing",
        confidence: 0.94,
        evaluation: "Did the agent ask whether the caller needed help with anything else?",
        versions: [
          { text: "Agent asked if there was anything else", ts: Date.now() - 3600000 },
        ],
      },
      {
        id: "c10",
        text: "Agent thanked the caller",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Closing",
        confidence: 0.96,
        evaluation: "Did the agent thank the caller before ending the call?",
        versions: [
          { text: "Agent thanked the caller", ts: Date.now() - 3600000 },
        ],
      },
    ],
    testCases: [
      {
        id: "t6",
        name: "Proper close",
        transcript: "Agent: So to recap, I've waived the late fee on your account and set up auto-pay starting next month. Is there anything else I can help you with today?\nCaller: No, that's everything.\nAgent: Great! Thank you for calling Acme Corp, have a wonderful day!",
        expected: "pass",
        lastResult: "pass",
      },
    ],
  },
  {
    id: "q3",
    name: "Upsell Compliance",
    description: "Ensures upsell attempts follow regulatory guidelines.",
    status: "archived",
    version: "v2",
    fields: [{ name: "productOffered", type: "string" }],
    groups: [],
    conditions: [
      {
        id: "c11",
        text: "Agent disclosed that the offer is optional",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Compliance",
        confidence: 0.89,
        evaluation: "Did the agent clearly state the offer is optional?",
        versions: [
          { text: "Agent disclosed that the offer is optional", ts: Date.now() - 86400000 * 10 },
        ],
      },
    ],
    testCases: [],
  },
  {
    id: "q4",
    name: "Guest Verification",
    description: "Verifies guest eligibility by confirming address match and marriage certificate.",
    status: "active",
    version: "v1",
    fields: [],
    groups: [],
    conditions: [
      {
        id: "c20",
        text: "Does the guest confirm that both they and their spouse share the same address on their driver's licenses? Any affirmative reply counts as Yes.",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Verification",
        confidence: 0.92,
        evaluation: "Did the guest confirm same address on licenses?",
        versions: [
          { text: "Does the guest confirm that both they and their spouse share the same address on their driver's licenses? Any affirmative reply counts as Yes.", ts: Date.now() - 86400000 },
        ],
      },
      {
        id: "c21",
        text: "Does the guest confirm that they can bring a marriage certificate? Any affirmative reply counts as Yes.",
        type: "boolean",
        negated: false,
        strategy: "ai",
        category: "Verification",
        confidence: 0.90,
        evaluation: "Did the guest confirm they can bring a marriage certificate?",
        versions: [
          { text: "Does the guest confirm that they can bring a marriage certificate? Any affirmative reply counts as Yes.", ts: Date.now() - 86400000 },
        ],
      },
    ],
    testCases: [
      {
        id: "t10",
        name: "Both confirmed",
        transcript: "Agent: Do you and your spouse share the same address on your driver's licenses?\nGuest: Yes we do, same address.\nAgent: Great. And can you bring your marriage certificate?\nGuest: Absolutely, I have it ready.",
        expected: "pass",
        lastResult: null,
      },
      {
        id: "t11",
        name: "Address denied",
        transcript: "Agent: Do you and your spouse share the same address on your driver's licenses?\nGuest: No, we have different addresses actually.\nAgent: Can you bring your marriage certificate?\nGuest: Yes I can bring it.",
        expected: "fail",
        lastResult: null,
      },
      {
        id: "t12",
        name: "No certificate",
        transcript: "Agent: Do you and your spouse share the same address on your driver's licenses?\nGuest: Yes, same address on both.\nAgent: Can you bring your marriage certificate?\nGuest: I don't think I can find it, no.",
        expected: "fail",
        lastResult: null,
      },
      {
        id: "t13",
        name: "Both denied",
        transcript: "Agent: Do you and your spouse share the same address on your driver's licenses?\nGuest: No, different addresses.\nAgent: Can you bring your marriage certificate?\nGuest: No I lost it.",
        expected: "fail",
        lastResult: null,
      },
    ],
  },
];

// --- Helpers ---

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
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

// --- Parse Engine ---

const CATEGORIES: [RegExp, string][] = [
  [/\b(greet|hello|welcome|introduc|identif|open)\b/i, "Opening"],
  [/\b(hold|wait|transfer|callback|escalat|queue)\b/i, "Process"],
  [/\b(verif|identity|disclos|legal|confirm|account|complian)\b/i, "Compliance"],
  [/\b(clos|goodbye|summary|recap|anything else|thank|wrap)\b/i, "Closing"],
  [/\b(upsell|offer|product|promot|recommend|cross.sell)\b/i, "Sales"],
  [/\b(empathy|apolog|understand|patient|rude|tone|polite|dismiss|courte)\b/i, "Soft Skills"],
  [/\b(address|license|certificate|marriage|spouse|eligib|verif.*guest)\b/i, "Verification"],
];

function categorize(text: string): string {
  for (const [re, cat] of CATEGORIES) {
    if (re.test(text)) return cat;
  }
  return "General";
}

interface ParseResult {
  text: string;
  type: Condition["type"];
  negated: boolean;
  strategy: "instant" | "ai";
  category: string;
  confidence: number;
  evaluation: string;
  expression?: Expression;
  fragments?: string[];
  alternatives?: { label: string; type: string }[];
  error?: string;
}

function parseCondition(text: string, fields: Field[]): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length < 3) {
    return { text: trimmed, type: "boolean", negated: false, strategy: "ai", category: "General", confidence: 0, evaluation: "", error: "Too short -- try a complete phrase." };
  }

  const lower = trimmed.toLowerCase();
  const result: ParseResult = {
    text: trimmed,
    type: "boolean",
    negated: false,
    strategy: "ai",
    category: categorize(lower),
    confidence: 0.85,
    evaluation: trimmed,
  };

  // Negation
  if (/\b(not|n't|no |never|wasn't|didn't|don't|isn't|without|aren't)\b/i.test(lower)) {
    result.negated = true;
  }

  // Scope filter
  if (/\b(only (for|when|if)|when department|if department|for .{1,20} department)\b/i.test(lower)) {
    result.type = "scope";
    result.strategy = "instant";
    result.confidence = 0.97;
    const deptMatch = lower.match(/(?:for|is|=)\s+(\w+)\s*(?:department)?/);
    if (deptMatch) {
      result.expression = { field: "department", operator: "==", value: deptMatch[1] };
      result.evaluation = `department == "${deptMatch[1]}"`;
    }
    return result;
  }

  // Expression: check declared fields
  for (const field of fields) {
    const fn = field.name.toLowerCase();
    if (!lower.includes(fn) && !lower.includes(fn.replace(/([A-Z])/g, " $1").toLowerCase())) continue;

    const opPatterns: [RegExp, string][] = [
      [/no more than\s+(\d+)/i, "<="],
      [/at most\s+(\d+)/i, "<="],
      [/at least\s+(\d+)/i, ">="],
      [/more than\s+(\d+)/i, ">"],
      [/less than\s+(\d+)/i, "<"],
      [/fewer than\s+(\d+)/i, "<"],
      [/greater than\s+(\d+)/i, ">"],
      [/equals?\s+["']?(\w+)["']?/i, "=="],
      [/is\s+["']?(\w+)["']?/i, "=="],
      [/[<>!=]=?\s*(\d+)/i, "match"],
    ];

    for (const [pat, op] of opPatterns) {
      const m = lower.match(pat);
      if (m) {
        let operator = op;
        if (op === "match") {
          const raw = lower.match(/([<>!=]=?)/);
          operator = raw ? raw[1] : "==";
        }
        result.type = field.type === "number" ? "expression" : "expression";
        result.strategy = "instant";
        result.confidence = 0.98;
        result.expression = { field: field.name, operator, value: m[1] };
        result.evaluation = `${field.name} ${operator} ${m[1]}`;
        return result;
      }
    }
  }

  // OR compound
  if (/\b(either\b.+\bor\b)/i.test(lower)) {
    const parts = lower.split(/\bor\b/i).map((s) => s.replace(/^either\s*/i, "").trim()).filter(Boolean);
    if (parts.length >= 2) {
      result.type = "compound";
      result.fragments = parts;
      result.confidence = 0.82;
      result.evaluation = parts.join(" OR ");
      return result;
    }
  }

  // AND compound
  const andParts = lower.split(/\band\b/i).map((s) => s.trim()).filter((s) => s.length > 5);
  if (andParts.length >= 2) {
    result.type = "compound";
    result.fragments = andParts;
    result.confidence = 0.80;
    result.evaluation = andParts.join(" AND ");
    result.alternatives = [
      { label: "Two separate conditions (AND)", type: "split" },
      { label: "Single condition (as written)", type: "boolean" },
    ];
    return result;
  }

  // Number check (without matching a declared field)
  if (/\b\d+\b/.test(lower) && /\b(more|less|fewer|at least|at most|no more|max|min|count|times|holds?)\b/i.test(lower)) {
    result.type = "number";
    result.confidence = 0.78;
    result.alternatives = [
      { label: "Number comparison (AI extracts value)", type: "number" },
      { label: "Boolean check (pass/fail)", type: "boolean" },
    ];
  }

  return result;
}

// --- Test Runner (mock) ---

function evaluateCondition(cond: Condition, transcript: string): "pass" | "fail" {
  const lower = transcript.toLowerCase();

  if (cond.type === "expression" && cond.expression) {
    const { field, operator, value } = cond.expression;
    if (field === "holdCount") {
      const holdMatches = lower.match(/\bhold\b/gi);
      const count = holdMatches ? holdMatches.length : 0;
      const num = parseInt(value);
      switch (operator) {
        case "<=": return count <= num ? "pass" : "fail";
        case "<": return count < num ? "pass" : "fail";
        case ">=": return count >= num ? "pass" : "fail";
        case ">": return count > num ? "pass" : "fail";
        case "==": return count === num ? "pass" : "fail";
        default: return "pass";
      }
    }
    if (field === "department") {
      return "pass"; // scope filter, assume matching
    }
    return "pass";
  }

  if (cond.type === "scope") return "pass";

  // AI mock: keyword matching
  const cat = cond.category.toLowerCase();
  let passes = false;

  if (cat === "opening" || cond.text.toLowerCase().includes("greeting") || cond.text.toLowerCase().includes("identified")) {
    passes = /\b(hi|hello|welcome|thanks for calling|my name is|this is \w+ speaking)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("verif") || cond.text.toLowerCase().includes("identity")) {
    passes = /\b(verify|confirm|account number|last four|ssn|identity)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("rude") || cond.text.toLowerCase().includes("dismissive")) {
    const rudeSignals = /\b(what do you want|make it quick|i don't have all day|what is it|fine\.|yeah what)\b/i.test(lower);
    passes = rudeSignals; // condition is negated, so evaluateCondition returns whether rudeness is present
  } else if (cond.text.toLowerCase().includes("callback")) {
    passes = /\b(callback|call you back|call back)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("wait time") || cond.text.toLowerCase().includes("estimated")) {
    passes = /\b(\d+ minutes?|shortly|just a moment|quick|brief)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("summary") || cond.text.toLowerCase().includes("recap")) {
    passes = /\b(recap|so to|summarize|to sum up|we've|i've)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("anything else")) {
    passes = /\b(anything else|something else|else I can|further assistance)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("thank")) {
    passes = /\b(thank|thanks|appreciate)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("optional") || cond.text.toLowerCase().includes("disclos")) {
    passes = /\b(optional|not required|you don't have to|no obligation)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("same address") && cond.text.toLowerCase().includes("license")) {
    passes = /\b(yes|yep|yeah|correct|same address|we do|that's right|affirmative)\b/i.test(lower) && !/\b(no|different address|not the same|don't share)\b/i.test(lower);
  } else if (cond.text.toLowerCase().includes("marriage certificate")) {
    passes = /\b(yes|absolutely|sure|of course|I have it|I can|bring it)\b/i.test(lower) && !/\b(no|can't find|lost it|don't have|don't think)\b/i.test(lower);
  } else {
    passes = Math.random() > 0.3;
  }

  // For negated conditions: "wasn't rude" means pass when NOT rude
  if (cond.negated) passes = !passes;

  return passes ? "pass" : "fail";
}

// --- Route Handlers ---

async function handleSeed(): Promise<Response> {
  // Clear existing data
  const entries = kv.list({ prefix: ["questions"] });
  for await (const entry of entries) {
    await kv.delete(entry.key);
  }
  // Write seed data
  for (const q of SEED) {
    await kv.set(["questions", q.id], q);
  }
  return new Response("Seeded", { status: 200 });
}

async function getQuestion(id: string): Promise<Question | null> {
  const entry = await kv.get<Question>(["questions", id]);
  return entry.value;
}

async function getAllQuestions(): Promise<Question[]> {
  const results: Question[] = [];
  const entries = kv.list<Question>({ prefix: ["questions"] });
  for await (const entry of entries) {
    results.push(entry.value);
  }
  return results.sort((a, b) => {
    const order = { active: 0, draft: 1, archived: 2 };
    return order[a.status] - order[b.status];
  });
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return cors();

  // Seed
  if (path === "/seed") return handleSeed();

  // List questions
  if (path === "/api/questions" && method === "GET") {
    return json(await getAllQuestions());
  }

  // Single question
  const qMatch = path.match(/^\/api\/questions\/(\w+)$/);
  if (qMatch && method === "GET") {
    const q = await getQuestion(qMatch[1]);
    return q ? json(q) : json({ error: "Not found" }, 404);
  }

  // Parse condition
  if (path === "/api/parse" && method === "POST") {
    const body = await req.json();
    const result = parseCondition(body.text || "", body.fields || []);
    return json(result);
  }

  // Add condition
  const addMatch = path.match(/^\/api\/questions\/(\w+)\/conditions$/);
  if (addMatch && method === "POST") {
    const q = await getQuestion(addMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);
    const body = await req.json();
    const cond: Condition = {
      id: `c${uid()}`,
      text: body.text,
      type: body.type || "boolean",
      negated: body.negated || false,
      strategy: body.strategy || "ai",
      category: body.category || "General",
      confidence: body.confidence || 0.85,
      evaluation: body.evaluation || body.text,
      expression: body.expression,
      groupId: body.groupId,
      versions: [{ text: body.text, ts: Date.now() }],
    };
    q.conditions.push(cond);
    await kv.set(["questions", q.id], q);
    return json(cond, 201);
  }

  // Update condition
  const updMatch = path.match(/^\/api\/questions\/(\w+)\/conditions\/(\w+)$/);
  if (updMatch && method === "PUT") {
    const q = await getQuestion(updMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);
    const idx = q.conditions.findIndex((c) => c.id === updMatch[2]);
    if (idx === -1) return json({ error: "Condition not found" }, 404);
    const body = await req.json();
    const old = q.conditions[idx];
    if (body.text && body.text !== old.text) {
      old.versions.push({ text: body.text, ts: Date.now() });
    }
    Object.assign(old, body);
    await kv.set(["questions", q.id], q);
    return json(old);
  }

  // Delete condition
  if (updMatch && method === "DELETE") {
    const q = await getQuestion(updMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);
    q.conditions = q.conditions.filter((c) => c.id !== updMatch[2]);
    // Dissolve empty groups
    const usedGroups = new Set(q.conditions.map((c) => c.groupId).filter(Boolean));
    q.groups = q.groups.filter((g) => usedGroups.has(g.id));
    await kv.set(["questions", q.id], q);
    return json({ ok: true });
  }

  // Run tests
  const testMatch = path.match(/^\/api\/questions\/(\w+)\/test$/);
  if (testMatch && method === "POST") {
    const q = await getQuestion(testMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);

    const results = q.testCases.map((tc) => {
      const condResults = q.conditions.map((cond) => ({
        conditionId: cond.id,
        conditionText: cond.text,
        result: evaluateCondition(cond, tc.transcript),
      }));
      // Overall: pass if all non-scope conditions pass (scope just filters)
      const relevant = condResults.filter((cr) => {
        const c = q.conditions.find((x) => x.id === cr.conditionId);
        return c && c.type !== "scope";
      });

      // Handle groups: OR groups pass if any child passes
      const groupedResults = new Map<string, boolean>();
      for (const cr of relevant) {
        const c = q.conditions.find((x) => x.id === cr.conditionId)!;
        if (c.groupId) {
          const group = q.groups.find((g) => g.id === c.groupId);
          if (group?.operator === "OR") {
            const current = groupedResults.get(c.groupId) ?? false;
            groupedResults.set(c.groupId, current || cr.result === "pass");
            continue;
          }
        }
        groupedResults.set(cr.conditionId, cr.result === "pass");
      }

      const overall = [...groupedResults.values()].every(Boolean) ? "pass" : "fail";
      tc.lastResult = overall;

      return {
        testId: tc.id,
        testName: tc.name,
        expected: tc.expected,
        actual: overall,
        match: tc.expected === overall,
        conditionResults: condResults,
      };
    });

    await kv.set(["questions", q.id], q);
    return json(results);
  }

  // Add test case
  const addTestMatch = path.match(/^\/api\/questions\/(\w+)\/tests$/);
  if (addTestMatch && method === "POST") {
    const q = await getQuestion(addTestMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);
    const body = await req.json();
    const tc: TestCase = {
      id: `t${uid()}`,
      name: body.name || "Unnamed test",
      transcript: body.transcript || "",
      expected: body.expected || "pass",
    };
    q.testCases.push(tc);
    await kv.set(["questions", q.id], q);
    return json(tc, 201);
  }

  // Promote draft to active
  const promoteMatch = path.match(/^\/api\/questions\/(\w+)\/promote$/);
  if (promoteMatch && method === "POST") {
    const q = await getQuestion(promoteMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);
    if (q.status !== "draft") return json({ error: "Only drafts can be promoted" }, 400);
    const vNum = parseInt(q.version.replace("v", "")) + 1;
    q.status = "active";
    q.version = `v${vNum}`;
    await kv.set(["questions", q.id], q);
    return json(q);
  }

  // Create group
  const groupMatch = path.match(/^\/api\/questions\/(\w+)\/groups$/);
  if (groupMatch && method === "POST") {
    const q = await getQuestion(groupMatch[1]);
    if (!q) return json({ error: "Not found" }, 404);
    const body = await req.json();
    const group: Group = {
      id: `g${uid()}`,
      label: body.label || "New Group",
      operator: body.operator || "OR",
    };
    q.groups.push(group);
    // Assign conditions to group
    if (body.conditionIds) {
      for (const cid of body.conditionIds) {
        const c = q.conditions.find((x) => x.id === cid);
        if (c) c.groupId = group.id;
      }
    }
    await kv.set(["questions", q.id], q);
    return json(group, 201);
  }

  // Serve index.html for root
  if (path === "/" || path === "/index.html") {
    const html = await Deno.readTextFile(new URL("./index.html", import.meta.url).pathname);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return json({ error: "Not found" }, 404);
}

Deno.serve({ port: PORT }, handler);
