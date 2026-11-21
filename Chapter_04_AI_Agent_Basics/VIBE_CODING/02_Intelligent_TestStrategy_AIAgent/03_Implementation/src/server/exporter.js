// Output files: writes <KEY>_TestStrategy.md and a PDF rendered from the
// same Markdown (headings, lists, tables and emphasis preserved).
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import PdfPrinter from 'pdfmake';
import { OUTPUT_DIR, badRequest } from './config.js';

const FILE_RE = /^[A-Z][A-Z0-9_]*-\d+_TestStrategy\.(md|pdf)$/;
const COLORS = { primary: '#8b1e3f', text: '#1f2328', muted: '#6b7280', border: '#e1e4e8', head: '#f4f5f7' };

const printer = new PdfPrinter({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
});

export function fileNames(issueKey) {
  return { md: `${issueKey}_TestStrategy.md`, pdf: `${issueKey}_TestStrategy.pdf` };
}

export function resolveOutputFile(name) {
  if (!FILE_RE.test(name)) throw badRequest('Invalid file name.');
  const full = path.join(OUTPUT_DIR, name);
  if (!fs.existsSync(full)) throw badRequest('File not found. Generate the strategy first.', 404);
  return full;
}

// Standard PDF fonts only cover WinAnsi; map common Unicode punctuation.
function pdfText(s) {
  return String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/→/g, '->').replace(/←/g, '<-').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=')
    .replace(/↔/g, '<->').replace(/[⇒]/g, '=>').replace(/≠/g, '!=').replace(/×/g, 'x')
    .replace(/[✓✔]/g, 'v').replace(/[✗✘]/g, 'x')
    .replace(/[  -   　]/g, ' ').replace(/[​-‍⁠﻿]/g, '')
    .replace(/[‐‑‒]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€™]/g, '?');
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function inline(tokens = [], style = {}) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'strong': out.push(...inline(t.tokens, { ...style, bold: true })); break;
      case 'em': out.push(...inline(t.tokens, { ...style, italics: true })); break;
      case 'del': out.push(...inline(t.tokens, { ...style, decoration: 'lineThrough' })); break;
      case 'codespan': out.push({ text: pdfText(decode(t.text)), font: 'Courier', fontSize: 9, ...style }); break;
      case 'link': out.push(...inline(t.tokens, { ...style, color: COLORS.primary })); break;
      case 'br': out.push({ text: '\n' }); break;
      case 'text':
        if (t.tokens) out.push(...inline(t.tokens, style));
        else out.push({ text: pdfText(decode(t.text)), ...style });
        break;
      case 'escape': out.push({ text: pdfText(t.text), ...style }); break;
      default: out.push({ text: pdfText(decode(t.raw || '')), ...style });
    }
  }
  return out;
}

function listItemContent(item) {
  const stack = [];
  for (const t of item.tokens || []) {
    if (t.type === 'text') stack.push({ text: inline(t.tokens || [{ type: 'text', text: t.text }]), margin: [0, 0, 0, 2] });
    else stack.push(...blocks([t]));
  }
  return stack.length === 1 ? stack[0] : { stack };
}

function blocks(tokens) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const size = { 1: 18, 2: 14, 3: 12 }[t.depth] || 11;
        out.push({ text: inline(t.tokens), fontSize: size, bold: true, color: t.depth <= 2 ? COLORS.primary : COLORS.text, margin: [0, t.depth <= 2 ? 14 : 10, 0, 6] });
        break;
      }
      case 'paragraph': out.push({ text: inline(t.tokens), margin: [0, 0, 0, 6] }); break;
      case 'list': {
        const items = t.items.map(listItemContent);
        out.push(t.ordered ? { ol: items, start: t.start || 1, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] });
        break;
      }
      case 'table': {
        const header = t.header.map((c) => ({ text: inline(c.tokens), bold: true, fillColor: COLORS.head, color: COLORS.muted }));
        const rows = t.rows.map((r) => r.map((c) => ({ text: inline(c.tokens) })));
        out.push({
          table: { headerRows: 1, widths: header.map(() => '*'), body: [header, ...rows] },
          layout: {
            hLineColor: () => COLORS.border, vLineColor: () => COLORS.border,
            paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
          },
          fontSize: 9, margin: [0, 2, 0, 8],
        });
        break;
      }
      case 'blockquote': out.push({ stack: blocks(t.tokens), margin: [12, 0, 0, 6], color: COLORS.muted }); break;
      case 'code': out.push({ text: pdfText(t.text), font: 'Courier', fontSize: 9, margin: [0, 0, 0, 6] }); break;
      case 'hr':
        out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: COLORS.border }], margin: [0, 6, 0, 6] });
        break;
      case 'space': break;
      case 'html': out.push({ text: pdfText(t.text.replace(/<[^>]+>/g, '')), margin: [0, 0, 0, 6] }); break;
      default: if (t.raw?.trim()) out.push({ text: pdfText(t.raw), margin: [0, 0, 0, 6] });
    }
  }
  return out;
}

function renderPdf(markdown, filePath) {
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.25, color: COLORS.text },
    content: blocks(marked.lexer(markdown, { gfm: true })),
    footer: (page, pages) => ({ text: `Page ${page} of ${pages}`, alignment: 'center', fontSize: 8, color: COLORS.muted }),
  };
  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition);
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

/** Writes both files and verifies they exist and are non-empty. */
export async function writeOutputs(issueKey, markdown) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const names = fileNames(issueKey);
  const mdPath = path.join(OUTPUT_DIR, names.md);
  const pdfPath = path.join(OUTPUT_DIR, names.pdf);
  fs.writeFileSync(mdPath, markdown, 'utf8');
  try {
    await renderPdf(markdown, pdfPath);
  } catch (err) {
    throw badRequest(`PDF generation failed: ${err.message}`, 500);
  }
  for (const p of [mdPath, pdfPath]) {
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) throw badRequest(`Output file was not written: ${path.basename(p)}`, 500);
  }
  return { md: names.md, pdf: names.pdf, directory: '02_Plan/Output' };
}
