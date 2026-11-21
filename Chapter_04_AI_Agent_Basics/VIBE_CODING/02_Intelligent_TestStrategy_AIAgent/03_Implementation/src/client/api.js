// Thin API client. The backend never returns secrets.
async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the backend server. Is it running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || `Request failed (HTTP ${res.status}).`);
  return data;
}

export const api = {
  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (draft) => request('PUT', '/api/settings', draft),
  testJira: (draft) => request('POST', '/api/test/jira', draft),
  testGroq: (draft) => request('POST', '/api/test/groq', draft),
  testOllama: (draft) => request('POST', '/api/test/ollama', draft),
  generate: (issueKey) => request('POST', '/api/strategy/generate', { issueKey }),
  revise: (issueKey, changeRequest) => request('POST', '/api/strategy/revise', { issueKey, changeRequest }),
  approve: (issueKey, approver) => request('POST', '/api/strategy/approve', { issueKey, approver }),
  fileUrl: (name) => `/api/files/${encodeURIComponent(name)}`,
};

export const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
