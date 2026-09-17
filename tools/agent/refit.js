#!/usr/bin/env node
/* =========================================================================
   refit.js — the visual check, expressed as arithmetic.

   The first version of this stage treated every note in the fit report as a
   fault, and made the paper worse. It shrank copy that was correctly sized,
   saw the gap that left, grew it again, and oscillated until the pass limit
   stopped it — finishing with every article 18 to 49 per cent under its slot
   and six fillers padding the holes.

   The error was treating trimming as failure. The engine cuts from the end
   of a piece because the piece was written in inverted-pyramid order to be
   cut; a trimmed article is a full column, which is the goal. So trimming is
   now recorded and ignored, and only two things count as faults:

     white space   a visible gap under the last line  -> grow the copy
     clipping      content spilling out of its box    -> shrink it

   Because growth is the normal correction and shrinking happens only on the
   rare clip, the loop is monotone and cannot ping-pong. Corrections are
   damped and measured from the planned capacity rather than from whatever
   the last pass happened to leave.

   Exit codes are the loop's control flow:
     0  the page is set — nothing needed changing
     2  copy was revised — rebuild and measure again
     1  something broke

     node tools/agent/refit.js
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeArticle } = require('./write');
const muse = require('./muse');

const ROOT = path.join(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'data/fit-report.json');

if (!fs.existsSync(REPORT)) {
  console.error('no data/fit-report.json — run `node tools/render.js report` first');
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const issue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/issue.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/plan.json'), 'utf8'));

/* One column of 8.5pt on 10.6pt leading carries about 1.43 words per
   millimetre of depth. That constant turns a gap into a word count. */
const WORDS_PER_MM_PER_COL = (1 / 3.74) * (30 / 5.6);
const DAMP = 0.8;            // approach the gap, never lunge at it
const CEILING = 1.6;         // never write more than this multiple of capacity
const FLOOR_WORDS = 120;
const THRESHOLD = 25;        // smaller than this is inside the fitter's own slack
const idOf = a => a.slot.replace(/[^a-z0-9]+/gi, '-') + '-' + a.page;

/* How wide each slot is, so millimetres of gap convert to the right number
   of words. Taken from the same geometry the planner budgeted against. */
const cols = new Map();
const capacity = new Map();
for (const page of JSON.parse(execFileSync('node',
  [path.join(ROOT, 'tools/budget.js'), ...plan.shape.split(' + '), '--json'],
  { encoding: 'utf8' })).pages) {
  for (const s of page.slots) {
    cols.set(`${s.slot}-${page.page}`, s.cols);
    capacity.set(`${s.slot}-${page.page}`, s.words);
  }
}

const jobs = new Map();   // id -> { target, why }
const add = (id, target, reason) => {
  const prev = jobs.get(id);
  jobs.set(id, { target: prev ? Math.max(prev.target, target) : target,
                 why: [...(prev?.why || []), reason] });
};

/* --- faults worth acting on -------------------------------------------- */
for (const w of report.white || []) {
  const m = String(w).match(/^(\S+)\s+~(\d+)mm/);
  if (!m) continue;
  const [, id, mmStr] = m;
  const mm = Number(mmStr);
  const article = issue.articles.find(a => a.id === id);
  if (!article) continue;

  const had = (article.body || []).join(' ').split(/\s+/).filter(Boolean).length;
  const planned = capacity.get(id) || had;
  const width = cols.get(id) || 2;
  const grow = Math.round(mm * WORDS_PER_MM_PER_COL * width * DAMP);

  // measure from capacity, not from whatever the last pass left behind
  const target = Math.min(Math.round(planned * CEILING), Math.max(planned, had) + grow);
  if (target - had >= THRESHOLD) add(id, target, `${mm}mm of the column was left empty under your last line`);
}

for (const c of report.clipped || []) {
  const id = String(c).split(/\s+/)[0];
  const article = issue.articles.find(a => a.id === id);
  if (!article) continue;
  const had = (article.body || []).join(' ').split(/\s+/).filter(Boolean).length;
  add(id, Math.max(FLOOR_WORDS, had - 70), 'the last lines were clipped off the bottom of the column');
}

/* Trimming is the fitter doing its job, not a fault. Recorded, not acted on. */
const trimmed = (report.trimmed || []).filter(t => /¶/.test(String(t)));
if (trimmed.length) console.log(`  ${trimmed.length} piece(s) trimmed to fit — normal, left alone`);

const work = [...jobs.entries()];
if (!work.length) {
  console.log('  no gaps and no clipping — the page is set');
  process.exit(0);
}

async function pooled(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

(async () => {
  console.log(`  ${work.length} piece${work.length > 1 ? 's' : ''} to rewrite`);

  await pooled(work, 3, async ([id, job]) => {
    const asn = plan.assignments.find(a => idOf(a) === id);
    const current = issue.articles.find(a => a.id === id);
    if (!asn || !current) { console.log(`    ${id}: not in the plan, left alone`); return; }

    const had = (current.body || []).join(' ').split(/\s+/).filter(Boolean).length;
    console.log(`    ${id}: ${had}w -> ${job.target}w  (${job.why.join('; ')})`);

    const fresh = await writeArticle({
      ...asn, words: job.target,
      correction: `Your previous version ran ${had} words and ${job.why.join(', and ')}. ` +
                  `The column holds ${job.target} words.`
    });

    /* Keep the photograph that was already sourced and licensed; take only
       the new caption, which belongs to the new copy. */
    if (current.art?.src) {
      fresh.art = { ...current.art,
        caption: fresh.art?.caption || current.art.caption,
        capLabel: fresh.art?.capLabel || current.art.capLabel };
      delete fresh.art.spec;
    }
    Object.assign(current, fresh, { id: current.id });
  });

  fs.writeFileSync(path.join(ROOT, 'data/issue.json'), JSON.stringify(issue, null, 2));
  const t = muse.totals();
  console.log(`  revised ${work.length}; $${t.usd.toFixed(3)} this pass`);
  process.exit(2);                              // tell run.js to rebuild and measure again
})();
