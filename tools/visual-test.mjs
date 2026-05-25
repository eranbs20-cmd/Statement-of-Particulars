#!/usr/bin/env node
// visual-test.mjs
// Overlay the dummy values onto base.pdf for visual inspection.
// Generates test-overlay.pdf — open in Preview to verify alignment.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const html = readFileSync(join(ROOT, 'details.html'), 'utf8');
const m = html.match(/const FORM_SCHEMA = (\{[\s\S]*?\n\});\n/);
const schemaSrc = 'export const FORM_SCHEMA = ' + m[1] + ';';
const tmpUrl = 'data:text/javascript;base64,' + Buffer.from(schemaSrc).toString('base64');
const { FORM_SCHEMA } = await import(tmpUrl);

const baseBytes = readFileSync(join(ROOT, 'base.pdf'));
const pdfDoc = await PDFDocument.load(baseBytes);
const fontBytes = readFileSync(join(ROOT, 'fonts/Heebo-Bold.ttf'));
pdfDoc.registerFontkit(fontkit);
const font = await pdfDoc.embedFont(fontBytes, { subset: true });

const pages = pdfDoc.getPages();
const blueColor = rgb(0.082, 0.106, 0.412);

// EXACT copy from details.html line 1637
function reverseHebrewRTL(str){
  if(!str) return '';
  if(!/[֐-׿]/.test(str)) return str;
  // Only reverse embedded LTR runs (digits/latin/-/), let fontkit bidi handle Hebrew
  return str.replace(/[\d/a-zA-Z\-]+/g, m => m.split('').reverse().join(''));
}

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

function sampleFor(f){
  const id = f.id || '';
  const mw = f.maxWidth || 100;
  if(f.default) return f.default;
  if(mw < 35) return '1';
  if(/_id\b/i.test(id)) return '039187877';
  if(/(_amount|_g_|_n_|monthly_alimony|last_payment_amount|vehicle_value|salary|_inc$)/i.test(id)) return '12,345';
  if(/(_p_\d|date|birth|marriage|payment_date|_dt$)/i.test(id)) return '15/03/2025';
  if(/_age\b/i.test(id)) return '12';
  if(/_deps\b/i.test(id)) return '4';
  if(/phone|נייד/i.test(id)) return '0501234567';
  if(/court|בית.?המשפט/i.test(id)) return 'באר שבע';
  if(/case_number/i.test(id)) return '12345-01-26';
  if(/_addr|כתובת|מען/i.test(id)) return 'רחוב הרצל 5, באר שבע';
  if(/_name|שם/i.test(id)) return 'דמה שם דמה';
  if(/_relation|הקרבה/i.test(id)) return 'בן';
  if(mw > 250) return 'דמה ארוך מאוד של שם או כתובת לבדיקה';
  if(mw > 120) return 'דמה ארוך לבדיקה';
  if(mw > 70) return 'אבחנהקליםעד';
  return 'דמהדמה';
}

function draw(text, page, rightEdge, y, maxWidth, size){
  const rev = reverseHebrewRTL(text);
  const w = font.widthOfTextAtSize(rev, size);
  const effW = Math.min(w, maxWidth);
  const x = rightEdge - effW;
  pages[page].drawText(rev, { x, y, size, font, color: blueColor, maxWidth });
}

let drawn = 0;
for(const section of Object.values(FORM_SCHEMA)){
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
        draw(sample, section.page, col.rightEdge, y, col.maxWidth, col.size);
        drawn++;
      }
    }
    continue;
  }
  if(!section.fields) continue;
  for(const f of section.fields){
    if(f.type === 'radio') continue;
    draw(sampleFor(f), f.page, f.rightEdge, f.y, f.maxWidth, f.size);
    drawn++;
  }
}

const out = await pdfDoc.save();
writeFileSync(join(ROOT, 'test-overlay.pdf'), out);
console.log(`Drawn ${drawn} fields onto base.pdf overlay.`);
console.log('Written: test-overlay.pdf');
console.log('Open with: open test-overlay.pdf');
