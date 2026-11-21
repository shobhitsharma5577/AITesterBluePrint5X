// Intelligent Test Strategy AI Agent - backend API.
// JIRA credentials and LLM keys stay in this process; the UI only receives
// non-secret settings and generated content.
import express from 'express';
import {
  PORT, CONFIG_FILE, getSettings, mergeSettings, validateSettings, saveSettings,
  publicSettings, redact, badRequest, modelLabel,
} from './config.js';
import { normalizeIssueKey, fetchIssue, testJiraConnection } from './jira.js';
import { testGroq, testOllama } from './llm.js';
import { generateStrategy, reviseStrategy, setApprovalStatus, PENDING_STATUS } from './strategy.js';
import { writeOutputs, resolveOutputFile } from './exporter.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

// Latest strategy per issue for this server session (review / approval loop).
const sessions = new Map();

const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const message = redact(err.message || 'Unexpected error.');
    console.error(`[${req.method} ${req.path}] ${message}`);
    res.status(err.status && err.status < 600 ? err.status : 500).json({ ok: false, message });
  });

function draftSettings(body) {
  const s = mergeSettings(body);
  validateSettings(s);
  return s;
}

function sessionResponse(s) {
  return {
    ok: true,
    issueKey: s.issueKey,
    summary: s.issue.summary,
    model: s.model,
    generatedAt: s.updatedAt,
    approvalStatus: s.approvalStatus,
    markdown: s.markdown,
    files: s.files,
    sources: {
      comments: s.issue.comments.length,
      linkedIssues: s.issue.linkedIssues.length,
      attachments: s.issue.attachments.length,
      attachmentsRead: s.issue.attachments.filter((a) => a.content).length,
    },
  };
}

function getSession(issueKey) {
  const s = sessions.get(issueKey);
  if (!s) throw badRequest(`No strategy for ${issueKey} in this session. Generate it first.`, 404);
  return s;
}

// ---------- Settings ----------
app.get('/api/settings', (req, res) => res.json(publicSettings()));

app.put('/api/settings', route(async (req, res) => {
  saveSettings(req.body);
  res.json({ ok: true, settings: publicSettings() });
}));

app.post('/api/test/jira', route(async (req, res) => {
  const name = await testJiraConnection(draftSettings(req.body).jira);
  res.json({ ok: true, message: `Connected as ${name}` });
}));

app.post('/api/test/groq', route(async (req, res) => {
  res.json({ ok: true, message: await testGroq(draftSettings(req.body).llm) });
}));

app.post('/api/test/ollama', route(async (req, res) => {
  res.json({ ok: true, message: await testOllama(draftSettings(req.body).llm) });
}));

// ---------- Strategy ----------
app.post('/api/strategy/generate', route(async (req, res) => {
  const issueKey = normalizeIssueKey(req.body.issueKey);
  const { jira, llm } = getSettings();
  const issue = await fetchIssue(jira, issueKey);
  const markdown = await generateStrategy(llm, issue, (step) => console.log(`${issueKey}: ${step}`));
  const files = await writeOutputs(issueKey, markdown);
  const s = { issueKey, issue, markdown, files, model: modelLabel(llm), approvalStatus: PENDING_STATUS, updatedAt: new Date().toISOString() };
  sessions.set(issueKey, s);
  console.log(`Generated strategy for ${issueKey} -> ${files.directory}/${files.md}, ${files.pdf}`);
  res.json(sessionResponse(s));
}));

app.post('/api/strategy/revise', route(async (req, res) => {
  const issueKey = normalizeIssueKey(req.body.issueKey);
  const changeRequest = String(req.body.changeRequest || '').trim();
  if (changeRequest.length < 3) throw badRequest('Describe the changes you want in the Test Strategy.');
  if (changeRequest.length > 4000) throw badRequest('Change request is too long (max 4000 characters).');
  const s = getSession(issueKey);
  const { llm } = getSettings();
  s.markdown = await reviseStrategy(llm, s.issue, s.markdown, changeRequest, (step) => console.log(`${issueKey} revision: ${step}`));
  s.files = await writeOutputs(issueKey, s.markdown);
  s.model = modelLabel(llm);
  s.approvalStatus = PENDING_STATUS;
  s.updatedAt = new Date().toISOString();
  console.log(`Revised strategy for ${issueKey}`);
  res.json(sessionResponse(s));
}));

app.post('/api/strategy/approve', route(async (req, res) => {
  const issueKey = normalizeIssueKey(req.body.issueKey);
  const approver = String(req.body.approver || '').trim();
  if (!/^[\p{L}][\p{L} .'-]{1,79}$/u.test(approver)) throw badRequest('Enter the approver name (letters, 2-80 characters).');
  const s = getSession(issueKey);
  const date = new Date().toISOString().slice(0, 10);
  s.approvalStatus = `Approved by ${approver} on ${date}`;
  s.markdown = setApprovalStatus(s.markdown, s.approvalStatus);
  s.files = await writeOutputs(issueKey, s.markdown);
  s.updatedAt = new Date().toISOString();
  console.log(`Strategy for ${issueKey} approved`);
  res.json(sessionResponse(s));
}));

app.get('/api/files/:name', route(async (req, res) => {
  const full = resolveOutputFile(req.params.name);
  res.download(full, req.params.name);
}));

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, message: 'Invalid JSON body.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, message: 'Request body too large.' });
  return next(err);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Test Strategy API running on http://127.0.0.1:${PORT}`);
  console.log(CONFIG_FILE ? `Loaded settings from ${CONFIG_FILE}` : 'config.env not found - configure settings in the UI.');
});
