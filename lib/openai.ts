// Thin OpenAI client over plain fetch (no SDK). SERVER ONLY: reads OPENAI_API_KEY from
// process.env, which must never be NEXT_PUBLIC_ or sent to the client. The key is only ever
// placed in the Authorization header; it is never logged, and neither are prompts or outputs.
//
// Models (checked against developers.openai.com/api/docs/models on 2026-10-22):
//  - gpt-6-luna: OpenAI's "most efficient model for focused, high-volume tasks" ($0.10/M input,
//    $0.50/M output). The only model the Decisions API accepts, and also on the Responses API.

export const OPENAI_MODEL = "gpt-6-luna";
const BASE = "https://api.openai.com/v1";
const TIMEOUT_MS = 20_000;

/** Max model calls per rolling hour, per server instance. Override with AI_MAX_CALLS_PER_HOUR. */
const MAX_CALLS_PER_HOUR = Number(process.env.AI_MAX_CALLS_PER_HOUR) > 0 ? Number(process.env.AI_MAX_CALLS_PER_HOUR) : 60;

// Module-level counter: per serverless instance, so the true ceiling is N x instances. Results are
// also cached (unstable_cache), which is the main cost control; this is the backstop.
let windowStart = 0;
const counts = { decisions: 0, responses: 0, denied: 0, errors: 0 };

function takeBudget(kind: "decisions" | "responses"): boolean {
  const now = Date.now();
  if (now - windowStart >= 3_600_000) {
    windowStart = now;
    counts.decisions = counts.responses = counts.denied = counts.errors = 0;
  }
  if (counts.decisions + counts.responses >= MAX_CALLS_PER_HOUR) {
    if (counts.denied++ === 0) console.warn(`[ai] hourly cap of ${MAX_CALLS_PER_HOUR} model calls reached; further calls are skipped until the window resets`);
    return false;
  }
  counts[kind]++;
  return true;
}

/** Counts only (never content), for the server log and diagnostics. */
export function aiUsage() {
  return { ...counts, cap: MAX_CALLS_PER_HOUR, windowStartedAt: windowStart ? new Date(windowStart).toISOString() : null };
}

export const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

export type AiResult<T> = { ok: true; data: T } | { ok: false; reason: string };

async function post(path: string, kind: "decisions" | "responses", body: unknown): Promise<AiResult<Record<string, unknown>>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "OPENAI_API_KEY is not set" };
  if (!takeBudget(kind)) return { ok: false, reason: "hourly model-call cap reached" };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      counts.errors++;
      console.warn(`[ai] ${kind} call failed: HTTP ${res.status} (calls this hour: ${counts.decisions + counts.responses}/${MAX_CALLS_PER_HOUR})`);
      return { ok: false, reason: `OpenAI HTTP ${res.status}` };
    }
    const json = (await res.json()) as Record<string, unknown>;
    console.log(`[ai] ${kind} ok (calls this hour: ${counts.decisions + counts.responses}/${MAX_CALLS_PER_HOUR})`);
    return { ok: true, data: json };
  } catch (e) {
    counts.errors++;
    const name = e instanceof Error ? e.name : "error";
    console.warn(`[ai] ${kind} call failed: ${name}`);
    return { ok: false, reason: name === "TimeoutError" ? "OpenAI request timed out" : "OpenAI request failed" };
  }
}

// ---- Decisions API (POST /v1/decisions): typed answers, billed on input tokens only ----

export type DecisionQuestion =
  | { type: "predicate"; name: string; instructions: string }
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] };

export type DecisionAnswer =
  | { type: "predicate"; name: string; probability: number }
  | { type: "choice"; name: string; choice: string; confidence: number }
  | { type: "refusal"; name: string };

export type DecisionInput =
  | string
  | { role: "user"; content: ({ type: "input_text"; text: string } | { type: "input_image"; image_url: string })[] }[];

export async function decide(input: DecisionInput, questions: DecisionQuestion[]): Promise<AiResult<Map<string, DecisionAnswer>>> {
  const r = await post("/decisions", "decisions", { model: OPENAI_MODEL, input, questions });
  if (!r.ok) return r;
  const answers = r.data.answers;
  if (!Array.isArray(answers)) return { ok: false, reason: "unexpected Decisions response" };
  const map = new Map<string, DecisionAnswer>();
  for (const a of answers as DecisionAnswer[]) if (a && typeof a.name === "string") map.set(a.name, a);
  return { ok: true, data: map };
}

// ---- Responses API (POST /v1/responses): text generation with a JSON schema ----

export async function respondJson<T>(opts: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}): Promise<AiResult<T>> {
  const r = await post("/responses", "responses", {
    model: OPENAI_MODEL,
    instructions: opts.instructions,
    input: opts.input,
    reasoning: { effort: "low" },
    max_output_tokens: opts.maxOutputTokens ?? 1200,
    store: false,
    text: { format: { type: "json_schema", name: opts.schemaName, strict: true, schema: opts.schema } },
  });
  if (!r.ok) return r;
  const output = r.data.output;
  let text = "";
  if (Array.isArray(output)) {
    for (const item of output as { type?: string; content?: { type?: string; text?: string }[] }[]) {
      if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text" && c.text) text += c.text;
    }
  }
  if (!text) return { ok: false, reason: "empty model output" };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, reason: "model output was not valid JSON" };
  }
}
