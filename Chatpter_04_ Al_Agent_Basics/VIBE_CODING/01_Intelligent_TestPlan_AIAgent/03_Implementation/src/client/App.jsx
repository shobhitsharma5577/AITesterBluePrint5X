import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
  const [view, setView] = useState('main');
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [envInfo, setEnvInfo] = useState(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
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
    <div className="app">
      <header className="topbar">
        <h1>Test Plan AI Agent</h1>
        {view === 'main' ? (
          <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => setView('settings')}>
            ⚙
          </button>
        ) : (
          <button className="btn" onClick={() => setView('main')}>← Back</button>
        )}
      </header>
      {view === 'main' ? (
        <MainPage settings={settings} />
      ) : (
        <SettingsPage settings={settings} setSettings={setSettings} envInfo={envInfo} />
      )}
    </div>
  );
}

/* ---------------- Main page ---------------- */
function MainPage({ settings }) {
  const [issueKey, setIssueKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const replyRef = useRef(null);

  async function generate(e) {
    e.preventDefault();
    if (!issueKey.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    const data = await post('/api/generate', { issueKey, ...settings });
    setLoading(false);
    if (data.ok) setResult(data);
    else setError(data.message || 'Something went wrong.');
  }

  function downloadMarkdown() {
    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${result.issueKey}_TestPlan.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportPdf() {
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf()
      .set({
        margin: 10,
        filename: `${result.issueKey}_TestPlan.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(replyRef.current)
      .save();
  }

  return (
    <main className="main">
      <section className="reply">
        {loading && <p className="muted">Fetching {issueKey.toUpperCase()} from JIRA and generating the test plan…</p>}
        {error && <p className="status error">{error}</p>}
        {!loading && !error && !result && (
          <p className="muted">Enter a JIRA ID below (e.g. KAN-4) to generate a test plan.</p>
        )}
        {result && (
          <>
            <div className="toolbar">
              <span className="muted">Saved to {result.savedAs}</span>
              <button className="btn" onClick={downloadMarkdown}>Download .md</button>
              <button className="btn primary" onClick={exportPdf}>Export PDF</button>
            </div>
            <article
              ref={replyRef}
              className="markdown"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(result.markdown)) }}
            />
          </>
        )}
      </section>

      <form className="prompt" onSubmit={generate}>
        <input
          value={issueKey}
          onChange={(e) => setIssueKey(e.target.value)}
          placeholder="Enter JIRA ID, e.g. KAN-4"
          aria-label="JIRA ID"
          disabled={loading}
        />
        <button className="btn primary" type="submit" disabled={loading || !issueKey.trim()}>
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </form>
    </main>
  );
}

/* ---------------- Settings page ---------------- */
function SettingsPage({ settings, setSettings, envInfo }) {
  const [status, setStatus] = useState({});
  const { jira, llm } = settings;

  const setJira = (field) => (e) => setSettings((s) => ({ ...s, jira: { ...s.jira, [field]: e.target.value } }));
  const setLlm = (field) => (e) => setSettings((s) => ({ ...s, llm: { ...s.llm, [field]: e.target.value } }));

  async function runTest(name) {
    setStatus((s) => ({ ...s, [name]: { pending: true, message: 'Testing…' } }));
    const data = await post(`/api/test/${name}`, settings);
    setStatus((s) => ({ ...s, [name]: data }));
  }

  return (
    <main className="settings">
      {envInfo?.configFile && <p className="muted">Defaults loaded from {envInfo.configFile}. Values typed here override them for this session.</p>}

      <section className="card">
        <h2>JIRA Connection</h2>
        <label>Token
          <input type="password" value={jira.token} onChange={setJira('token')}
            placeholder="JIRA API token" />
        </label>
        <label>URL
          <input value={jira.url} onChange={setJira('url')} placeholder="https://your-site.atlassian.net" />
        </label>
        <label>Email
          <input value={jira.email} onChange={setJira('email')} placeholder="you@example.com" />
        </label>
        <button className="btn" onClick={() => runTest('jira')}>Test Connection</button>
        <Status value={status.jira} />
      </section>

      <section className="card">
        <h2>LLM Configuration</h2>

        <label className="radio">
          <input type="radio" name="provider" checked={llm.provider === 'ollama'}
            onChange={() => setSettings((s) => ({ ...s, llm: { ...s.llm, provider: 'ollama' } }))} />
          1. Ollama Configuration
        </label>
        <div className={`sub ${llm.provider !== 'ollama' ? 'disabled' : ''}`}>
          <label>Ollama URL
            <input value={llm.ollamaUrl} onChange={setLlm('ollamaUrl')} disabled={llm.provider !== 'ollama'} />
          </label>
          <label>Model
            <input value={llm.ollamaModel} onChange={setLlm('ollamaModel')} disabled={llm.provider !== 'ollama'} />
          </label>
          <button className="btn" onClick={() => runTest('ollama')} disabled={llm.provider !== 'ollama'}>Test Ollama</button>
          <Status value={status.ollama} />
        </div>

        <label className="radio">
          <input type="radio" name="provider" checked={llm.provider === 'groq'}
            onChange={() => setSettings((s) => ({ ...s, llm: { ...s.llm, provider: 'groq' } }))} />
          2. GROQ Configuration
        </label>
        <div className={`sub ${llm.provider !== 'groq' ? 'disabled' : ''}`}>
          <label>API Key
            <input type="password" value={llm.groqKey} onChange={setLlm('groqKey')} disabled={llm.provider !== 'groq'}
              placeholder="gsk_..." />
          </label>
          <label>Model
            <input value={llm.groqModel} onChange={setLlm('groqModel')} disabled={llm.provider !== 'groq'} />
          </label>
          <button className="btn" onClick={() => runTest('groq')} disabled={llm.provider !== 'groq'}>Test GROQ</button>
          <Status value={status.groq} />
        </div>
      </section>
    </main>
  );
}

function Status({ value }) {
  if (!value) return null;
  const cls = value.pending ? 'muted' : value.ok ? 'ok' : 'error';
  return <p className={`status ${cls}`}>{value.message}</p>;
}
