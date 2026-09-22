#!/usr/bin/env node
/* =========================================================================
   budget.js — how many words fit in each slot of a page plan.

   The planner needs this before it picks a story, otherwise it writes to a
   guess and the fitter silently deletes the overflow. Estimated from slot
   geometry and the type scale in css/newspaper.css, calibrated against real
   issues: the measured error is a few per cent, which is inside the slack
   the sentence-level fitter already has.

     node tools/budget.js                      # the plan in data/issue.json
     node tools/budget.js cover/a3-lead inside/a3-lead
     node tools/budget.js --json               # machine-readable
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const g = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js/templates.js'), 'utf8'))(g);
const ALL = [...g.Templates.COVER_TEMPLATES, ...g.Templates.INSIDE_TEMPLATES];

/* --- the type scale, in millimetres ----------------------------------- */
const WELL_W = 269;              // A3 less margins
const GUTTER = 4;
const UNITS = 18;                // 3 units to a text column
const LINE = 3.74;               // 10.6pt leading
const CHARS_PER_LINE = 30;       // 8.5pt Source Serif in a ~41.5mm measure
const WORDS_PER_LINE = CHARS_PER_LINE / 5.6;

// headline block: kicker + headline + deck, by how big the slot is
function headMM(slot) {
  const area = slot.s * slot.h;
  const hed = area >= 2000 ? 40 : area >= 1000 ? 27 : area >= 550 ? 20 : 15;
  return 5 /* kicker */ + hed + 9 /* deck */ + 2;
}

function slotWords(slot) {
  const cols = Math.max(1, Math.floor(slot.s / 3));
  let body = slot.h - headMM(slot);
  if (slot.artPos === 'top') {
    const plate = (slot.h - headMM(slot)) * (slot.plateShare || 0.45);
    body -= plate + 14;          // plate plus its caption and credit
  }
  body = Math.max(0, body);
  return { cols, words: Math.round((body / LINE) * cols * WORDS_PER_LINE) };
}

/* A standing box's "text" kind renders through the same .body class as an
   article (js/engine.js renderBox), just as one wide column instead of
   several narrow ones — so the words-per-area estimate is the same as
   slotWords, only the head is a single title line rather than a kicker,
   headline and deck, and the "columns" figure is the box's own width as a
   fraction of one text column rather than a whole number of them.
   Left unbudgeted, this is exactly the gap the fitter cannot see: the
   whitespace audit only walks article slots, so a text box sized by
   guesswork rather than this can sit on the page for a full issue with a
   third of its height empty and nothing in the fit report ever says so. */
const BOX_HEAD_MM = 6;      // box-head title line, its rule, and the margin below it
const BOX_PAD_MM = 4.8;     // .boxed padding, top and bottom

function boxWords(slot) {
  const cols = slot.s / 3;                          // fractional: one wide column, not several
  const body = Math.max(0, slot.h - BOX_PAD_MM - BOX_HEAD_MM);
  return Math.round((body / LINE) * cols * WORDS_PER_LINE);
}

/* Rows, for the kinds that are made of rows. A words figure is no use to a
   table: told only "about 505 words", the issue of 22 September set seven
   rows in a slot that holds about thirty and printed 129mm of empty box.

   Measured off printed issues rather than derived, because a row's height
   is set by how many lines its cells wrap to, which depends on the measure:
   a table row is 5.14mm in a 6-unit box and 10.56mm in a 3-unit one — near
   enough exactly double for half the width, so the row scales inversely
   with span. A table also gives up 10.8mm to its caption and headings; a
   listing has no such furniture. */
const TABLE_ROW_MM = 5.2, TABLE_CHROME_MM = 10.8, LIST_ROW_MM = 8.0;

function boxRows(slot, kind) {
  const perRow = (kind === 'table' ? TABLE_ROW_MM : LIST_ROW_MM) * (6 / slot.s);
  const chrome = kind === 'table' ? TABLE_CHROME_MM : 0;
  const body = Math.max(0, slot.h - BOX_PAD_MM - BOX_HEAD_MM - chrome);
  return Math.max(1, Math.round(body / perRow));
}

function planOf(argv) {
  const ids = argv.filter(a => a.includes('/'));
  if (ids.length) return ids;
  const issue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/issue.json'), 'utf8'));
  return issue.issue.plan || ['cover/a3-lead', 'inside/a3-lead'];
}

/* The CLI (and its data/issue.json read) only runs standalone; write.js and
   refit.js want the pure geometry functions above without either the
   console output or a dependency on an issue already existing on disk. */
if (require.main === module) {
  const plan = planOf(process.argv.slice(2));
  const out = { plan, pages: [], totals: { articles: 0, boxes: 0, words: 0 } };

  plan.forEach((id, i) => {
    const tpl = ALL.find(t => t.id === id);
    if (!tpl) { console.error('unknown template: ' + id); process.exit(1); }
    const slots = tpl.slots.filter(s => s.accepts === 'article').map(s => {
      const { cols, words } = slotWords(s);
      return { slot: s.n, span: s.s, cols, height: s.h, plate: s.artPos === 'top', words };
    }).sort((a, b) => b.words - a.words);
    const boxSlots = tpl.slots.filter(s => s.accepts === 'box').map(s =>
      ({ slot: s.n, span: s.s, height: s.h, words: boxWords(s) }));
    out.pages.push({ page: i + 1, template: id, boxes: boxSlots.length, slots, boxSlots });
    out.totals.articles += slots.length;
    out.totals.boxes += boxSlots.length;
    out.totals.words += slots.reduce((n, s) => n + s.words, 0);
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`\nplan: ${plan.join('  ->  ')}\n`);
    for (const p of out.pages) {
      console.log(`page ${p.page}  ${p.template}   (${p.boxes} standing boxes)`);
      console.log('   slot        cols  height  plate   words');
      for (const s of p.slots) {
        console.log(`   ${s.slot.padEnd(11)} ${String(s.cols).padStart(3)}  ${String(s.height).padStart(5)}mm  ${(s.plate ? 'yes' : '  -').padStart(5)}   ${String(s.words).padStart(5)}`);
      }
      for (const s of p.boxSlots) {
        console.log(`   ${s.slot.padEnd(11)} box  ${String(s.height).padStart(5)}mm          ${String(s.words).padStart(5)}  (if written as kind:"text")`);
      }
      console.log('');
    }
    console.log(`${out.totals.articles} article slots, ${out.totals.boxes} boxes, about ${out.totals.words} words of copy\n`);
  }
}

module.exports = { slotWords, boxWords, boxRows, headMM };
