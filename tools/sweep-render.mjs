#!/usr/bin/env node
// sweep-render.mjs
// For each field in FORM_SCHEMA, generate a realistic worst-case dummy value,
// compute its width using the embedded font, and check whether it would
// leak out of the assigned cell (per cells-calibrated.json).
// Writes ./sweep-report.md
//
// Run: node tools/sweep-render.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PAD_LEFT = 2;  // pt — leakage threshold from left
const PAD_RIGHT = 2; // pt — leakage threshold from right

// === Load FORM_SCHEMA from details.html ===
const html = readFileSync(join(ROOT, 'details.html'), 'utf8');
const m = html.match(/const FORM_SCHEMA = (\{[\s\S]*?\n\});\n/);
if(!m) throw new Error('FORM_SCHEMA not found');
const schemaSrc = 'export const FORM_SCHEMA = ' + m[1] + ';';
const tmpUrl = 'data:text/javascript;base64,' + Buffer.from(schemaSrc).toString('base64');
const { FORM_SCHEMA } = await import(tmpUrl);

// === Load cells ===
const cells = JSON.parse(readFileSync(join(ROOT, 'cells-calibrated.json'), 'utf8'));
const cellsByPage = {};
for(let p=0; p<cells.length; p++) cellsByPage[p] = cells[p];

// === Load Heebo font (the app uses Heebo-Bold for everything) ===
const fontBytes = readFileSync(join(ROOT, 'fonts/Heebo-Bold.ttf'));
const pdfDoc = await PDFDocument.create();
pdfDoc.registerFontkit(fontkit);
const font = await pdfDoc.embedFont(fontBytes, { subset: true });

// Build hardcoded table cols (mirrors details.html lines ~1310-1330)
const TABLE_COLS = {
  income: [
    { col: 'p', rightEdge: 439.1, maxWidth: 100, size: 9 },
    { col: 'g', rightEdge: 290.1, maxWidth: 90,  size: 9 },
    { col: 'n', rightEdge: 153.8, maxWidth: 76,  size: 9 },
  ],
  children: [
    { col: 'name',   rightEdge: 446.2, maxWidth: 145, size: 9 },
    { col: 'age',    rightEdge: 297.1, maxWidth: 85,  size: 9 },
    { col: 'amount', rightEdge: 211.3, maxWidth: 130, size: 9 },
  ]
};

// Worst-case sample values per field type — sized to cell width
function sampleFor(field){
  const id = field.id || '';
  const mw = field.maxWidth || 100;
  // Row-number cells (auto-generated narrow cells) — just a digit
  if(mw < 35) return '1';
  if(/(_id|teud)/.test(id) || /תעודת זהות|מס.?\s*זהות/.test(field.label||'')) return '039187877';
  if(/(_amount|_g_|_n_|monthly_alimony|last_payment_amount|vehicle_value|_inc$|salary)/.test(id)) return '12,345';
  if(/(_p_\d|date|birth|marriage|payment_date|_dt$|period)/.test(id)) return '01/26';
  if(/(_age$|_age_)/.test(id)) return '12';
  if(/(_deps$)/.test(id)) return '4';
  // Long text fields — size sample to ~80% of available width
  if(mw > 200) return 'דמה ארוך מאוד של שם או כתובת לבדיקה';
  if(mw > 120) return 'דמה ארוך לבדיקה';
  if(mw > 70) return 'אבחנהקליםעד';
  return 'דמהדמה';
}

function nearestCell(page, x, y){
  const arr = cellsByPage[page] || [];
  let best = null, bestD = Infinity;
  for(const c of arr){
    if(c.adj_x_right == null || c.adj_y_baseline == null) continue;
    const dx = c.adj_x_right - x;
    const dy = c.adj_y_baseline - y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if(d < bestD){ bestD = d; best = c; }
  }
  return best ? { cell: best, distance: bestD } : null;
}

const leaks = [];
const examined = [];

function checkField(idLabel, page, rightEdge, y, sampleText, size){
  const width = font.widthOfTextAtSize(sampleText, size);
  const textLeftEdge = rightEdge - width;
  const near = nearestCell(page, rightEdge, y);
  const result = {
    id: idLabel,
    page,
    rightEdge,
    y,
    sample: sampleText,
    sample_width: +width.toFixed(2),
    text_left: +textLeftEdge.toFixed(2),
    cell: near ? {
      x_left: +near.cell.x_left.toFixed(2),
      x_right: +near.cell.x_right.toFixed(2),
      adj_x_right: +near.cell.adj_x_right.toFixed(2),
      distance: +near.distance.toFixed(2)
    } : null,
    leak_left: null,
    leak_right: null
  };
  if(near && near.distance <= 5){
    // Only check leakage when we're confident which cell this field belongs to
    if(textLeftEdge < near.cell.x_left - PAD_LEFT){
      result.leak_left = +(near.cell.x_left - textLeftEdge).toFixed(2);
      leaks.push(result);
    } else if(rightEdge > near.cell.x_right + PAD_RIGHT){
      result.leak_right = +(rightEdge - near.cell.x_right).toFixed(2);
      leaks.push(result);
    }
  }
  examined.push(result);
}

for(const [sectionKey, section] of Object.entries(FORM_SCHEMA)){
  if(section.isTable){
    const cols = section.isChildren ? TABLE_COLS.children : TABLE_COLS.income;
    const rows = section.isChildren ? 5 : 12;
    for(let i=1; i<=Math.min(rows, 3); i++){
      const y = section.yStart - (i-1) * section.yStep;
      for(const col of cols){
        const sampleText = (col.col === 'p') ? '12/26' : (col.col === 'age' ? '12' : (col.col === 'name' ? 'אבחנהקליםעד' : '12,345'));
        checkField(`${section.prefix}_${col.col}_${i}`, section.page, col.rightEdge, y, sampleText, col.size);
      }
    }
    continue;
  }
  if(!section.fields) continue;
  for(const f of section.fields){
    if(f.type === 'radio') continue;
    const sample = sampleFor(f);
    checkField(f.id, f.page, f.rightEdge, f.y, sample, f.size);
  }
}

// === Write report ===
const lines = [];
lines.push('# Sweep Report — בדיקת בריחות');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Font: Heebo-Bold | Pad: ${PAD_LEFT}pt left, ${PAD_RIGHT}pt right`);
lines.push(`Total checked: ${examined.length} | Leaks found: ${leaks.length}`);
lines.push('');
lines.push('## Leakage Details');
lines.push('');
if(leaks.length === 0){
  lines.push('✅ אין בריחות. כל השדות נכנסים לתאים שלהם.');
} else {
  lines.push('| field | page | direction | overflow (pt) | sample | suggested fix |');
  lines.push('|-------|------|-----------|---------------|--------|---------------|');
  for(const l of leaks){
    const dir = l.leak_left ? `← left ${l.leak_left}pt` : `right → ${l.leak_right}pt`;
    const fix = l.leak_left
      ? `הקטן size ב-1, או הזז rightEdge ימינה ב-${Math.ceil(l.leak_left)}pt`
      : `הזז rightEdge שמאלה ב-${Math.ceil(l.leak_right)}pt`;
    lines.push(`| ${l.id} | ${l.page} | ${dir} | ${l.leak_left || l.leak_right} | ${l.sample} (${l.sample_width}pt) | ${fix} |`);
  }
}
lines.push('');
lines.push('## Summary by section (top-5 widest sample widths)');
lines.push('');
examined.sort((a,b) => b.sample_width - a.sample_width);
lines.push('| field | page | sample width (pt) | cell width (pt) | margin |');
lines.push('|-------|------|-------------------|-----------------|--------|');
for(const e of examined.slice(0, 15)){
  const cw = e.cell ? (e.cell.x_right - e.cell.x_left).toFixed(2) : '?';
  const margin = e.cell ? (cw - e.sample_width).toFixed(2) : '?';
  lines.push(`| ${e.id} | ${e.page} | ${e.sample_width} | ${cw} | ${margin} |`);
}

writeFileSync(join(ROOT, 'sweep-report.md'), lines.join('\n') + '\n');
console.log('=== sweep-render.mjs ===');
console.log('Total checked:', examined.length);
console.log('Leaks found:', leaks.length);
console.log('Written: sweep-report.md');
if(leaks.length){
  console.log('\nTop leaks:');
  for(const l of leaks.slice(0,10)){
    const dir = l.leak_left ? `LEFT ${l.leak_left}` : `RIGHT ${l.leak_right}`;
    console.log(`  ${l.id} p${l.page}: ${dir}pt (sample="${l.sample}" width=${l.sample_width})`);
  }
}
