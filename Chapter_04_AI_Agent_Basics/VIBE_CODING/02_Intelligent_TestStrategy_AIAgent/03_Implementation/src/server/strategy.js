// Test Strategy generation engine: builds prompts from the approved template,
// validates template compliance and owns the approval status line.
//
// The template is generated in fixed groups of sections (one LLM call each) so
// every request fits provider token-per-minute limits (e.g. Groq free tier).
// Groups are deterministic: same template + same JIRA data => same prompts.
import fs from 'node:fs';
import { TEMPLATE_PATH, badRequest } from './config.js';
import { callLLM } from './llm.js';

export const PENDING_STATUS = 'Pending Human Approval';
const SECTIONS_PER_CALL = 4;
const STATUS_LINE_RE = /^[ \t]*[-*]?[ \t]*\**[ \t]*Approval Status[ \t]*:?[ \t]*\**[ \t]*:?.*$/gim;

export function loadTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) throw badRequest('Test Strategy template not found: 02_Plan/Template/TestStrategy_Template.md', 500);
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8').replace(/\r\n/g, '\n');
  const sections = [];
  for (const line of template.split('\n')) {
    if (/^## /.test(line)) sections.push({ heading: line.trim(), body: [] });
    else if (sections.length) sections.at(-1).body.push(line);
  }
  if (sections.length === 0) throw badRequest('Test Strategy template has no "## " section headings.', 500);
  sections.forEach((s) => { s.body = s.body.join('\n').trim(); });
  return { sections, headings: sections.map((s) => s.heading) };
}

const SECTION_RULES = [
  [/Risk and Impact/i, 'Render the risk register as a Markdown table with columns: Risk / Impact | Likelihood | Business Priority | Test Area / Impact | Mitigation.'],
  [/Testing Coverage/i, 'List only applicable testing types; for each state what is validated and why it applies, with source. For a type that does not apply write "Not applicable —" plus reason.'],
  [/Test Approach/i, 'Define manual / automation approaches only where applicable. Name tools only if stated in the sources, else "Insufficient information to determine."'],
  [/Entry and Exit/i, "Keep the template's entry and exit criteria as bullet lists; make them measurable only where the sources support numbers."],
  [/Human Review and Approval/i, 'This section must contain these bold fields, each followed by bullet points: **Assumptions:**, **Information that could not be confirmed:**, **Blocking open questions:**, **Non-blocking questions:**, **Identified risks:**, **QA recommendations:**. Base them on gaps in the JIRA data. Do NOT write an approval status line; the system appends it.'],
];

function systemPrompt(group, allHeadings) {
  const rules = SECTION_RULES.filter(([re]) => group.some((s) => re.test(s.heading))).map(([, r]) => `- ${r}`);
  return `ROLE: Senior QA Lead and Test Strategy Architect (20+ years: requirement analysis, risk-based testing, test strategy).

TASK: Write part of a feature-specific Test Strategy for the JIRA issue supplied. The full document has these sections:
${allHeadings.join('\n')}
Write ONLY the sections in the TEMPLATE PART below.

METHOD (internal): analyse the business requirement, behaviour, acceptance criteria, impacted modules, dependencies and gaps; separate confirmed facts from assumptions; use only the supplied JIRA data.

FORMAT:
- Output exactly the headings of the TEMPLATE PART, verbatim and in order, and no other "#"/"##"/"###" headings.
- Keep each section's bold field labels and terminology; fill every field. Use bullet points and tables.
- Output only Markdown: no code fences, no preamble, no closing remarks.
- Do not write test cases, scripts or execution plans.
${rules.join('\n')}

EVIDENCE RULES (mandatory):
- Every feature-specific statement must be traceable; cite it in brackets, e.g. [Source: KAN-4 description], [Source: KAN-4 comment by <author>], [Source: <KEY> linked issue], [Source: attachment <file>].
- Never invent features, APIs, endpoints, error codes, UI elements, business rules, workflows, environment URLs, test accounts, tools, dates, owners or configuration. Do not assume typical behaviour; do not present assumptions as requirements.
- Missing information: write exactly "Insufficient information to determine."
- Unavoidable inference: prefix exactly "Inference (low confidence)".
- If sources conflict, state the conflict with both sources; do not resolve it silently.
- Attachments marked "Content not reviewed" were not read.
- Never include passwords, tokens or secrets.

TONE: technical, precise, evidence-based.`;
}

function templatePart(group) {
  return group.map((s) => `${s.heading}\n${s.body}`).join('\n\n');
}

// Compact JSON without empty fields keeps the request within token budgets.
function compactIssue(issue) {
  return JSON.stringify(issue, (k, v) => {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return undefined;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return undefined;
    return v;
  });
}

function cleanMarkdown(text) {
  let md = String(text).replace(/\r\n/g, '\n').trim();
  md = md.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
  const first = md.search(/^#{1,3}\s/m);
  if (first > 0) md = md.slice(first);
  return md;
}

/** Restores exact template heading text when the model kept the section number but altered wording. */
export function normalizeHeadings(markdown, headings) {
  const byNumber = new Map();
  for (const h of headings) {
    const m = h.match(/^## (\d+)\./);
    if (m) byNumber.set(m[1], h);
  }
  return markdown
    .split('\n')
    .map((line) => {
      const m = line.match(/^#{1,3}\s*(?:\*\*)?\s*(\d+)\.\s/);
      return m && byNumber.has(m[1]) ? byNumber.get(m[1]) : line;
    })
    .join('\n');
}

/** Returns a list of compliance problems (empty when compliant). */
export function checkCompliance(markdown, headings) {
  const found = markdown.split('\n').filter((l) => /^#{1,3} /.test(l)).map((l) => l.trim());
  const problems = [];
  const missing = headings.filter((h) => !found.includes(h));
  const extra = found.filter((h) => !headings.includes(h));
  if (missing.length) problems.push(`Missing or renamed headings: ${missing.join(' | ')}`);
  if (extra.length) problems.push(`Headings not in the template: ${extra.join(' | ')}`);
  if (!missing.length && !extra.length && found.join('\n') !== headings.join('\n')) problems.push('Headings are duplicated or out of template order.');
  return problems;
}

/** Replaces any approval status line with the system-controlled one. */
export function setApprovalStatus(markdown, statusText) {
  const body = markdown.replace(STATUS_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  return `${body}\n\n**Approval Status:** ${statusText}\n`;
}

function groups(sections) {
  const out = [];
  for (let i = 0; i < sections.length; i += SECTIONS_PER_CALL) out.push(sections.slice(i, i + SECTIONS_PER_CALL));
  return out;
}

async function generateGroup(llm, messages, groupHeadings) {
  let md = normalizeHeadings(cleanMarkdown(await callLLM(llm, messages)), groupHeadings);
  let problems = checkCompliance(md, groupHeadings);
  if (problems.length) {
    console.warn(`Template compliance issues (${groupHeadings[0]} ...), retrying once: ${problems.join('; ')}`);
    const retry = [...messages, { role: 'user', content: `A previous attempt violated the structure: ${problems.join('; ')}. Return exactly the TEMPLATE PART headings, in order, each fully populated.` }];
    md = normalizeHeadings(cleanMarkdown(await callLLM(llm, retry)), groupHeadings);
    problems = checkCompliance(md, groupHeadings);
    if (problems.length) throw badRequest(`Generated strategy did not comply with the template: ${problems.join('; ')}`, 502);
  }
  return md.replace(STATUS_LINE_RE, '').trim();
}

/**
 * Generates (or revises) the full strategy group by group.
 * @param current  existing markdown when revising, else null
 * @param change   reviewer change request when revising, else null
 */
async function buildStrategy(llm, issue, current, change, onProgress) {
  const { sections, headings } = loadTemplate();
  const issueText = compactIssue(issue);
  const parts = [];
  const all = groups(sections);
  for (const [i, group] of all.entries()) {
    onProgress?.(`Generating sections ${i + 1}/${all.length}`);
    const groupHeadings = group.map((s) => s.heading);
    const messages = [
      { role: 'system', content: systemPrompt(group, headings) },
      { role: 'user', content: `JIRA issue data (JSON) - the only evidence available:\n${issueText}\n\nTEMPLATE PART:\n${templatePart(group)}` },
    ];
    if (current) {
      messages.push({
        role: 'user',
        content: `CURRENT VERSION of these sections:\n${extractSections(current, groupHeadings, headings)}\n\nHuman reviewer change request:\n"""${change}"""\nReturn the updated sections. Apply the request only where it is consistent with the evidence rules; otherwise keep "Insufficient information to determine." or record it as an open question. Leave sections unaffected by the request unchanged.`,
      });
    }
    parts.push(await generateGroup(llm, messages, groupHeadings));
  }
  const markdown = parts.join('\n\n');
  const problems = checkCompliance(markdown, headings);
  if (problems.length) throw badRequest(`Generated strategy did not comply with the template: ${problems.join('; ')}`, 502);
  return setApprovalStatus(markdown, PENDING_STATUS);
}

function extractSections(markdown, wanted, allHeadings) {
  const lines = markdown.replace(STATUS_LINE_RE, '').split('\n');
  const out = [];
  let keep = false;
  for (const line of lines) {
    if (allHeadings.includes(line.trim())) keep = wanted.includes(line.trim());
    if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

export function generateStrategy(llm, issue, onProgress) {
  return buildStrategy(llm, issue, null, null, onProgress);
}

export function reviseStrategy(llm, issue, currentMarkdown, changeRequest, onProgress) {
  return buildStrategy(llm, issue, currentMarkdown, changeRequest, onProgress);
}
