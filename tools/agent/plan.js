#!/usr/bin/env node
/* =========================================================================
   plan.js — the editor's meeting. The stage that was missing last run.

   The model sees the whole fetched pool and the real capacity of every slot,
   then decides: which two templates, which stories, which slot each story
   goes in, how many words it gets, and which story earns a photograph.

   Nothing here is positional. A story and its picture are chosen together,
   so a photograph can never drift onto the article that happens to sit in
   the same slot — which is exactly how a photo of children once ended up
   over a story about a biometrics lawsuit.

     node tools/agent/plan.js            -> data/plan.json
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const muse = require('./muse');

const ROOT = path.join(__dirname, '..', '..');
const EXTRACTS = path.join(ROOT, 'data/extracts');
const TODAY = process.env.ISSUE_DATE || new Date().toISOString().slice(0, 10);

/* --- what we have to work with ---------------------------------------- */
const pool = fs.readdirSync(EXTRACTS).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(EXTRACTS, f), 'utf8')))
  .filter(e => e.status === 'ok' || e.status === 'thin');

if (pool.length < 6) {
  console.error(`only ${pool.length} readable sources — not enough for an issue`);
  process.exit(1);
}

const budget = JSON.parse(
  execFileSync('node', [path.join(ROOT, 'tools/budget.js'), '--json'], { encoding: 'utf8' }));

const g = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js/templates.js'), 'utf8'))(g);
const covers = g.Templates.COVER_TEMPLATES.map(t => t.id);
const insides = g.Templates.INSIDE_TEMPLATES.map(t => t.id);

/* Budgets for every shape the model may pick, so its word targets are real
   whichever pair it chooses. */
const shapes = {};
for (const c of covers) for (const i of insides) {
  shapes[`${c} + ${i}`] = JSON.parse(execFileSync(
    'node', [path.join(ROOT, 'tools/budget.js'), c, i, '--json'], { encoding: 'utf8' })).pages;
}

const digest = pool.map(e => ({
  id: e.id,
  title: e.title,
  site: e.site,
  published: (e.published || '').slice(0, 10) || 'undated',
  words: e.words,
  submitted_by: e.submitted_by,
  note: e.note || '',
  extract: (e.text || '').slice(0, 1100)
}));

const shapeTable = Object.entries(shapes).map(([name, pages]) => {
  const rows = pages.map(p => `    page ${p.page} ${p.template}: ` +
    p.slots.map(s => `${s.slot}=${s.words}w${s.plate ? '/photo' : ''}`).join(', ') +
    (p.boxes ? ` (+${p.boxes} boxes)` : '')).join('\n');
  return `  "${name}"\n${rows}`;
}).join('\n');

const system = `You are the editor of CYBORG NEWS, a two-page broadsheet printed
weekly for a research laboratory at MIT. You are running the Sunday editorial
meeting: choosing what goes in the paper and how much room each story gets.

Judgement you are expected to apply:

- PICK FOR DIVERSITY. Four or five distinct subjects beat five versions of the
  same story. Spread across: model releases and capability, safety and policy,
  cognition and neuroscience, industry and money. Two stories on the same event
  is an error unless they genuinely disagree.
- PICK FOR SUBSTANCE. A source with specific facts, numbers and named people
  makes a story. An aggregator page, a link index, a tag listing or a stub has
  nothing to write from — reject it and say so. Rejecting is not failure; it is
  most of the job.
- THE LEAD IS THE BIGGEST STORY, not the longest source.
- A PHOTOGRAPH IS CHOSEN WITH ITS STORY. For each slot marked /photo, describe
  the photograph that story needs as a physical scene a press photographer
  could actually have taken — "the exterior of a government building",
  "a child using a tablet at a desk". Never a chart, a logo or a screenshot.
- WORD COUNTS ARE CAPACITY, NOT AMBITION. They come from measured column
  geometry. A story written long is cut from the end by the typesetter.`;

const user = `## The pool — ${pool.length} sources people dropped in this week

${JSON.stringify(digest, null, 1)}

## Page shapes you may choose from, with the real capacity of every slot

${shapeTable}

## Your task

Pick ONE shape, fill every article slot in it, and return JSON only:

{
  "shape": "<exact key from the table above>",
  "rationale": "two sentences on the issue you are making and why it hangs together",
  "assignments": [
    {
      "slot": "<slot name from that shape>",
      "page": 1,
      "source_ids": ["<id>", "..."],     // usually one; more if a story needs two sources
      "kicker": "1-3 words, a section label",
      "angle": "one sentence: what this piece argues or reports",
      "words": 299,                       // copy the capacity for that slot exactly
      "priority": 10,                     // 10 = lead, down to 5
      "photo": {                          // ONLY for slots marked /photo
        "subject": "the physical scene a photographer would shoot",
        "search": "3-6 words to find it in a public-domain photo archive",
        "why": "how it relates to this specific story"
      }
    }
  ],
  "rail": [                               // 10 one-line briefs from sources NOT made into articles
    {"source_id": "<id>", "group": "In brief"|"Also noted", "lead": "3-5 words", "point": "one sentence"}
  ],
  "rejected": [ {"source_id": "<id>", "why": "one clause"} ]
}

Rules that will be checked mechanically, so satisfy them exactly:
- every article slot in your chosen shape appears exactly once in "assignments"
- "words" equals the capacity printed for that slot
- no source_id is used in more than one assignment
- every source_id exists in the pool above
- a slot marked /photo has a "photo" object; a slot not marked /photo has none
- every source in the pool appears exactly once across assignments, rail and rejected`;

(async () => {
  console.log(`\nplanning from ${pool.length} readable sources`);
  const plan = await muse.callJSON({ system, user, label: 'plan', maxTokens: 20000 });

  /* --- check the plan before anything downstream trusts it ------------- */
  const pages = shapes[plan.shape];
  const problems = [];
  if (!pages) problems.push(`unknown shape "${plan.shape}"`);

  if (pages) {
    const want = new Map();
    pages.forEach(p => p.slots.forEach(s =>
      want.set(s.slot + '@' + p.page, { words: s.words, plate: s.plate })));
    const got = new Map();
    for (const a of plan.assignments || []) {
      const k = a.slot + '@' + a.page;
      if (!want.has(k)) { problems.push(`slot "${a.slot}" is not on page ${a.page}`); continue; }
      if (got.has(k)) problems.push(`slot ${k} filled twice`);
      got.set(k, a);
      const w = want.get(k);
      if (w.plate && !a.photo) problems.push(`${k} carries a photo but none was chosen`);
      if (!w.plate && a.photo) problems.push(`${k} has no room for a photo`);
      if (Math.abs((a.words || 0) - w.words) > 1) {
        a.words = w.words;              // capacity wins; the model only advises
      }
    }
    for (const k of want.keys()) if (!got.has(k)) problems.push(`slot ${k} left empty`);
  }

  const ids = new Set(pool.map(e => e.id));
  const used = new Map();
  for (const a of plan.assignments || []) for (const id of a.source_ids || []) {
    if (!ids.has(id)) problems.push(`assignment "${a.slot}" cites unknown source ${id}`);
    if (used.has(id)) problems.push(`source ${id} used by both ${used.get(id)} and ${a.slot}`);
    used.set(id, a.slot);
  }
  for (const r of plan.rail || []) if (!ids.has(r.source_id))
    problems.push(`rail brief cites unknown source ${r.source_id}`);

  if (problems.length) {
    console.error('\nthe plan does not fit the page:');
    problems.forEach(p => console.error('  - ' + p));
    fs.writeFileSync(path.join(ROOT, 'data/plan.rejected.json'), JSON.stringify(plan, null, 2));
    process.exit(1);
  }

  plan.date = TODAY;
  plan.pool_size = pool.length;
  fs.writeFileSync(path.join(ROOT, 'data/plan.json'), JSON.stringify(plan, null, 2));

  console.log(`\nshape: ${plan.shape}`);
  console.log(`${plan.rationale}\n`);
  for (const p of pages) {
    console.log(`page ${p.page}`);
    for (const a of plan.assignments.filter(x => x.page === p.page)
                                    .sort((x, y) => y.priority - x.priority)) {
      const src = a.source_ids.map(id => pool.find(e => e.id === id).site).join(' + ');
      console.log(`  ${String(a.words).padStart(4)}w  ${a.slot.padEnd(8)} ${a.kicker.padEnd(14)} ${a.angle.slice(0, 62)}`);
      console.log(`         ${''.padEnd(9)} ${src}${a.photo ? '  [photo: ' + a.photo.search + ']' : ''}`);
    }
  }
  console.log(`\nrail: ${plan.rail.length} briefs, rejected: ${plan.rejected.length}`);
  plan.rejected.forEach(r => console.log(`  - ${(pool.find(e => e.id === r.source_id) || {}).site}: ${r.why}`));
})();
