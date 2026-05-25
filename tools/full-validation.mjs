#!/usr/bin/env node
// full-validation.mjs
// 1. Inject dummy data into every FORM_SCHEMA field
// 2. Compute rendered bbox via font.widthOfTextAtSize
// 3. Check that text fits inside its associated cell
// 4. Also render full test-pdf-with-dummies.pdf for visual inspection
// 5. Output validation report
//
// Run: node tools/full-validation.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// === Load schema + cells + font ===
const html = readFileSync(join(ROOT, 'details.html'), 'utf8');
const m = html.match(/const FORM_SCHEMA = (\{[\s\S]*?\n\});\n/);
if(!m) throw new Error('FORM_SCHEMA not found');
const schemaSrc = 'export const FORM_SCHEMA = ' + m[1] + ';';
const tmpUrl = 'data:text/javascript;base64,' + Buffer.from(schemaSrc).toString('base64');
const { FORM_SCHEMA } = await import(tmpUrl);

const cells = JSON.parse(readFileSync(join(ROOT, 'cells-calibrated.json'), 'utf8'));
const cellsByPage = {};
for(let p=0; p<cells.length; p++) cellsByPage[p] = cells[p];

const fontBytes = readFileSync(join(ROOT, 'fonts/Heebo-Bold.ttf'));
const pdfDoc = await PDFDocument.create();
pdfDoc.registerFontkit(fontkit);
const font = await pdfDoc.embedFont(fontBytes, { subset: true });

// Add 6 blank pages (A4)
for(let p=0; p<6; p++) pdfDoc.addPage([595.2, 841.92]);
const pages = pdfDoc.getPages();

// Hardcoded table column rightEdges (from render loop in details.html)
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

// Reverse Hebrew text (mirrors reverseHebrewRTL in details.html)
function reverseHebrewRTL(s){
  // Simple reversal — fontkit handles bidi but Hebrew runs need pre-reversal
  return s.split('').reverse().join('');
}

// Sample values per field type
function sampleFor(field){
  const id = field.id || '';
  const mw = field.maxWidth || 100;
  if(field.default) return field.default;
  if(mw < 35) return '1';
  if(/_id\b/i.test(id)) return '039187877';
  if(/(_amount|_g_|_n_|monthly_alimony|last_payment_amount|vehicle_value|salary|_inc$)/i.test(id)) return '12,345';
  if(/(_p_\d|date|birth|marriage|payment_date|_dt$)/i.test(id)) return '15/03/2025';
  if(/_age\b|_age_/i.test(id)) return '12';
  if(/_deps\b/i.test(id)) return '4';
  if(/phone|נייד/i.test(id)) return '0501234567';
  if(/court|בית.?המשפט/i.test(id)) return 'באר שבע';
  if(/case_number/i.test(id)) return '12345-01-26';
  if(mw > 250) return 'דמה ארוך מאוד של שם או כתובת לבדיקה';
  if(mw > 120) return 'דמה ארוך לבדיקה';
  if(mw > 70) return 'אבחנהקליםעד';
  return 'דמהדמה';
}

const blueColor = rgb(0.082, 0.106, 0.412); // #15186a — same as app
const issues = [];

function drawAndCheck(rawText, page, rightEdge, y, maxWidth, size, fieldId){
  // Compute width
  const renderedText = reverseHebrewRTL(rawText);
  const w = font.widthOfTextAtSize(renderedText, size);
  const effectiveW = Math.min(w, maxWidth);
  const x = rightEdge - effectiveW;
  // Draw
  pages[page].drawText(renderedText, { x, y, size, font, color: blueColor, maxWidth });
  // Find cell on this page that contains (rightEdge, y) within tolerance
  const arr = cellsByPage[page] || [];
  let bestCell = null, bestD = Infinity;
  for(const c of arr){
    if(c.adj_x_right == null || c.adj_y_baseline == null) continue;
    const dx = c.adj_x_right - rightEdge;
    const dy = c.adj_y_baseline - y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if(d < bestD){ bestD = d; bestCell = c; }
  }
  if(!bestCell) return;
  if(bestD > 8) return; // too far — probably dotted-line field, not boxed cell
  // Check text fits horizontally
  const textLeft = x;
  if(textLeft < bestCell.x_left - 1){
    issues.push({
      field: fieldId, page, y, rightEdge,
      issue: 'TEXT_OVERFLOW_LEFT',
      detail: `value '${rawText}' width=${w.toFixed(1)} extends from x=${textLeft.toFixed(1)} but cell left bound is ${bestCell.x_left.toFixed(1)}`,
      delta: +(bestCell.x_left - textLeft).toFixed(1)
    });
  }
  if(rightEdge > bestCell.x_right + 1){
    issues.push({
      field: fieldId, page, y, rightEdge,
      issue: 'TEXT_OVERFLOW_RIGHT',
      detail: `rightEdge ${rightEdge} > cell right ${bestCell.x_right.toFixed(1)}`,
      delta: +(rightEdge - bestCell.x_right).toFixed(1)
    });
  }
  // Check vertical alignment within cell
  if(y < bestCell.y_bot - 1 || y > bestCell.y_top + 1){
    issues.push({
      field: fieldId, page, y, rightEdge,
      issue: 'VERTICAL_OFFSET',
      detail: `y=${y} outside cell range [${bestCell.y_bot.toFixed(1)}, ${bestCell.y_top.toFixed(1)}]`
    });
  }
}

let totalDrawn = 0;
for(const [sectionKey, section] of Object.entries(FORM_SCHEMA)){
  if(section.isTable){
    const cols = section.isChildren ? TABLE_COLS.children : TABLE_COLS.income;
    const rows = section.isChildren ? 5 : 12;
    for(let i=1; i<=rows; i++){
      const y = section.yStart - (i-1) * section.yStep;
      for(const col of cols){
        const sample = (col.col === 'p') ? `${String(i).padStart(2,'0')}/26`
                     : (col.col === 'age') ? '12'
                     : (col.col === 'name') ? 'ילד דמה'
                     : '5,000';
        drawAndCheck(sample, section.page, col.rightEdge, y, col.maxWidth, col.size, `${section.prefix}_${col.col}_${i}`);
        totalDrawn++;
      }
    }
    continue;
  }
  if(!section.fields) continue;
  for(const f of section.fields){
    if(f.type === 'radio') continue;
    const sample = sampleFor(f);
    drawAndCheck(sample, f.page, f.rightEdge, f.y, f.maxWidth, f.size, f.id);
    totalDrawn++;
  }
}

// Save test PDF
const pdfBytes = await pdfDoc.save();
writeFileSync(join(ROOT, 'test-pdf-with-dummies.pdf'), pdfBytes);

console.log('=== full-validation.mjs ===');
console.log('Total fields drawn:', totalDrawn);
console.log('Issues found:', issues.length);

if(issues.length){
  // Group by issue type
  const byType = {};
  for(const i of issues){
    byType[i.issue] = (byType[i.issue] || 0) + 1;
  }
  console.log('\nBy type:');
  for(const [k, v] of Object.entries(byType)){
    console.log(`  ${k}: ${v}`);
  }
  console.log('\nFirst 20 issues:');
  for(const i of issues.slice(0,20)){
    console.log(`  [${i.issue}] ${i.field} (p${i.page}): ${i.detail}`);
  }
}

// Write validation report
const report = {
  generated: new Date().toISOString(),
  totalFieldsDrawn: totalDrawn,
  issuesFound: issues.length,
  issues
};
writeFileSync(join(ROOT, 'validation-report.json'), JSON.stringify(report, null, 2));
console.log('\nWritten: test-pdf-with-dummies.pdf, validation-report.json');
