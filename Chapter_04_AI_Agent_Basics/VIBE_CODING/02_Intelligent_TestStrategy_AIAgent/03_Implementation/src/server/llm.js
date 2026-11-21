// LLM integration (Groq cloud / Ollama local). Deterministic settings:
// temperature 0 and a fixed seed for every request.
import { badRequest } from './config.js';

const SEED = 42;
const TIMEOUT_MS = 180000;

export async function callLLM(llm, messages) {
  if (llm.provider === 'groq') return callGroq(llm, messages);
  return callOllama(llm, messages);
}

const MAX_RATE_LIMIT_WAIT_S = 65;
const MAX_RATE_LIMIT_RETRIES = 5;
// Groq counts input + max output against tokens-per-minute (8000 on free tier).
const GROQ_TPM_BUDGET = Number(process.env.GROQ_TPM_BUDGET) || 7800;
const MAX_OUTPUT_TOKENS = 4096;
const MIN_OUTPUT_TOKENS = 1500;

function outputBudget(messages) {
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
  const estimatedInput = Math.ceil(inputChars / 3.2);
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(MAX_OUTPUT_TOKENS, GROQ_TPM_BUDGET - estimatedInput));
}

async function callGroq(llm, messages, attempt = 0) {
  try {
    return await groqRequest(llm, messages);
  } catch (err) {
    // Tokens-per-minute limit: wait for the window Groq reports, a few times at most.
    const wait = Number(err.retryAfter);
    if (err.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES && wait > 0 && wait <= MAX_RATE_LIMIT_WAIT_S) {
      console.warn(`Groq rate limit reached; retrying in ${Math.ceil(wait)}s`);
      await new Promise((r) => setTimeout(r, Math.ceil(wait) * 1000 + 500));
      return callGroq(llm, messages, attempt + 1);
    }
    throw err;
  }
}

async function groqRequest(llm, messages) {
  if (!llm.groqKey) throw badRequest('Groq API key is not configured (config.env or Settings).');
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llm.groqModel,
        temperature: 0,
        seed: SEED,
        max_completion_tokens: outputBudget(messages),
        ...(/gpt-oss/i.test(llm.groqModel) ? { reasoning_effort: 'low' } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw badRequest('Groq service is unreachable or timed out.', 502);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw badRequest('Groq authentication failed (HTTP 401). Check the Groq API key.', 401);
  if (res.status === 429) {
    const err = badRequest(`Groq rate limit reached (HTTP 429). ${body.error?.message || 'Try again shortly.'}`, 429);
    const fromMsg = /try again in ([\d.]+)s/i.exec(body.error?.message || '');
    err.retryAfter = Number(res.headers.get('retry-after')) || (fromMsg ? Number(fromMsg[1]) : 0);
    throw err;
  }
  if (!res.ok) throw badRequest(`Groq request failed (HTTP ${res.status}): ${body.error?.message || 'unknown error'}`, 502);
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw badRequest('Groq response was cut off (output token limit). Try again, or use a model/tier with a higher limit.', 502);
  const content = choice?.message?.content;
  if (!content) throw badRequest('Groq returned an empty response.', 502);
  return content;
}

async function callOllama(llm, messages) {
  let res;
  try {
    res = await fetch(`${llm.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.ollamaModel, stream: false, options: { temperature: 0, seed: SEED, num_ctx: 32768 }, messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
  } catch {
    throw badRequest(`Cannot reach Ollama at ${llm.ollamaUrl}. Is it running?`, 502);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw badRequest(`Ollama request failed (HTTP ${res.status}): ${body.error || 'unknown error'}`, 502);
  const content = body.message?.content;
  if (!content) throw badRequest('Ollama returned an empty response.', 502);
  return content;
}

export async function testGroq(llm) {
  if (!llm.groqKey) throw badRequest('Groq API key is not configured.');
  let r;
  try {
    r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${llm.groqKey}` },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw badRequest('Groq service is unreachable.', 502);
  }
  if (r.status === 401) throw badRequest('Groq key invalid (HTTP 401).', 401);
  if (!r.ok) throw badRequest(`Groq connection failed (HTTP ${r.status}).`, 502);
  const { data = [] } = await r.json();
  if (!data.some((m) => m.id === llm.groqModel)) throw badRequest(`Key valid, but model "${llm.groqModel}" is not available.`);
  return `Key valid (model: ${llm.groqModel})`;
}

export async function testOllama(llm) {
  const r = await fetch(`${llm.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r || !r.ok) throw badRequest(`Cannot reach Ollama at ${llm.ollamaUrl}.`, 502);
  const { models = [] } = await r.json();
  const names = models.map((m) => m.name);
  if (!names.some((n) => n === llm.ollamaModel || n.startsWith(`${llm.ollamaModel}:`))) {
    throw badRequest(`Ollama reachable, but model "${llm.ollamaModel}" not found. Available: ${names.join(', ') || 'none'}`);
  }
  return `Ollama connected (model: ${llm.ollamaModel})`;
}
