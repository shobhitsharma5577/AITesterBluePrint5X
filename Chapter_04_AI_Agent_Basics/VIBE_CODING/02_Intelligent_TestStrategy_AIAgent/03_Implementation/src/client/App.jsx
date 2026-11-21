import React, { useEffect, useRef, useState } from 'react';
import { api, ISSUE_KEY_RE } from './api.js';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import StrategyView, { ApprovalGate } from './components/StrategyView.jsx';

const GearIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const formatDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const shortModel = (label = '') => label.split(' (')[0];

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const resultRef = useRef(null);
  const exportRef = useRef(null);

  useEffect(() => {
    const close = (e) => exportRef.current && !exportRef.current.contains(e.target) && setExportOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const runAction = async (label, text, fn, doneNotice) => {
    setBusy(label);
    setError('');
    setNotice('');
    setPrompt(text);
    try {
      const r = await fn();
      setResult(r);
      setNotice(doneNotice(r));
      resultRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const generate = (issueKey) =>
    runAction('Retrieving JIRA issue and generating Test Strategy section by section… This can take 1–3 minutes.',`Generate a Test Strategy for ${issueKey}`,
      () => api.generate(issueKey), (r) => `Saved ${r.files.md} and ${r.files.pdf} to ${r.files.directory}.`);

  const submit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (ISSUE_KEY_RE.test(text)) {
      generate(text.toUpperCase());
    } else if (result) {
      runAction('Updating Test Strategy with requested changes… This can take 1–3 minutes.', text,
        () => api.revise(result.issueKey, text), () => 'Strategy updated. Approval status reset to Pending Human Approval.');
    } else {
      setError('Enter a valid JIRA Issue ID, e.g. KAN-4.');
      return;
    }
    setInput('');
  };

  const approve = (approver) =>
    runAction('Recording approval…', `Approve Test Strategy for ${result.issueKey}`,
      () => api.approve(result.issueKey, approver), (r) => `${r.approvalStatus}. Files updated.`);

  return (
    <div className="page">
      <div className="window">
        <header className="topbar">
          <div className="brand">
            <span className="logo">QA</span>
            <h1>QA Assistant</h1>
          </div>
          <button className="gear" onClick={() => setSettingsOpen(true)} aria-label="Open settings" title="Settings"><GearIcon /></button>
        </header>

        <nav className="tabs">
          <button className="tab active">Test Strategy</button>
        </nav>

        <main className="content">
          <div className="content-head">
            <div>
              <h2>Test Strategy</h2>
              <p className="muted">
                {result
                  ? `Generated from JIRA ${result.issueKey} · Model: ${shortModel(result.model)} · Updated ${formatDate(result.generatedAt)}`
                  : 'Enter a JIRA Issue ID to generate a feature-specific Test Strategy.'}
              </p>
            </div>
            <div className="actions">
              <div className="export" ref={exportRef}>
                <button className="btn" disabled={!result?.files || !!busy} onClick={() => setExportOpen((o) => !o)}>Export</button>
                {exportOpen && result?.files && (
                  <div className="menu" role="menu">
                    <a href={api.fileUrl(result.files.md)} download onClick={() => setExportOpen(false)}>Markdown (.md)</a>
                    <a href={api.fileUrl(result.files.pdf)} download onClick={() => setExportOpen(false)}>PDF (.pdf)</a>
                  </div>
                )}
              </div>
              <button className="btn primary" disabled={!result || !!busy} onClick={() => generate(result.issueKey)}>Regenerate</button>
            </div>
          </div>

          <section className="result" ref={resultRef}>
            {prompt && <div className="bubble">{prompt}</div>}
            {busy && <p className="status muted"><span className="spinner" /> {busy}</p>}
            {error && <p className="status error">{error}</p>}
            {notice && !busy && <p className="status ok">✔ {notice}</p>}
            {result && !busy && (
              <>
                <StrategyView markdown={result.markdown} />
                <ApprovalGate key={`${result.issueKey}-${result.generatedAt}`} result={result} busy={!!busy} onApprove={approve} />
              </>
            )}
            {!result && !busy && !error && (
              <p className="muted empty">No strategy yet. Type a JIRA Issue ID (for example KAN-4) below.</p>
            )}
          </section>

          <form className="composer" onSubmit={submit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={result ? 'Type a JIRA Issue ID, or describe changes to this strategy' : 'Type a JIRA Issue ID (for example KAN-4)'}
              disabled={!!busy}
              aria-label="JIRA Issue ID or change request"
            />
            <span className="hint">Enter to send</span>
            <button className="send" type="submit" disabled={!!busy || !input.trim()} aria-label="Send">➤</button>
          </form>
        </main>
      </div>

      {settingsOpen && (
        <SettingsDrawer onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); setNotice('Settings saved.'); }} />
      )}
    </div>
  );
}
