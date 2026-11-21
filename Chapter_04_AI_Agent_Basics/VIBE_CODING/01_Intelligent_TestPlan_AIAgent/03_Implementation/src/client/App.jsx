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

// Number of test scenarios (TS-n rows) in the generated plan, shown on the tab.
const countScenarios = (markdown) => (markdown.match(/^\|\s*TS-\d+\s*\|/gm) || []).length;

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
            Test Plan <span className="count">{count}</span>
          </button>
        </nav>

        <TestPlanPage settings={settings} onCount={setCount} />
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

/* ---------------- Test Plan page ---------------- */
function TestPlanPage({ settings, onCount }) {
  const [input, setInput] = useState('');
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const planRef = useRef(null);

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
      onCount(countScenarios(data.markdown));
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

  function downloadMarkdown() {
    setMenuOpen(false);
    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${result.issueKey}_TestPlan.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportPdf() {
    setMenuOpen(false);
    setExporting(true);
    setError('');
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf()
        .set({
          margin: 10,
          filename: `${result.issueKey}_TestPlan.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(planRef.current)
        .save();
    } catch (err) {
      setError(`PDF export failed: ${err.message}`);
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
          <h2>Test Plan</h2>
          <p className="muted">
            {result
              ? `Generated from JIRA story ${result.issueKey} · Model: ${result.model} · Updated ${updated} · Saved to ${result.savedAs}`
              : 'Generated from JIRA story'}
          </p>
        </div>
        <div className="actions">
          <div className="menu-wrap">
            <button
              className="btn"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={!result || loading || exporting}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {exporting ? 'Exporting…' : 'Export ▾'}
            </button>
            {menuOpen && (
              <div className="menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                <button role="menuitem" onClick={exportPdf}>PDF (.pdf)</button>
                <button role="menuitem" onClick={downloadMarkdown}>Markdown (.md)</button>
              </div>
            )}
          </div>
          <button className="btn primary" onClick={() => generate(request)} disabled={!request || loading}>
            Regenerate
          </button>
        </div>
      </div>

      <section className="result">
        {request && <div className="bubble">{request}{result?.summary ? ` — ${result.summary}` : ''}</div>}

        {!request && <p className="muted">Type a JIRA story key below (for example KAN-4) to generate a test plan.</p>}
        {loading && <p className="muted">Fetching {request} from JIRA and generating the test plan…</p>}
        {error && <p className="status error">{error}</p>}

        {result && (
          <article
            ref={planRef}
            className="markdown"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(result.markdown)) }}
          />
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
