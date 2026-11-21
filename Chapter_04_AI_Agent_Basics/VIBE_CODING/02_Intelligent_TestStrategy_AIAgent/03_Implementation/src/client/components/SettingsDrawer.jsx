import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { jiraUrl: '', jiraEmail: '', jiraToken: '', provider: 'groq', groqKey: '', ollamaUrl: '', ollamaModel: '' };

function toDraft(f) {
  return {
    jira: { url: f.jiraUrl, email: f.jiraEmail, token: f.jiraToken },
    llm: { provider: f.provider, groqKey: f.groqKey, ollamaUrl: f.ollamaUrl, ollamaModel: f.ollamaModel },
  };
}

function Status({ state }) {
  if (!state) return <span />;
  if (state.loading) return <p className="status muted">Testing…</p>;
  return <p className={`status ${state.ok ? 'ok' : 'error'}`}>{state.ok ? '✔ ' : '✖ '}{state.message}</p>;
}

export default function SettingsDrawer({ onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ tokenConfigured: false, groqKeyConfigured: false, groqModel: '' });
  const [jiraStatus, setJiraStatus] = useState(null);
  const [llmStatus, setLlmStatus] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setForm({ ...EMPTY, jiraUrl: s.jira.url, jiraEmail: s.jira.email, provider: s.llm.provider, ollamaUrl: s.llm.ollamaUrl, ollamaModel: s.llm.ollamaModel });
        setMeta({ tokenConfigured: s.jira.tokenConfigured, groqKeyConfigured: s.llm.groqKeyConfigured, groqModel: s.llm.groqModel });
      })
      .catch((e) => setSaveError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const run = async (setter, fn) => {
    setter({ loading: true });
    try {
      const r = await fn(toDraft(form));
      setter({ ok: true, message: r.message });
    } catch (e) {
      setter({ ok: false, message: e.message });
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await api.saveSettings(toDraft(form));
      onSaved();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const isGroq = form.provider === 'groq';
  const secretPlaceholder = (configured) => (configured ? '•••••••••••••••• (configured — leave blank to keep)' : 'Not configured');

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label="Settings">
        <div className="drawer-head">
          <h2>Settings</h2>
          <button className="close" onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <div className="drawer-body">
          <section className="card">
            <h3>JIRA Connection</h3>
            <p className="small muted">Used to read stories and attach generated test artifacts.</p>
            <label>JIRA URL
              <input value={form.jiraUrl} onChange={set('jiraUrl')} placeholder="https://yourcompany.atlassian.net" />
            </label>
            <label>Email
              <input type="email" value={form.jiraEmail} onChange={set('jiraEmail')} placeholder="qa.user@yourcompany.com" />
            </label>
            <label>API Token
              <input type="password" value={form.jiraToken} onChange={set('jiraToken')} placeholder={secretPlaceholder(meta.tokenConfigured)} autoComplete="off" />
            </label>
            <div className="test-row">
              <Status state={jiraStatus} />
              <button className="btn" onClick={() => run(setJiraStatus, api.testJira)} disabled={jiraStatus?.loading}>Test Connection</button>
            </div>
          </section>

          <section className="card">
            <h3>LLM Configuration</h3>
            <p className="small muted">Choose the model provider used to generate test artifacts.</p>
            <div className="providers">
              {[['ollama', 'Ollama (local)'], ['groq', 'Groq (cloud)']].map(([value, label]) => (
                <label key={value} className={`provider ${form.provider === value ? 'selected' : ''}`}>
                  <input type="radio" name="provider" value={value} checked={form.provider === value}
                    onChange={() => { setForm((f) => ({ ...f, provider: value })); setLlmStatus(null); }} />
                  {label}
                </label>
              ))}
            </div>

            {isGroq ? (
              <label>Groq API Key
                <input type="password" value={form.groqKey} onChange={set('groqKey')} placeholder={secretPlaceholder(meta.groqKeyConfigured)} autoComplete="off" />
              </label>
            ) : (
              <>
                <label>Ollama URL
                  <input value={form.ollamaUrl} onChange={set('ollamaUrl')} placeholder="http://localhost:11434" />
                </label>
                <label>Ollama Model
                  <input value={form.ollamaModel} onChange={set('ollamaModel')} placeholder="llama3.1" />
                </label>
              </>
            )}
            <div className="test-row">
              <Status state={llmStatus} />
              <button className="btn" onClick={() => run(setLlmStatus, isGroq ? api.testGroq : api.testOllama)} disabled={llmStatus?.loading}>
                {isGroq ? 'Test Groq' : 'Test Ollama'}
              </button>
            </div>
          </section>
          {saveError && <p className="status error">{saveError}</p>}
        </div>

        <div className="drawer-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
        </div>
      </aside>
    </div>
  );
}
