// JIRA integration: fetches an issue and its available requirement sources.
// Only data actually returned by JIRA is passed on; nothing is fabricated.
import { badRequest } from './config.js';

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_LINKED = 10;
const MAX_ATTACHMENT_BYTES = 200 * 1024;
const MAX_ATTACHMENT_CHARS = 20000;
const TEXT_ATTACHMENT_RE = /^(text\/|application\/(json|xml|x-yaml|yaml|csv))/i;
const TEXT_EXT_RE = /\.(txt|md|markdown|csv|json|xml|ya?ml|feature|gherkin)$/i;

export function normalizeIssueKey(raw) {
  const key = String(raw || '').trim().toUpperCase();
  if (!ISSUE_KEY_RE.test(key)) throw badRequest('Enter a valid JIRA Issue ID, e.g. KAN-4.');
  return key;
}

function requireJira(jira) {
  if (!jira.url || !jira.email || !jira.token) {
    throw badRequest('JIRA URL, Email and API Token must be configured (config.env or Settings).');
  }
}

function authHeader(jira) {
  return `Basic ${Buffer.from(`${jira.email}:${jira.token}`).toString('base64')}`;
}

async function jiraFetch(jira, url, accept = 'application/json') {
  requireJira(jira);
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: authHeader(jira), Accept: accept },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw badRequest(`JIRA service is unreachable at ${jira.url}. Check the JIRA URL and network.`, 502);
  }
  if (res.status === 401) throw badRequest('JIRA authentication failed (HTTP 401). Check the JIRA Email and API Token.', 401);
  if (res.status === 403) throw badRequest('JIRA permission denied (HTTP 403). The configured account cannot access this resource.', 403);
  if (res.status === 404) throw badRequest('JIRA issue not found (HTTP 404). Check the Issue ID, or the account may lack permission to view it.', 404);
  if (res.status >= 500) throw badRequest(`JIRA service unavailable (HTTP ${res.status}). Try again later.`, 502);
  if (!res.ok) throw badRequest(`JIRA request failed (HTTP ${res.status}).`, 502);
  return res;
}

async function jiraGet(jira, apiPath) {
  const res = await jiraFetch(jira, `${jira.url}${apiPath}`);
  return res.json();
}

export async function testJiraConnection(jira) {
  const me = await jiraGet(jira, '/rest/api/2/myself');
  return me.displayName || me.emailAddress || 'JIRA user';
}

function simplify(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(simplify).filter((v) => v != null);
  if (typeof value === 'object') return value.value || value.name || value.displayName || null;
  return value;
}

function linkedIssueRefs(fields) {
  return (fields.issuelinks || [])
    .map((l) => {
      const other = l.outwardIssue || l.inwardIssue;
      if (!other) return null;
      return { relation: l.outwardIssue ? l.type?.outward : l.type?.inward, key: other.key, summary: other.fields?.summary };
    })
    .filter(Boolean);
}

async function fetchLinkedIssue(jira, ref) {
  try {
    const d = await jiraGet(jira, `/rest/api/2/issue/${encodeURIComponent(ref.key)}?fields=summary,description,status,issuetype`);
    return {
      relation: ref.relation,
      key: d.key,
      issueType: d.fields?.issuetype?.name,
      status: d.fields?.status?.name,
      summary: d.fields?.summary,
      description: d.fields?.description || null,
    };
  } catch (err) {
    return { ...ref, retrievalNote: `Details not retrievable: ${err.message}` };
  }
}

async function fetchAttachment(jira, a) {
  const meta = { filename: a.filename, mimeType: a.mimeType, sizeBytes: a.size, created: a.created };
  const isText = TEXT_ATTACHMENT_RE.test(a.mimeType || '') || TEXT_EXT_RE.test(a.filename || '');
  if (!isText) return { ...meta, contentNote: 'Content not extracted (non-text format). Content not reviewed.' };
  if (a.size > MAX_ATTACHMENT_BYTES) return { ...meta, contentNote: 'Content not extracted (file exceeds size limit). Content not reviewed.' };
  try {
    const res = await jiraFetch(jira, a.content, '*/*');
    let text = await res.text();
    const truncated = text.length > MAX_ATTACHMENT_CHARS;
    if (truncated) text = text.slice(0, MAX_ATTACHMENT_CHARS);
    return { ...meta, content: text, ...(truncated ? { contentNote: 'Content truncated.' } : {}) };
  } catch (err) {
    return { ...meta, contentNote: `Content not retrievable: ${err.message}` };
  }
}

/** Fetch an issue with all accessible requirement sources. */
export async function fetchIssue(jira, issueKey) {
  const data = await jiraGet(jira, `/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=names`);
  const f = data.fields || {};
  const names = data.names || {};

  // Custom fields that may carry requirement information.
  const customFields = {};
  for (const [id, label] of Object.entries(names)) {
    if (!id.startsWith('customfield_') || f[id] == null) continue;
    if (/acceptance|criteria|user story|story point|sprint|epic|team|requirement/i.test(label)) {
      const v = simplify(f[id]);
      if (v != null && !(Array.isArray(v) && v.length === 0)) customFields[label] = v;
    }
  }

  // Comments (paginate in case the issue payload holds only the first page).
  let comments = f.comment?.comments || [];
  if (f.comment && f.comment.total > comments.length) {
    try {
      const c = await jiraGet(jira, `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100`);
      comments = c.comments || comments;
    } catch { /* keep the first page */ }
  }

  const refs = linkedIssueRefs(f);
  const linkedIssues = await Promise.all(refs.slice(0, MAX_LINKED).map((r) => fetchLinkedIssue(jira, r)));

  let parent = null;
  if (f.parent?.key) parent = await fetchLinkedIssue(jira, { relation: 'parent', key: f.parent.key, summary: f.parent.fields?.summary });

  const attachments = await Promise.all((f.attachment || []).map((a) => fetchAttachment(jira, a)));

  return {
    key: data.key,
    source: `JIRA ${data.key}`,
    summary: f.summary || null,
    issueType: f.issuetype?.name || null,
    status: f.status?.name || null,
    priority: f.priority?.name || null,
    project: f.project?.name || null,
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    environment: f.environment || null,
    description: f.description || null,
    customFields,
    parent,
    subtasks: (f.subtasks || []).map((s) => ({ key: s.key, summary: s.fields?.summary, status: s.fields?.status?.name })),
    linkedIssues,
    linkedIssuesOmitted: Math.max(0, refs.length - MAX_LINKED),
    comments: comments.map((c) => ({ author: c.author?.displayName || 'Unknown', created: c.created, body: c.body })),
    attachments,
  };
}
