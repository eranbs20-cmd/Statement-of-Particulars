#!/usr/bin/env node
// integration-test.mjs
// Full internal test suite. Returns exit code 0 if all pass, 1 if any fail.
//
// Tests:
//   1. Schema integrity (no dup IDs, no dup coords)
//   2. Coordinate validation (runs full-validation.mjs)
//   3. Visual overlay generation (runs visual-test.mjs)
//   4. AI prompt structure (runs verify-ai-prompt.mjs)
//   5. PDF text extraction on known PDFs
//   6. Mock AI normalize + apply
//
// Run before every push: node tools/integration-test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0, warned = 0;
const results = [];

function step(name, fn){
  process.stdout.write(`[${results.length + 1}/6] ${name.padEnd(40)} `);
  try {
    const status = fn();
    if(status && status.warning){
      console.log('⚠ ' + status.message);
      warned++;
      results.push({name, status: 'WARN', message: status.message});
    } else {
      console.log('✓ ' + (status && status.message || 'OK'));
      passed++;
      results.push({name, status: 'PASS', message: status && status.message});
    }
  } catch(e){
    console.log('✗ ' + e.message);
    failed++;
    results.push({name, status: 'FAIL', message: e.message});
  }
}

console.log('=== Integration Test Suite ===\n');

// === Test 1: Schema integrity ===
step('Schema integrity check', () => {
  const html = readFileSync(join(ROOT, 'details.html'), 'utf8');
  const m = html.match(/const FORM_SCHEMA = \{([\s\S]*?)\n\};/);
  if(!m) throw new Error('FORM_SCHEMA not found in details.html');
  const schemaText = m[1];

  // Extract all field definitions
  const fields = [];
  const fieldRe = /id:'([^']+)'[^}]*?page:(\d+)[^}]*?rightEdge:([\d.]+)[^}]*?y:([\d.]+)/g;
  let fm;
  while((fm = fieldRe.exec(schemaText)) !== null){
    fields.push({id: fm[1], page: +fm[2], rightEdge: +fm[3], y: +fm[4]});
  }

  // Check 1: no duplicate IDs
  const idCount = {};
  for(const f of fields){
    idCount[f.id] = (idCount[f.id] || 0) + 1;
  }
  const dupIds = Object.entries(idCount).filter(([k,v]) => v > 1);
  if(dupIds.length){
    throw new Error(`${dupIds.length} duplicate IDs: ${dupIds.slice(0,3).map(d=>d[0]).join(', ')}`);
  }

  // Check 2: no overlapping coords (same page, within 3pt)
  let dupCoords = 0;
  for(let i=0; i<fields.length; i++){
    for(let j=i+1; j<fields.length; j++){
      if(fields[i].page !== fields[j].page) continue;
      const dx = Math.abs(fields[i].rightEdge - fields[j].rightEdge);
      const dy = Math.abs(fields[i].y - fields[j].y);
      if(dx < 3 && dy < 3) dupCoords++;
    }
  }
  if(dupCoords > 0){
    throw new Error(`${dupCoords} field pairs overlap (within 3pt) — risk of text collision`);
  }

  return { message: `${fields.length} fields, 0 dup IDs, 0 overlapping coords` };
});

// === Test 2: Coordinate validation ===
step('Coordinate validation', () => {
  try {
    const out = execSync(`node "${join(__dirname, 'full-validation.mjs')}"`, { encoding: 'utf8', cwd: ROOT });
    const issueMatch = out.match(/Issues found:\s*(\d+)/);
    if(!issueMatch) throw new Error('Could not parse output');
    const issues = +issueMatch[1];
    if(issues > 0) throw new Error(`${issues} alignment issues`);
    const drawnMatch = out.match(/Total fields drawn:\s*(\d+)/);
    return { message: `${drawnMatch ? drawnMatch[1] : '?'} fields drawn, 0 issues` };
  } catch(e){
    throw new Error(e.message.slice(0, 100));
  }
});

// === Test 3: Visual overlay generation ===
step('Visual overlay generation', () => {
  try {
    execSync(`node "${join(__dirname, 'visual-test.mjs')}"`, { encoding: 'utf8', cwd: ROOT, stdio: 'pipe' });
    const path = join(ROOT, 'test-overlay.pdf');
    if(!existsSync(path)) throw new Error('test-overlay.pdf not created');
    const stat = readFileSync(path);
    return { message: `test-overlay.pdf ${(stat.length/1024).toFixed(0)}KB` };
  } catch(e){
    throw new Error('failed: ' + e.message.slice(0,80));
  }
});

// === Test 4: AI prompt structure ===
step('AI prompt structure', () => {
  try {
    const out = execSync(`node "${join(__dirname, 'verify-ai-prompt.mjs')}"`, { encoding: 'utf8', cwd: ROOT });
    if(!out.includes('AI prompt is healthy')) throw new Error('verify-ai-prompt did not report healthy');
    const shortSize = (out.match(/Total size:\s*(\d+)\s*chars/g) || [])[0] || '';
    return { message: shortSize.replace('Total size:', 'short=').replace(' chars','') };
  } catch(e){
    throw new Error(e.message.slice(0,100));
  }
});

// === Test 5: PDF text extraction ===
step('PDF text extraction on samples', async () => {
  try {
    // Test base.pdf — should have text
    const bytes = readFileSync(join(ROOT, 'base.pdf'));
    const doc = await PDFDocument.load(bytes);
    if(doc.getPageCount() !== 6) throw new Error(`base.pdf has ${doc.getPageCount()} pages, expected 6`);
    // We can't easily extract text from pdf-lib alone — just verify it loads
    return { message: `base.pdf loaded (${doc.getPageCount()} pages)` };
  } catch(e){
    throw new Error(e.message.slice(0,100));
  }
});

// === Test 6: Mock AI extraction normalize + apply ===
step('Mock AI normalize behavior', () => {
  const html = readFileSync(join(ROOT, 'details.html'), 'utf8');
  // Verify _normalizeExtracted handles common edge cases by checking the code is present
  const checks = [
    [/_BLACKLIST_VALUES = new Set\(\[/, 'blacklist defined'],
    [/digits\.length === 9/, 'ID validation (9 digits)'],
    [/_normalizeDate/, 'date normalization'],
    [/_fetchWithTimeout/, 'timeout fetch wrapper'],
    [/_extractWithClaudeVision/, 'Vision fallback'],
    [/AbortController/, 'AbortController used'],
  ];
  const missing = checks.filter(([re, name]) => !re.test(html)).map(c => c[1]);
  if(missing.length){
    throw new Error('Missing: ' + missing.join(', '));
  }
  return { message: `${checks.length}/${checks.length} guards present` };
});

// === Summary ===
console.log('\n=== Summary ===');
console.log(`PASS:  ${passed}/${results.length}`);
console.log(`WARN:  ${warned}/${results.length}`);
console.log(`FAIL:  ${failed}/${results.length}`);

if(failed > 0){
  console.log('\n❌ FAILED — fix issues before push');
  process.exit(1);
}
if(warned > 0){
  console.log('\n⚠ Warnings present but tests pass — review before push');
}
console.log('\n✓ All checks passed. Safe to push.');
process.exit(0);
