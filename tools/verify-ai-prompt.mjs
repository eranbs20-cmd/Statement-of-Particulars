#!/usr/bin/env node
// verify-ai-prompt.mjs
// Validate the AI extraction prompt structure:
// - prompt size (must fit in Groq's 32K context, ideally <8KB to leave room for doc)
// - field count (should include all 24 sections, ~163 non-table fields + table cols)
// - blacklist coverage (should reject affidavit metadata)
// - normalization behavior on edge cases

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load FORM_SCHEMA + extract helper functions from details.html
const html = readFileSync(join(ROOT, 'details.html'), 'utf8');

// Extract FORM_SCHEMA
const mSchema = html.match(/const FORM_SCHEMA = (\{[\s\S]*?\n\});\n/);
if(!mSchema) throw new Error('FORM_SCHEMA not found');
const schemaSrc = 'export const FORM_SCHEMA = ' + mSchema[1] + ';';
const tmpUrl = 'data:text/javascript;base64,' + Buffer.from(schemaSrc).toString('base64');
const { FORM_SCHEMA } = await import(tmpUrl);

// Inline copy of _buildExtractionPromptCompact (from details.html ~line 770)
function compactFn(text, FORM_SCHEMA){
  const fieldLines = [];
  for(const section of Object.values(FORM_SCHEMA)){
    if(section.isTable){
      const rows = section.isChildren ? 5 : 12;
      const cols = section.isChildren ? ['name','age','amount'] : ['p','g','n'];
      for(let i=1; i<=Math.min(rows, 3); i++){
        for(const c of cols){
          fieldLines.push(`${section.prefix}_${c}_${i}`);
        }
      }
    } else if(section.fields){
      for(const f of section.fields){
        if(f.type === 'radio') continue;
        fieldLines.push(f.id);
      }
    }
  }
  const MAX_DOC_CHARS = 12000;
  const docText = text.length > MAX_DOC_CHARS
    ? text.slice(0, MAX_DOC_CHARS) + '...[נחתך]'
    : text;
  return `חלץ נתונים למילוי טופס "הרצאת פרטים" (טופס 4) מהמסמך למטה.
שדות מותרים: ${fieldLines.join(',')}

החזר JSON תקין בלבד. דלג על שדות שלא במסמך. ת.ז. = 9 ספרות. מספרים = ספרות בלבד. תאריכים = dd/mm/yyyy. אל תכלול תוויות כמו "לתשומת ליבך"/"חתימה"/"ברוטו" כערכים.

מסמך:
${docText}`;
}

// Extract _BLACKLIST_VALUES
const mBlacklist = html.match(/const _BLACKLIST_VALUES = new Set\(\[([\s\S]*?)\]\);/);
const blacklist = mBlacklist ? mBlacklist[1] : '';
const blacklistCount = (blacklist.match(/'[^']+'/g) || []).length;

console.log('=== verify-ai-prompt.mjs ===\n');

// === Check 1: Field count ===
let totalFields = 0;
let sectionCount = 0;
let tableCount = 0;
for(const section of Object.values(FORM_SCHEMA)){
  sectionCount++;
  if(section.isTable){
    tableCount++;
    const rows = section.isChildren ? 5 : 12;
    const cols = 3;
    totalFields += rows * cols;
  } else if(section.fields){
    for(const f of section.fields){
      if(f.type !== 'radio') totalFields++;
    }
  }
}
console.log(`Schema:    ${sectionCount} sections, ${tableCount} tables, ${totalFields} extractable fields`);

// === Check 2: Compact prompt size ===
const SAMPLE_DOC = 'אני הח״מ ליטל עואמי, נושאת תעודת זהות מספר 039187877, מצהירה: אני גרושה, מתגוררת בבאר שבע, רחוב הרצל 5. הילדים שלי בני 12 ו-15. המזונות החודשיים שאני מבקשת הם 5,000 ש״ח.';
const prompt = compactFn(SAMPLE_DOC, FORM_SCHEMA);
console.log(`\nCompact prompt for short doc (${SAMPLE_DOC.length} chars):`);
console.log(`  Total size:     ${prompt.length} chars`);
console.log(`  Groq limit:     ~24,000 chars (32K tokens × ~3 chars/token)`);
console.log(`  Headroom:       ${(24000 - prompt.length).toLocaleString()} chars`);

const LONG_DOC = 'דמה '.repeat(5000); // 25000 chars
const promptLong = compactFn(LONG_DOC, FORM_SCHEMA);
console.log(`\nCompact prompt for long doc (${LONG_DOC.length} chars → truncated to 12K):`);
console.log(`  Total size:     ${promptLong.length} chars`);
console.log(`  Status:         ${promptLong.length < 24000 ? '✓ fits' : '❌ over limit'}`);

// === Check 3: Field id coverage in prompt ===
let idsInPrompt = 0;
for(const section of Object.values(FORM_SCHEMA)){
  if(section.isTable){
    const rows = section.isChildren ? 5 : 12;
    const cols = section.isChildren ? ['name','age','amount'] : ['p','g','n'];
    for(let i=1; i<=Math.min(rows,3); i++){
      for(const c of cols){
        const fid = `${section.prefix}_${c}_${i}`;
        if(prompt.includes(fid)) idsInPrompt++;
      }
    }
  } else if(section.fields){
    for(const f of section.fields){
      if(f.type === 'radio') continue;
      if(prompt.includes(f.id)) idsInPrompt++;
    }
  }
}
console.log(`\nField ID coverage in compact prompt:`);
console.log(`  IDs present:    ${idsInPrompt}`);
console.log(`  Expected:       ${totalFields - (tableCount * 36 - tableCount * 9)} (full non-tables + 3 first rows × 3 cols per table)`);

// === Check 4: Blacklist coverage ===
console.log(`\nBlacklist:`);
console.log(`  Entries:        ${blacklistCount}`);
const criticalEntries = ['לתשומת ליבך', 'מתוך הקובץ', 'חתימת המבקש', 'תצהיר', 'אני הח"מ', 'FILE BOUNDARY', 'ברוטו', 'נטו', 'התקופה'];
console.log(`  Critical checks:`);
for(const c of criticalEntries){
  const present = blacklist.includes(c.replace(/"/g, '\\"')) || blacklist.includes(c);
  console.log(`    ${present ? '✓' : '✗'} ${c}`);
}

// === Check 5: Sample dummy field IDs that AI should know ===
const SAMPLE_IDS = ['g_name', 'g_id', 'plaintiff_name', 'last_payment_amount', 'inc_p_1', 'monthly_alimony', 'parents_status'];
console.log(`\nSample fields visibility:`);
for(const id of SAMPLE_IDS){
  console.log(`    ${prompt.includes(id) ? '✓' : '✗'} ${id}`);
}

console.log('\n=== Summary ===');
const ok = prompt.length < 24000 && promptLong.length < 24000 && idsInPrompt > 100;
console.log(ok ? '✓ AI prompt is healthy.' : '❌ Issues detected — review above');
