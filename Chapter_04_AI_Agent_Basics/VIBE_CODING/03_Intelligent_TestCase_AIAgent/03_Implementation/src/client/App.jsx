import React, { useEffect, useState } from 'react';

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, message: `Request failed (HTTP ${res.status})` }));
}

const EMPTY_SETTINGS = {
  jira: { url: '', email: '', token: '' },
  llm: { provider: 'groq', groqKey: '', groqModel: '', ollamaUrl: '', ollamaModel: '' },
};

export default function App() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [envInfo, setEnvInfo] = useState(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Retry briefly: on `npm run dev` the browser can open before the API server is listening.
    const loadConfig = async (attempt = 0) => {
      const r = await fetch('/api/config');
      if (!r.ok) {
        if (attempt < 10) return new Promise((ok) => setTimeout(ok, 1000)).then(() => loadConfig(attempt + 1));
        throw new Error('API server not reachable');
      }
      return r.json();
    };
    loadConfig()
      .then((info) => {
        setEnvInfo(info);
        setSettings((s) => ({
          jira: { url: info.jiraUrl, email: info.jiraEmail, token: info.jiraToken },
          llm: {
            ...s.llm,
            groqKey: info.groqKey,
            groqModel: info.defaults.groqModel,
            ollamaUrl: info.defaults.ollamaUrl,
            ollamaModel: info.defaults.ollamaModel,
          },
        }));
      })
      .catch(() => setEnvInfo({ error: true }));
  }, []);

  return (
    <div className="page">
      <div className="window">
        <header className="topbar">
          <div className="brand">
            <span className="logo">QA</span>
            <h1>AI QA Assistant</h1>
          </div>
          <button className="gear" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
        </header>

        <nav className="tabs">
          <button className="tab active">
            Test Case <span className="count">{count}</span>
          </button>
        </nav>

        <TestCasePage settings={settings} onCount={setCount} />
      </div>

      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          envInfo={envInfo}
          onCancel={() => setSettingsOpen(false)}
          onSave={(next) => { setSettings(next); setSettingsOpen(false); }}
        />
      )}
    </div>
  );
}

/* ---------------- Test Case page ---------------- */
function TestCasePage({ settings, onCount }) {
  const [input, setInput] = useState('');
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function generate(issueKey) {
    const key = issueKey.trim().toUpperCase();
    if (!key) return;
    setRequest(key);
    setLoading(true);
    setError('');
    setResult(null);
    onCount(0);
    const data = await post('/api/generate', { issueKey: key, ...settings });
    setLoading(false);
    if (data.ok) {
      setResult(data);
      onCount(data.testCases.length);
    } else {
      setError(data.message || 'Something went wrong.');
    }
  }

  function submit(e) {
    e.preventDefault();
    if (loading || !input.trim()) return;
    generate(input);
    setInput('');
  }

  async function exportXlsx() {
    setExporting(true);
    setError('');
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueKey: result.issueKey, testCases: result.testCases, clarificationLog: result.clarificationLog }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${result.issueKey}_TestCases.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const updated = result
    ? new Date(result.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <main className="content">
      <div className="content-head">
        <div>
          <h2>Test Cases</h2>
          <p className="muted">
            {result
              ? `Generated from JIRA story ${result.issueKey} · Model: ${result.model} · Updated ${updated}`
              : 'Generated from JIRA story'}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={exportXlsx} disabled={!result || loading || exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          <button className="btn primary" onClick={() => generate(request)} disabled={!request || loading}>
            Regenerate
          </button>
        </div>
      </div>

      <section className="result">
        {request && <div className="bubble">{request}{result?.summary ? ` — ${result.summary}` : ''}</div>}

        {!request && <p className="muted">Type a JIRA story key below (for example KAN-4) to generate test cases.</p>}
        {loading && <p className="muted">Fetching {request} from JIRA and generating test cases…</p>}
        {error && <p className="status error">{error}</p>}

        {result && (
          <>
            <div className="table-wrap">
              <table className="tc-table">
                <thead>
                  <tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {result.testCases.map((tc, i) => (
                    <tr key={`${tc['TC ID']}-${i}`}>
                      {result.columns.map((c) => <td key={c} className={cellClass(c)}><Cell column={c} value={tc[c]} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Clarification Log</h3>
            {result.clarificationLog.length === 0 ? (
              <p className="muted">No clarifications recorded.</p>
            ) : (
              <div className="table-wrap">
                <table className="tc-table">
                  <thead>
                    <tr><th>Requirement ID</th><th>Ambiguity / Gap</th><th>Clarification Needed</th></tr>
                  </thead>
                  <tbody>
                    {result.clarificationLog.map((c, i) => (
                      <tr key={i}>
                        <td>{c['Requirement ID']}</td>
                        <td className="wide">{c['Ambiguity / Gap']}</td>
                        <td className="wide">{c['Clarification Needed']}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <form className="composer" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a JIRA story key (for example KAN-4)"
          aria-label="JIRA story key"
          disabled={loading}
        />
        <span className="hint">Enter to send</span>
        <button className="send" type="submit" aria-label="Send" disabled={loading || !input.trim()}>➤</button>
      </form>
    </main>
  );
}

const WIDE = ['Test Scenario', 'Test Case Title', 'Preconditions', 'Test Steps', 'Test Data', 'Expected Result', 'Comments'];
const cellClass = (c) => (WIDE.includes(c) ? 'wide' : c === 'TC ID' ? 'nowrap' : '');

function Cell({ column, value }) {
  if (!value) return null;
  if (column === 'Test Type') return <span className="pill type">{value}</span>;
  if (column === 'Priority') return <span className={`pill level-${value.toLowerCase()}`}>{value}</span>;
  if (column === 'Status') return <span className="pill status-pill">{value}</span>;
  return value;
}

/* ---------------- Settings drawer ---------------- */
function SettingsDrawer({ settings, envInfo, onCancel, onSave }) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState({});
  const { jira, llm } = draft;

  const setJira = (field) => (e) => setDraft((s) => ({ ...s, jira: { ...s.jira, [field]: e.target.value } }));
  const setLlm = (field) => (e) => setDraft((s) => ({ ...s, llm: { ...s.llm, [field]: e.target.value } }));
  const setProvider = (provider) => setDraft((s) => ({ ...s, llm: { ...s.llm, provider } }));

  async function runTest(name) {
    setStatus((s) => ({ ...s, [name]: { pending: true, message: 'Testing…' } }));
    const data = await post(`/api/test/${name}`, draft);
    setStatus((s) => ({ ...s, [name]: data }));
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <aside className="drawer" role="dialog" aria-label="Settings">
        <header className="drawer-head">
          <h2>Settings</h2>
          <button className="close" aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <div className="drawer-body">
          {envInfo?.configFile && <p className="muted small">Defaults loaded from {envInfo.configFile}.</p>}

          <section className="card">
            <h3>JIRA Connection</h3>
            <p className="muted small">Used to read stories and attach generated test artifacts.</p>
            <label>JIRA URL
              <input value={jira.url} onChange={setJira('url')} placeholder="https://yourcompany.atlassian.net" />
            </label>
            <label>Email
              <input value={jira.email} onChange={setJira('email')} placeholder="qa.user@yourcompany.com" />
            </label>
            <label>API Token
              <input type="password" value={jira.token} onChange={setJira('token')} placeholder="JIRA API token" />
            </label>
            <div className="test-row">
              <Status value={status.jira} />
              <button className="btn" onClick={() => runTest('jira')}>Test Connection</button>
            </div>
          </section>

          <section className="card">
            <h3>LLM Configuration</h3>
            <p className="muted small">Choose the model provider used to generate test artifacts.</p>
            <div className="providers">
              <label className={`provider ${llm.provider === 'ollama' ? 'selected' : ''}`}>
                <input type="radio" name="provider" checked={llm.provider === 'ollama'} onChange={() => setProvider('ollama')} />
                Ollama (local)
              </label>
              <label className={`provider ${llm.provider === 'groq' ? 'selected' : ''}`}>
                <input type="radio" name="provider" checked={llm.provider === 'groq'} onChange={() => setProvider('groq')} />
                Groq (cloud)
              </label>
            </div>

            {llm.provider === 'groq' ? (
              <>
                <label>Groq API Key
                  <input type="password" value={llm.groqKey} onChange={setLlm('groqKey')} placeholder="gsk_..." />
                </label>
                <label>Model
                  <input value={llm.groqModel} onChange={setLlm('groqModel')} />
                </label>
                <div className="test-row">
                  <Status value={status.groq} />
                  <button className="btn" onClick={() => runTest('groq')}>Test Groq</button>
                </div>
              </>
            ) : (
              <>
                <label>Ollama URL
                  <input value={llm.ollamaUrl} onChange={setLlm('ollamaUrl')} />
                </label>
                <label>Model
                  <input value={llm.ollamaModel} onChange={setLlm('ollamaModel')} />
                </label>
                <div className="test-row">
                  <Status value={status.ollama} />
                  <button className="btn" onClick={() => runTest('ollama')}>Test Ollama</button>
                </div>
              </>
            )}
          </section>
        </div>

        <footer className="drawer-foot">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(draft)}>Save Settings</button>
        </footer>
      </aside>
    </div>
  );
}

function Status({ value }) {
  if (!value) return <span />;
  const cls = value.pending ? 'muted' : value.ok ? 'ok' : 'error';
  return <p className={`status ${cls}`}>{value.ok && !value.pending ? '✔ ' : ''}{value.message}</p>;
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
