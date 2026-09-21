#!/usr/bin/env node
/* =========================================================================
   write.js — turn an approved plan into copy, one article at a time.

   Each article gets its own call with only its own sources in front of it.
   That keeps the context small, makes a bad piece cheap to rewrite, and
   stops the model borrowing a fact from a story it is not writing.

   The word target is not advice. It is the measured capacity of the slot,
   and anything past it is deleted by the fitter from the end, which is why
   every piece is ordered so the end is the part worth losing.

     node tools/agent/write.js        plan.json + extracts -> data/issue.json
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const muse = require('./muse');
const budget = require('../budget');

const ROOT = path.join(__dirname, '..', '..');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/plan.json'), 'utf8'));
const pool = new Map(fs.readdirSync(path.join(ROOT, 'data/extracts'))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/extracts', f), 'utf8')))
  .map(e => [e.id, e]));

const DATE = new Date((plan.date || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
const LONG = DATE.toLocaleDateString('en-US',
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const SHORT = DATE.toLocaleDateString('en-US',
  { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/* How tall a photograph may be before the fitter has to shrink it and leave
   padding down both sides: the slot's plate allowance, less the caption and
   credit printed under it. Derived from the same geometry budget.js uses,
   rather than guessed — a flat 60mm left the inside lead at 71% of its
   measure, which is exactly the inset look a broadsheet should not have. */
const PLATE_MM = (() => {
  const g = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'js/templates.js'), 'utf8'))(g);
  const all = [...g.Templates.COVER_TEMPLATES, ...g.Templates.INSIDE_TEMPLATES];
  const map = new Map();
  (plan.shape || '').split(' + ').forEach((tplId, i) => {
    const tpl = all.find(t => t.id === tplId);
    if (!tpl) return;
    for (const s of tpl.slots.filter(x => x.accepts === 'article' && x.artPos === 'top')) {
      const area = s.s * s.h;
      const hed = area >= 2000 ? 40 : area >= 1000 ? 27 : area >= 550 ? 20 : 15;
      const body = s.h - (5 + hed + 9 + 2);
      map.set(`${s.n}-${i + 1}`, Math.max(30, Math.round(body * (s.plateShare || 0.45) - 14)));
    }
  });
  return map;
})();

const HOUSE = `You write for CYBORG NEWS, a laboratory broadsheet. The voice is
sober and specific: short declarative sentences, concrete nouns, no hype, no
rhetorical questions, no "in an era of". A dry closing line is welcome; a moral
is not.

Five rules are absolute:

1. QUOTE ONLY WHAT IS IN THE SOURCE, VERBATIM. Every quotation must appear word
   for word in the source text given to you. A build check compares them
   byte for byte and fails the issue on a mismatch. If you cannot find the
   sentence, you do not have the quote — write around it.
2. INVENT NO FACTS. No number, date, name, institution or event that is not in
   your sources. If the source does not say when something happened, do not say.
3. SAY NOTHING ABOUT THIS LABORATORY. You have no information about its people,
   its schedule, its hardware or its rooms. Never mention them.
4. INVERTED PYRAMID. The first paragraph carries the whole story on its own.
   The second and third add the essential detail. Everything after that is
   context that can be deleted without breaking the piece — because it will be.
5. Use HTML entities in body text: &ldquo; &rdquo; for quotation marks,
   &mdash; for em dashes, &rsquo; for apostrophes in contractions.`;

/* --- one article ------------------------------------------------------ */
async function writeArticle(a) {
  const srcs = a.source_ids.map(id => pool.get(id));
  const material = srcs.map((s, i) => `### SOURCE ${i + 1}: ${s.title}
site: ${s.site}${s.author ? `, by ${s.author}` : ''}${s.published ? `, published ${s.published.slice(0, 10)}` : ''}
url: ${s.url}

${s.text}`).join('\n\n');

  const hedWords = a.words >= 380 ? '6 to 9 words' : a.words >= 280 ? '5 to 8 words' : '4 to 7 words';
  const paras = Math.max(3, Math.round(a.words / 75));

  const user = `Write one article.
${a.correction ? `
THIS IS A REWRITE. ${a.correction}
Write to the new length exactly. Keep the same story and the same angle.
` : ''}
Section label (kicker): ${a.kicker}
The angle you were assigned: ${a.angle}
Length: ${a.words} words of body copy. This is the measured capacity of the
column. Write ${a.words} words, not more. Aim for about ${paras} paragraphs.
Headline: ${hedWords}, specific, no colon, no pun, present tense where natural.

${a.photo ? `This article carries a photograph of: ${a.photo.subject}
Write a caption of one or two sentences that says what the picture shows and
ties it to the story, plus a one-or-two-word label (capLabel) such as
"Rejected" or "Under review".\n` : ''}
Return JSON only:

{
  "headline": "...",
  "deck": "one sentence under the headline, adding information the headline omits",
  "dateline": "City",            // only if a place is genuinely central; otherwise omit
  "body": ["paragraph", "paragraph", ...],
  "pullquote": {"text": "a verbatim quotation from the source", "attr": "Name, Organisation"},
  "quoteAfter": 2,               // paragraph index the pullquote follows
  "caption": "...", "capLabel": "..."   // only if this article carries a photograph
}

Include "pullquote" only if the source contains a quotation worth lifting.
Omit it otherwise; a fabricated one fails the build.

## SOURCE MATERIAL

${material}`;

  const out = await muse.callJSON({
    system: HOUSE, user, label: `write:${a.slot}@${a.page}`, maxTokens: 14000
  });

  const art = {
    id: a.slot.replace(/[^a-z0-9]+/gi, '-') + '-' + a.page,
    page: a.page, priority: a.priority, kicker: a.kicker,
    sources: a.source_ids,          // the gate checks every quote against these
    headline: out.headline, deck: out.deck,
    ...(out.dateline ? { dateline: out.dateline } : {}),
    ...(out.pullquote?.text ? { pullquote: out.pullquote, quoteAfter: out.quoteAfter ?? 2 } : {}),
    body: out.body
  };
  if (a.photo) {
    art.art = {
      type: 'photo', spec: a.photo,          // resolved to a real file by photo.js
      capLabel: out.capLabel || '', caption: out.caption || '',
      wmm: 170, hmm: 60, focusY: 0.4,
      contrast: 1.04, gain: 0.66, feather: 0.35, floor: 0.08
    };
  }
  const n = out.body.join(' ').split(/\s+/).length;
  console.log(`      ${a.slot}@${a.page}: ${n}w against ${a.words} ` +
              `(${n > a.words ? '+' : ''}${n - a.words})  "${out.headline}"`);
  return art;
}

/* --- the furniture: ticker, boxes, fillers, page-two section name ------ */
async function writeFurniture(boxSlots) {
  const digest = [...pool.values()].filter(e => e.status === 'ok')
    .map(e => `- ${e.title} (${e.site}): ${(e.text || '').slice(0, 700)}`).join('\n');

  /* A box's word budget swings hard by slot: 56mm in the foot tier of one
     template, 187mm running the full side of another — a "text" box on the
     tall one at the short one's length leaves a third of a page blank, and
     nothing downstream catches it. The fitter's whitespace check only
     walks article slots, not boxes, so this is the one place a box gets
     sized at all. */
  const boxBrief = boxSlots.map(s =>
    `  - "${s.n}" is ${s.h}mm tall — if you write it as kind:"text", that is ` +
    `about ${budget.boxWords(s)} words (several short paragraphs, not one); ` +
    `as "table" or "listing", scale the row count the same way, more rows ` +
    `for a taller slot.`).join('\n');
  const names = boxSlots.map(s => s.n);

  const user = `Write the standing furniture for this issue.

Return JSON only:

{
  "section2": "two or three words naming page two, e.g. \\"Minds & Machines\\"",
  "ticker": [ {"k":"LABEL <=16 chars","v":"value","d":"detail <=18 chars","dir":"up"|"down"|"flat"} ],
  "boxes": [ ... ${names.length} boxes, slots ${names.map(n => `"${n}"`).join(', ')} ... ],
  "fillers": [ {"hed":"one word","text":"one sentence"} ]
}

"ticker": exactly 7 items, about MODELS — prices per million tokens, context
windows, benchmark scores, release dates. Not stock indices. Every number must
come from the source material below.

"boxes": ${names.length} boxes. Use each slot name exactly once, and match how
much you write to how much room the slot actually has:
${boxBrief}
Each box is one of:
  {"id":"slug","slot":"box-a","kind":"table","title":"...","caption":"...",
   "head":["Col","Col","Col"],"rows":[["a","b","c"], ...]}
  {"id":"slug","slot":"box-b","kind":"listing","title":"...",
   "rows":[{"when":"Sept 24","what":"short","who":"one clause"}, ...]}
  {"id":"slug","slot":"box-c","kind":"text","title":"...","tint":true,
   "paras":["<b>A bold opening clause.</b> Then as many further sentences and
   paragraphs as the word count above calls for."]}
Use a mix of kinds. A "listing" box should be things ahead on the calendar,
with real dates from the sources — never anything about this laboratory.

"fillers": 6 items. Single sentences that fill a short column, each from the
source material.

## SOURCE MATERIAL

${digest.slice(0, 26000)}`;

  return muse.callJSON({ system: HOUSE, user, label: 'furniture', maxTokens: 16000 });
}

/* --- run with a little concurrency ------------------------------------ */
async function pooled(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/* Rewriting one piece without paying for the other eight. Used when a stage
   downstream invalidates a single article — a photograph that arrived late,
   a caption that has to be written again. */
async function one(id) {
  const issue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/issue.json'), 'utf8'));
  const idOf = a => a.slot.replace(/[^a-z0-9]+/gi, '-') + '-' + a.page;
  const asn = plan.assignments.find(a => idOf(a) === id);
  const current = issue.articles.find(a => a.id === id);
  if (!asn || !current) { console.error(`no article "${id}" in the plan`); process.exit(1); }

  const fresh = await writeArticle(asn);
  if (current.art?.src) {                    // keep the licensed photograph
    fresh.art = { ...current.art, caption: fresh.art?.caption || current.art.caption,
                  capLabel: fresh.art?.capLabel || current.art.capLabel };
    delete fresh.art.spec;
  }
  Object.assign(current, fresh, { id });
  fs.writeFileSync(path.join(ROOT, 'data/issue.json'), JSON.stringify(issue, null, 2));
  const t = muse.totals();
  console.log(`\nrewrote ${id} — $${t.usd.toFixed(3)}`);
}

async function main() {
  const only = process.argv[process.argv.indexOf('--article') + 1];
  if (process.argv.includes('--article')) return one(only);

  const g = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'js/templates.js'), 'utf8'))(g);
  const all = [...g.Templates.COVER_TEMPLATES, ...g.Templates.INSIDE_TEMPLATES];
  const templates = plan.shape.split(' + ').map(id => all.find(t => t.id === id));
  const boxSlots = templates.flatMap(t => t.slots.filter(s => s.accepts === 'box'));

  console.log(`\nwriting ${plan.assignments.length} articles and the furniture`);
  const [articles, furniture] = await Promise.all([
    pooled(plan.assignments, 3, writeArticle),
    writeFurniture(boxSlots)
  ]);

  const groups = [];
  for (const r of plan.rail) {
    let grp = groups.find(x => x.label === r.group);
    if (!grp) groups.push(grp = { label: r.group, items: [] });
    grp.items.push({ lead: r.lead, text: r.point });
  }

  const issue = {
    issue: {
      name: 'CYBORG NEWS',
      left_ear: 'MIT · CAMBRIDGE, MASS.',
      right_ear: 'INTERNAL EDITION · NOT FOR CIRCULATION',
      site: 'CYBORGNEWS.MIT.EDU',
      price: 'FREE TO HUMANS',
      dateline_long: LONG, dateline_short: SHORT,
      volume: 'VOL. II', number: '',
      pages: templates.length,
      plan: templates.map(t => t.id),
      sections: ['', furniture.section2 || 'Minds & Machines'],
      written_by: muse.MODEL
    },
    ticker: furniture.ticker,
    rail: { title: "What's", title2: 'News', groups },
    articles: articles.sort((a, b) => a.page - b.page || b.priority - a.priority),
    boxes: furniture.boxes,
    fillers: furniture.fillers
  };

  fs.writeFileSync(path.join(ROOT, 'data/issue.json'), JSON.stringify(issue, null, 2));

  const t = muse.totals();
  console.log(`\nwrote data/issue.json — ${issue.articles.length} articles, ` +
    `${issue.ticker.length} ticker, ${groups.reduce((n, g) => n + g.items.length, 0)} briefs, ` +
    `${issue.boxes.length} boxes`);
  console.log(`${t.calls} model calls, ${t.in}+${t.out} tokens ` +
    `(${t.reasoning} reasoning), $${t.usd.toFixed(3)}`);
}

if (require.main === module) main();
module.exports = { writeArticle, HOUSE };   // refit.js rewrites single pieces
