// Test Plan AI Agent - backend
// Reads JIRA / LLM settings from config.env, fetches a JIRA issue,
// asks the LLM to fill TestPlan_Template.md, and saves the result as a file.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.resolve(SRC_DIR, '../../02_Plan/Template/TestPlan_Template.md');
const OUTPUT_DIR = path.join(SRC_DIR, 'output');
const PORT = 3001;

const DEFAULTS = {
  groqModel: 'openai/gpt-oss-120b',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
};

// ---------- config.env ----------
function findConfigFile(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, 'config.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadEnvFile(file) {
  const env = {};
  if (!file) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = value;
  }
  return env;
}

const CONFIG_FILE = findConfigFile(SRC_DIR);
const ENV = loadEnvFile(CONFIG_FILE);

// Values typed in the Settings page win; empty fields fall back to config.env.
function resolveSettings(body = {}) {
  const j = body.jira || {};
  const l = body.llm || {};
  const pick = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback || '');
  return {
    jira: {
      url: pick(j.url, ENV.JIRA_URL).replace(/\/+$/, ''),
      email: pick(j.email, ENV.JIRA_EMAIL),
      token: pick(j.token, ENV.JIRA_TOKEN),
    },
    llm: {
      provider: l.provider === 'ollama' ? 'ollama' : 'groq',
      groqKey: pick(l.groqKey, ENV.GROQ_API_KEY),
      groqModel: pick(l.groqModel, DEFAULTS.groqModel),
      ollamaUrl: pick(l.ollamaUrl, DEFAULTS.ollamaUrl).replace(/\/+$/, ''),
      ollamaModel: pick(l.ollamaModel, DEFAULTS.ollamaModel),
    },
  };
}

// ---------- JIRA ----------
async function jiraGet(jira, apiPath) {
  if (!jira.url || !jira.email || !jira.token) {
    throw new Error('JIRA URL, Email and Token are required (Settings or config.env).');
  }
  const auth = Buffer.from(`${jira.email}:${jira.token}`).toString('base64');
  const res = await fetch(`${jira.url}${apiPath}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error(`JIRA authentication failed (HTTP ${res.status}). Check Email / Token.`);
  if (res.status === 404) throw new Error('JIRA resource not found (HTTP 404). Check the JIRA ID and URL.');
  if (!res.ok) throw new Error(`JIRA request failed (HTTP ${res.status}).`);
  return res.json();
}

function simplifyValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(simplifyValue).filter((v) => v != null);
  if (typeof value === 'object') {
    // Sprint objects and other named objects
    if (value.name && (value.startDate || value.endDate || value.state)) {
      return { name: value.name, state: value.state, startDate: value.startDate, endDate: value.endDate, goal: value.goal };
    }
    return value.value || value.name || value.displayName || JSON.stringify(value);
  }
  return value;
}

async function fetchIssue(jira, issueKey) {
  const data = await jiraGet(jira, `/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=names`);
  const f = data.fields || {};
  const names = data.names || {};

  // Include custom fields relevant to planning (acceptance criteria, sprint, story points).
  const extra = {};
  for (const [id, label] of Object.entries(names)) {
    if (id.startsWith('customfield_') && /acceptance|sprint|story point|team/i.test(label) && f[id] != null) {
      extra[label] = simplifyValue(f[id]);
    }
  }

  return {
    key: data.key,
    summary: f.summary,
    issueType: f.issuetype?.name,
    status: f.status?.name,
    priority: f.priority?.name,
    labels: f.labels,
    components: f.components?.map((c) => c.name),
    fixVersions: f.fixVersions?.map((v) => v.name),
    reporter: f.reporter?.displayName,
    assignee: f.assignee?.displayName,
    description: f.description || null,
    subtasks: f.subtasks?.map((s) => `${s.key}: ${s.fields?.summary}`),
    linkedIssues: f.issuelinks?.map((l) => {
      const other = l.outwardIssue || l.inwardIssue;
      const rel = l.outwardIssue ? l.type?.outward : l.type?.inward;
      return other ? `${rel} ${other.key}: ${other.fields?.summary}` : null;
    }).filter(Boolean),
    comments: f.comment?.comments?.map((c) => `${c.author?.displayName}: ${c.body}`),
    ...extra,
  };
}

// ---------- LLM ----------
async function callLLM(llm, messages) {
  if (llm.provider === 'groq') {
    if (!llm.groqKey) throw new Error('GROQ API key is missing (Settings or config.env).');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.groqModel, temperature: 0, seed: 42, messages }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GROQ request failed (HTTP ${res.status}): ${body.error?.message || 'unknown error'}`);
    return body.choices?.[0]?.message?.content || '';
  }

  const res = await fetch(`${llm.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: llm.ollamaModel, stream: false, options: { temperature: 0, seed: 42 }, messages }),
  }).catch(() => { throw new Error(`Cannot reach Ollama at ${llm.ollamaUrl}. Is it running?`); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ollama request failed (HTTP ${res.status}): ${body.error || 'unknown error'}`);
  return body.message?.content || '';
}

function buildMessages(issue, template) {
  const system = `You are a QA Engineer with 15 years of experience building intelligent test plans.
Produce a test plan for the JIRA issue supplied by the user, using the TEMPLATE below.

Rules:
- Follow the structure of the TEMPLATE exactly: same headings, same order, same tables. Fill every section.
- Replace <JIRA-KEY> and <title> with the issue key and summary.
- Every statement must be traceable to the JIRA issue data or the TEMPLATE.
- If information for a field is missing or unclear, write exactly: "Insufficient information to determine."
- If a detail is inferred, label it exactly: "Inference (low confidence)".
- Do not invent features, IDs, APIs, error codes, UI elements, or behavior.
- Do not assume default or "typical" system behavior.
- Tone: technical and formal. Output only the Markdown test plan, with no conversational filler and no code fences.

TEMPLATE:
${template}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: `JIRA issue data (JSON):\n${JSON.stringify(issue, null, 2)}` },
  ];
}

function cleanMarkdown(text) {
  return text.trim().replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
}

// ---------- API ----------
const app = express();
app.use(express.json());

const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(400).json({ ok: false, message: err.message }));

// Pre-fills the Settings page from config.env.
// The server listens on 127.0.0.1 only, so these values never leave this machine.
app.get('/api/config', (req, res) => {
  res.json({
    configFile: CONFIG_FILE ? path.basename(CONFIG_FILE) : null,
    jiraUrl: (ENV.JIRA_URL || '').replace(/\/+$/, ''),
    jiraEmail: ENV.JIRA_EMAIL || '',
    jiraToken: ENV.JIRA_TOKEN || '',
    groqKey: ENV.GROQ_API_KEY || '',
    defaults: DEFAULTS,
  });
});

app.post('/api/test/jira', route(async (req, res) => {
  const { jira } = resolveSettings(req.body);
  const me = await jiraGet(jira, '/rest/api/2/myself');
  res.json({ ok: true, message: `Connected as ${me.displayName || me.emailAddress || 'JIRA user'}` });
}));

app.post('/api/test/groq', route(async (req, res) => {
  const { llm } = resolveSettings(req.body);
  if (!llm.groqKey) throw new Error('GROQ API key is missing.');
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${llm.groqKey}` } });
  if (!r.ok) throw new Error(`GROQ connection failed (HTTP ${r.status}).`);
  const { data = [] } = await r.json();
  const hasModel = data.some((m) => m.id === llm.groqModel);
  res.json({
    ok: hasModel,
    message: hasModel
      ? `GROQ connected (model: ${llm.groqModel})`
      : `GROQ key is valid, but model "${llm.groqModel}" is not available.`,
  });
}));

app.post('/api/test/ollama', route(async (req, res) => {
  const { llm } = resolveSettings(req.body);
  const r = await fetch(`${llm.ollamaUrl}/api/tags`).catch(() => null);
  if (!r || !r.ok) throw new Error(`Cannot reach Ollama at ${llm.ollamaUrl}.`);
  const { models = [] } = await r.json();
  const names = models.map((m) => m.name);
  const hasModel = names.some((n) => n === llm.ollamaModel || n.startsWith(`${llm.ollamaModel}:`));
  res.json({
    ok: hasModel,
    message: hasModel
      ? `Ollama connected (model: ${llm.ollamaModel})`
      : `Ollama reachable, but model "${llm.ollamaModel}" not found. Available: ${names.join(', ') || 'none'}`,
  });
}));

app.post('/api/generate', route(async (req, res) => {
  const issueKey = String(req.body.issueKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) throw new Error('Enter a valid JIRA ID, e.g. KAN-4.');

  const { jira, llm } = resolveSettings(req.body);
  const issue = await fetchIssue(jira, issueKey);
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const markdown = cleanMarkdown(await callLLM(llm, buildMessages(issue, template)));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fileName = `${issueKey}_TestPlan.md`;
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), markdown, 'utf8');

  res.json({
    ok: true,
    issueKey,
    summary: issue.summary,
    model: llm.provider === 'groq' ? `Groq (${llm.groqModel})` : `Ollama (${llm.ollamaModel})`,
    generatedAt: new Date().toISOString(),
    markdown,
    savedAs: `output/${fileName}`,
  });
}));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`API server running on http://127.0.0.1:${PORT}`);
  console.log(CONFIG_FILE ? `Loaded settings from ${CONFIG_FILE}` : 'config.env not found - enter settings in the UI.');
});
