// Test Case AI Agent - backend
// Reads JIRA / LLM settings from config.env, fetches a JIRA issue (plus its parent,
// subtasks and linked issues), asks the LLM to produce test cases using
// TESTCASE_PROMPT.md, and exports the result to Excel.
import express from 'express';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');
const PROMPT_PATH = path.resolve(SRC_DIR, '../../02_Plan/Prompt/TESTCASE_PROMPT.md');
const OUTPUT_DIR = path.join(SRC_DIR, 'output');
const PORT = 3002;

const DEFAULTS = {
  groqModel: 'openai/gpt-oss-120b',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
};

// Output columns, exactly as listed in TESTCASE_PROMPT.md, in this order.
const COLUMNS = [
  'TC ID', 'Module', 'Test Scenario', 'Test Case Title', 'Test Type', 'Priority',
  'Preconditions', 'Test Steps', 'Test Data', 'Expected Result',
  'Actual Result', 'Status', 'Build / Version', 'Comments',
];
// Populated during execution - always blank in generated output (prompt field rules).
const EXECUTION_COLUMNS = ['Actual Result', 'Build / Version'];
// Columns the LLM is asked to fill.
const LLM_COLUMNS = COLUMNS.filter((c) => c !== 'Status' && !EXECUTION_COLUMNS.includes(c));
const CLARIFICATION_COLUMNS = ['Requirement ID', 'Ambiguity / Gap', 'Clarification Needed'];

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

// Values saved in the Settings page win; empty fields fall back to config.env.
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
  }).catch(() => { throw new Error(`Cannot reach JIRA at ${jira.url}.`); });
  if (res.status === 401 || res.status === 403) throw new Error(`JIRA authentication failed (HTTP ${res.status}). Check Email / Token.`);
  if (res.status === 404) throw new Error('JIRA issue not found (HTTP 404). Check the JIRA key and URL.');
  if (!res.ok) throw new Error(`JIRA request failed (HTTP ${res.status}).`);
  return res.json();
}

function simplifyValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(simplifyValue).filter((v) => v != null);
  if (typeof value === 'object') {
    if (value.name && (value.startDate || value.endDate || value.state)) {
      return { name: value.name, state: value.state, startDate: value.startDate, endDate: value.endDate, goal: value.goal };
    }
    return value.value || value.name || value.displayName || JSON.stringify(value);
  }
  return value;
}

// Keep the LLM request within provider token limits. The requested issue keeps its full
// description (up to MAX_MAIN); related issues and comments are trimmed harder.
const MAX_MAIN = 30000;
const MAX_TEXT = 3000;
const clip = (text, max = MAX_TEXT) => (typeof text === 'string' && text.length > max ? `${text.slice(0, max)}… [truncated]` : text);

// Custom fields relevant to test design (acceptance criteria, platforms, etc.).
function extraFields(fields, names) {
  const extra = {};
  for (const [id, label] of Object.entries(names || {})) {
    if (id.startsWith('customfield_') && /acceptance|platform|browser|device|environment/i.test(label) && fields[id] != null) {
      extra[label] = clip(simplifyValue(fields[id]));
    }
  }
  return extra;
}

function summarizeIssue(data, maxDescription = MAX_TEXT) {
  const f = data.fields || {};
  return {
    key: data.key,
    summary: f.summary,
    issueType: f.issuetype?.name,
    status: f.status?.name,
    priority: f.priority?.name,
    labels: f.labels,
    components: f.components?.map((c) => c.name),
    fixVersions: f.fixVersions?.map((v) => v.name),
    environment: f.environment || undefined,
    description: clip(f.description, maxDescription) || null,
    ...extraFields(f, data.names),
  };
}

async function fetchIssueContext(jira, issueKey) {
  const data = await jiraGet(jira, `/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=names`);
  const f = data.fields || {};

  const issue = {
    project: f.project ? { key: f.project.key, name: f.project.name } : undefined,
    ...summarizeIssue(data, MAX_MAIN),
    reporter: f.reporter?.displayName,
    assignee: f.assignee?.displayName,
    comments: f.comment?.comments?.slice(-10).map((c) => `${c.author?.displayName}: ${clip(c.body)}`),
  };

  // Parent (Epic) - source for the Module column.
  if (f.parent) {
    issue.parent = { key: f.parent.key, summary: f.parent.fields?.summary, issueType: f.parent.fields?.issuetype?.name };
  }

  // Subtasks and linked issues (linked Bugs feed Regression cases).
  const related = [
    ...(f.subtasks || []).map((s) => ({ key: s.key, relation: 'subtask' })),
    ...(f.issuelinks || []).map((l) => {
      const other = l.outwardIssue || l.inwardIssue;
      return other ? { key: other.key, relation: l.outwardIssue ? l.type?.outward : l.type?.inward } : null;
    }).filter(Boolean),
  ].slice(0, 15);

  issue.relatedIssues = await Promise.all(related.map(async ({ key, relation }) => {
    try {
      const r = await jiraGet(jira, `/rest/api/2/issue/${encodeURIComponent(key)}?expand=names`);
      return { relation, ...summarizeIssue(r) };
    } catch {
      return { relation, key, note: 'Could not be retrieved from JIRA.' };
    }
  }));

  return issue;
}

// ---------- LLM ----------
async function callLLM(llm, messages) {
  if (llm.provider === 'groq') {
    if (!llm.groqKey) throw new Error('GROQ API key is missing (Settings or config.env).');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llm.groqModel, temperature: 0, seed: 42, messages,
        response_format: { type: 'json_object' },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GROQ request failed (HTTP ${res.status}): ${body.error?.message || 'unknown error'}`);
    return body.choices?.[0]?.message?.content || '';
  }

  const res = await fetch(`${llm.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: llm.ollamaModel, stream: false, format: 'json', options: { temperature: 0, seed: 42 }, messages }),
  }).catch(() => { throw new Error(`Cannot reach Ollama at ${llm.ollamaUrl}. Is it running?`); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ollama request failed (HTTP ${res.status}): ${body.error || 'unknown error'}`);
  return body.message?.content || '';
}

function buildMessages(issue, projectKey) {
  const prompt = fs.readFileSync(PROMPT_PATH, 'utf8')
    .replaceAll('{{PROJECT_KEY}}', projectKey)
    .replaceAll('{{PLATFORMS}}', 'no platforms provided by the user - use only platforms stated in the JIRA data');

  const format = `
# Response format (machine-readable)
Return ONLY a JSON object, no prose and no code fences:
{
  "testCases": [ { ${LLM_COLUMNS.map((c) => JSON.stringify(c)).join(', ')} } ],
  "clarificationLog": [ { ${CLARIFICATION_COLUMNS.map((c) => JSON.stringify(c)).join(', ')} } ]
}
- Every value is a string. "Test Steps" is a single string of numbered steps separated by "\\n" (e.g. "1. ...\\n2. ...").
- ${['Status', ...EXECUTION_COLUMNS].map((c) => JSON.stringify(c)).join(', ')} are filled by the system; do not include them. Do not add any other keys.
- Project key for TC IDs: ${projectKey}. Use only Jira issue keys present in the supplied JIRA data; reference the source Jira key(s) in "Comments" (there is no Requirement ID column).
- Apply "Coverage per requirement" to EVERY requirement, user story, acceptance criterion, functional flow and non-functional requirement in the JIRA data: produce a test case for each applicable Test Type (Positive, Negative, Boundary, Edge Case, Security, Cross-Platform, Regression, Non-Functional) that the data supports. Do not stop at a sample.
- "clarificationLog" is the Clarification Log from the Process section: record every ambiguity, gap, unspecified limit, untestable criterion and open question found in the JIRA data; use [] only if there are none.`;

  return [
    { role: 'system', content: `${prompt}\n${format}` },
    {
      role: 'user',
      content: `Jira project key: ${projectKey}\nJIRA issue ${issue.key} with its parent, subtasks and linked issues (JSON):\n${JSON.stringify(issue, null, 2)}`,
    },
  ];
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new Error('The LLM response was not valid JSON. Click Regenerate to try again.');
  }
}

const asText = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x, i) => (/^\d+[.)]/.test(String(x).trim()) ? String(x).trim() : `${i + 1}. ${x}`)).join('\n');
  return typeof v === 'object' ? JSON.stringify(v) : String(v).trim();
};

// Enforce the prompt's field rules regardless of model drift.
function normalizeTestCases(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const out = {};
    for (const col of COLUMNS) out[col] = asText(row?.[col]);
    out.Status = 'Not Executed';
    for (const col of EXECUTION_COLUMNS) out[col] = '';
    return out;
  });
}

function normalizeClarifications(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Object.fromEntries(CLARIFICATION_COLUMNS.map((c) => [c, asText(row?.[c])])));
}

// ---------- Excel ----------
async function buildWorkbook(testCases, clarificationLog) {
  const wb = new ExcelJS.Workbook();
  const addSheet = (name, columns, rows) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({
      header: c, key: c,
      width: /Steps|Expected|Preconditions|Scenario|Title|Comments|Data|Ambiguity|Clarification/.test(c) ? 40 : 16,
    }));
    rows.forEach((r) => ws.addRow(r));
    ws.eachRow((row, n) => {
      row.alignment = { wrapText: true, vertical: 'top' };
      if (n === 1) {
        row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B1E3F' } };
      }
    });
  };
  addSheet('Test Cases', COLUMNS, testCases);
  addSheet('Clarification Log', CLARIFICATION_COLUMNS, clarificationLog);
  return wb.xlsx.writeBuffer();
}

// ---------- API ----------
const app = express();
app.use(express.json({ limit: '5mb' }));

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
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
    message: hasModel ? `Key valid (model: ${llm.groqModel})` : `Key valid, but model "${llm.groqModel}" is not available.`,
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
  if (!ISSUE_KEY.test(issueKey)) throw new Error('Enter a valid JIRA story key, e.g. KAN-4.');

  const { jira, llm } = resolveSettings(req.body);
  const issue = await fetchIssueContext(jira, issueKey);
  const projectKey = issue.project?.key || issueKey.split('-')[0];

  const parsed = parseJson(await callLLM(llm, buildMessages(issue, projectKey)));
  const testCases = normalizeTestCases(parsed.testCases);
  if (!testCases.length) throw new Error('The LLM returned no test cases. Click Regenerate to try again.');

  res.json({
    ok: true,
    issueKey,
    summary: issue.summary,
    model: llm.provider === 'groq' ? `Groq (${llm.groqModel})` : `Ollama (${llm.ollamaModel})`,
    generatedAt: new Date().toISOString(),
    columns: COLUMNS,
    testCases,
    clarificationLog: normalizeClarifications(parsed.clarificationLog),
  });
}));

app.post('/api/export', route(async (req, res) => {
  const issueKey = String(req.body.issueKey || '').trim().toUpperCase();
  if (!ISSUE_KEY.test(issueKey)) throw new Error('Invalid JIRA key for export.');
  const testCases = normalizeTestCases(req.body.testCases);
  if (!testCases.length) throw new Error('Nothing to export.');

  const buffer = Buffer.from(await buildWorkbook(testCases, normalizeClarifications(req.body.clarificationLog)));
  const fileName = `${issueKey}_TestCases.xlsx`;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buffer);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
}));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`API server running on http://127.0.0.1:${PORT}`);
  console.log(CONFIG_FILE ? `Loaded settings from ${CONFIG_FILE}` : 'config.env not found - enter settings in the UI.');
});
