// Configuration: loads config.env (searched upward from src/) and keeps
// runtime settings in server memory. Secrets never leave the backend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.resolve(__dirname, '..');
export const AGENT_DIR = path.resolve(SRC_DIR, '../..');
export const TEMPLATE_PATH = path.join(AGENT_DIR, '02_Plan/Template/TestStrategy_Template.md');
export const OUTPUT_DIR = path.join(AGENT_DIR, '02_Plan/Output');
export const PORT = Number(process.env.PORT) || 3003;

const DEFAULTS = {
  groqModel: 'openai/gpt-oss-120b',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
};

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
    // Tolerates "KEY =value" and quoted values.
    const key = trimmed.slice(0, idx).trim();
    env[key] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

export const CONFIG_FILE = findConfigFile(SRC_DIR);
const ENV = { ...loadEnvFile(CONFIG_FILE), ...pickProcessEnv() };

function pickProcessEnv() {
  const keys = ['JIRA_URL', 'JIRA_EMAIL', 'JIRA_TOKEN', 'GROQ_API_KEY', 'GROQ_MODEL', 'OLLAMA_URL', 'OLLAMA_MODEL', 'LLM_PROVIDER'];
  return Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

const stripSlash = (v) => String(v || '').trim().replace(/\/+$/, '');

// Active settings (in memory). Initialised from config.env.
const settings = {
  jira: { url: stripSlash(ENV.JIRA_URL), email: ENV.JIRA_EMAIL || '', token: ENV.JIRA_TOKEN || '' },
  llm: {
    provider: ENV.LLM_PROVIDER === 'ollama' ? 'ollama' : 'groq',
    groqKey: ENV.GROQ_API_KEY || '',
    groqModel: ENV.GROQ_MODEL || DEFAULTS.groqModel,
    ollamaUrl: stripSlash(ENV.OLLAMA_URL || DEFAULTS.ollamaUrl),
    ollamaModel: ENV.OLLAMA_MODEL || DEFAULTS.ollamaModel,
  },
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Merge a draft from the Settings page onto the active settings.
 * Empty secret fields mean "keep the configured value".
 */
export function mergeSettings(draft = {}) {
  const j = draft.jira || {};
  const l = draft.llm || {};
  return {
    jira: {
      url: str(j.url) ? stripSlash(j.url) : settings.jira.url,
      email: str(j.email) || settings.jira.email,
      token: str(j.token) || settings.jira.token,
    },
    llm: {
      provider: l.provider === 'ollama' ? 'ollama' : l.provider === 'groq' ? 'groq' : settings.llm.provider,
      groqKey: str(l.groqKey) || settings.llm.groqKey,
      groqModel: settings.llm.groqModel,
      ollamaUrl: str(l.ollamaUrl) ? stripSlash(l.ollamaUrl) : settings.llm.ollamaUrl,
      ollamaModel: str(l.ollamaModel) || settings.llm.ollamaModel,
    },
  };
}

export function validateSettings(s) {
  if (s.jira.url && !/^https:\/\/[^\s/]+/i.test(s.jira.url)) throw badRequest('JIRA URL must start with https://');
  if (s.jira.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.jira.email)) throw badRequest('JIRA Email is not a valid email address.');
  if (s.llm.provider === 'ollama' && !/^https?:\/\/[^\s/]+/i.test(s.llm.ollamaUrl)) throw badRequest('Ollama URL must start with http:// or https://');
}

export function saveSettings(draft) {
  const next = mergeSettings(draft);
  validateSettings(next);
  settings.jira = next.jira;
  settings.llm = next.llm;
}

export function getSettings() {
  return settings;
}

/** Non-secret view of settings for the UI. */
export function publicSettings() {
  return {
    configFile: CONFIG_FILE ? path.basename(CONFIG_FILE) : null,
    jira: { url: settings.jira.url, email: settings.jira.email, tokenConfigured: Boolean(settings.jira.token) },
    llm: {
      provider: settings.llm.provider,
      groqModel: settings.llm.groqModel,
      groqKeyConfigured: Boolean(settings.llm.groqKey),
      ollamaUrl: settings.llm.ollamaUrl,
      ollamaModel: settings.llm.ollamaModel,
    },
  };
}

/** Remove any configured secret from text before it reaches logs or the UI. */
export function redact(text) {
  let out = String(text ?? '');
  for (const secret of [settings.jira.token, settings.llm.groqKey, ENV.JIRA_TOKEN, ENV.GROQ_API_KEY]) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

export function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function modelLabel(llm) {
  return llm.provider === 'groq' ? `Groq (${llm.groqModel})` : `Ollama (${llm.ollamaModel})`;
}
