#!/usr/bin/env node
// snap-coords.mjs
// Snap every FORM_SCHEMA field to the nearest cell in cells-calibrated.json
// Outputs ./coords-snapped.json with proposed coordinate updates.
//
// Run: node tools/snap-coords.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SNAP_THRESHOLD = 15;     // pt — anything beyond is suspect
const TIGHT_THRESHOLD = 3;     // pt — anything beyond is real drift worth fixing
const X_PAD = 4;               // pt — left padding inside cell when computing maxWidth

// Hardcoded table-column rightEdges from the rendering loop (lines ~1320-1340 of details.html)
const TABLE_COLS = {
  income: [
    { col: 'p', rightEdge: 435.0, maxWidth: 100, size: 9, rows: 12 },
    { col: 'g', rightEdge: 286.0, maxWidth: 90,  size: 9, rows: 12 },
    { col: 'n', rightEdge: 150.0, maxWidth: 76,  size: 9, rows: 12 },
  ],
  children: [
    { col: 'name',   rightEdge: 442.0, maxWidth: 140, size: 9, rows: 5 },
    { col: 'age',    rightEdge: 293.0, maxWidth: 80,  size: 9, rows: 5 },
    { col: 'amount', rightEdge: 208.0, maxWidth: 126, size: 9, rows: 5 },
  ]
};

// 1. Load cells-calibrated.json
const cells = JSON.parse(readFileSync(join(ROOT, 'cells-calibrated.json'), 'utf8'));
const cellsByPage = {};
for(let p=0; p<cells.length; p++){
  cellsByPage[p] = cells[p];
}

// 2. Load FORM_SCHEMA by extracting from details.html and eval'ing
const html = readFileSync(join(ROOT, 'details.html'), 'utf8');
const m = html.match(/const FORM_SCHEMA = (\{[\s\S]*?\n\});\n/);
if(!m) throw new Error('Could not locate FORM_SCHEMA in details.html');
// Build a small JS module that re-exports FORM_SCHEMA
const schemaSrc = 'export const FORM_SCHEMA = ' + m[1] + ';';
const tmpUrl = 'data:text/javascript;base64,' + Buffer.from(schemaSrc).toString('base64');
const { FORM_SCHEMA } = await import(tmpUrl);

// 3. Snap helper
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
  return { cell: best, distance: bestD };
}

// 4. Iterate
const report = {
  generated: new Date().toISOString(),
  threshold_snap: SNAP_THRESHOLD,
  threshold_tight: TIGHT_THRESHOLD,
  fields: [],
  tables: [],
  suspect: [],
  summary: { snapped: 0, already_aligned: 0, suspect: 0, total: 0 }
};

for(const [sectionKey, section] of Object.entries(FORM_SCHEMA)){
  if(section.isTable){
    // For tables: snap each column's first row by combining yStart with each column's rightEdge
    const cols = section.isChildren ? TABLE_COLS.children : TABLE_COLS.income;
    const colSnaps = [];
    let snappedYStart = null;
    const rowYs = [];

    for(const col of cols){
      const { cell, distance } = nearestCell(section.page, col.rightEdge, section.yStart);
      if(cell && distance < SNAP_THRESHOLD){
        colSnaps.push({
          col: col.col,
          orig_rightEdge: col.rightEdge,
          new_rightEdge: cell.adj_x_right,
          orig_y: section.yStart,
          new_y: cell.adj_y_baseline,
          orig_maxWidth: col.maxWidth,
          new_maxWidth: Math.max(20, Math.round((cell.adj_x_right - cell.x_left - X_PAD) * 10) / 10),
          distance: +distance.toFixed(2)
        });
        if(snappedYStart == null) snappedYStart = cell.adj_y_baseline;
      } else {
        report.suspect.push({
          section: sectionKey,
          col: col.col,
          page: section.page,
          orig: { rightEdge: col.rightEdge, y: section.yStart },
          nearest: cell ? { rightEdge: cell.adj_x_right, y: cell.adj_y_baseline, distance: +distance.toFixed(2) } : null
        });
      }
    }

    // Compute new yStep from row spacing in the cells map (look at cells at same x as first column)
    const rows = section.isChildren ? 5 : 12;
    let newYStep = section.yStep;
    if(colSnaps[0]){
      const targetX = colSnaps[0].new_rightEdge;
      const rowCells = (cellsByPage[section.page] || [])
        .filter(c => Math.abs(c.adj_x_right - targetX) < 3 && c.adj_y_baseline != null)
        .map(c => c.adj_y_baseline)
        .sort((a,b) => b - a); // descending y (PDF coords)
      if(rowCells.length >= 2){
        const diffs = [];
        for(let i=1; i<rowCells.length && i<rows; i++){
          diffs.push(rowCells[i-1] - rowCells[i]);
        }
        if(diffs.length){
          newYStep = +(diffs.reduce((a,b)=>a+b,0) / diffs.length).toFixed(3);
        }
      }
    }

    report.tables.push({
      section: sectionKey,
      page: section.page,
      isChildren: !!section.isChildren,
      orig_yStart: section.yStart,
      new_yStart: snappedYStart,
      orig_yStep: section.yStep,
      new_yStep: newYStep,
      cols: colSnaps
    });
    continue;
  }

  if(!section.fields) continue;
  for(const f of section.fields){
    if(f.type === 'radio') continue;
    report.summary.total++;
    const { cell, distance } = nearestCell(f.page, f.rightEdge, f.y);
    if(!cell){
      report.suspect.push({ section: sectionKey, id: f.id, page: f.page, reason: 'no cells on page' });
      continue;
    }
    const entry = {
      section: sectionKey,
      id: f.id,
      label: f.label,
      page: f.page,
      orig: { rightEdge: f.rightEdge, y: f.y, maxWidth: f.maxWidth, size: f.size },
      nearest: {
        rightEdge: +cell.adj_x_right.toFixed(2),
        y: +cell.adj_y_baseline.toFixed(2),
        x_left: +cell.x_left.toFixed(2),
        x_right: +cell.x_right.toFixed(2),
        cell_width: +(cell.x_right - cell.x_left).toFixed(2),
        distance: +distance.toFixed(2)
      },
      new_maxWidth: Math.max(20, Math.round((cell.adj_x_right - cell.x_left - X_PAD) * 10) / 10),
      action: 'none'
    };
    if(distance > SNAP_THRESHOLD){
      entry.action = 'suspect';
      report.suspect.push(entry);
      report.summary.suspect++;
    } else if(distance > TIGHT_THRESHOLD){
      entry.action = 'snap';
      entry.new_rightEdge = +cell.adj_x_right.toFixed(2);
      entry.new_y = +cell.adj_y_baseline.toFixed(2);
      report.fields.push(entry);
      report.summary.snapped++;
    } else {
      entry.action = 'aligned';
      report.fields.push(entry);
      report.summary.already_aligned++;
    }
  }
}

writeFileSync(join(ROOT, 'coords-snapped.json'), JSON.stringify(report, null, 2));

console.log('=== snap-coords.mjs ===');
console.log('Total fields:    ', report.summary.total);
console.log('  Aligned (<3pt):', report.summary.already_aligned);
console.log('  Snapped (3-15):', report.summary.snapped);
console.log('  Suspect (>15): ', report.summary.suspect);
console.log('Tables:          ', report.tables.length);
console.log('Suspect entries: ', report.suspect.length);
console.log('Written: coords-snapped.json');
